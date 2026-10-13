// A tiny HTTP layer on node:http — routing, JSON bodies, static files, security headers.
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    "worker-src 'self' blob:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; " +
    "base-uri 'self'; form-action 'self'",
};

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...(res.getHeader('Connection') ? { Connection: res.getHeader('Connection') } : {}),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

export async function readRaw(req, limit) {
  if (Number(req.headers['content-length']) > limit) {
    throw new HttpError(413, `File too large (max ${Math.round(limit / 1048576)} MB)`);
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, `File too large (max ${Math.round(limit / 1048576)} MB)`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export function sendBytes(res, mime, data) {
  // node-postgres gives a Buffer; accept hex text ("\\x…") too.
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data).replace(/^\\x/, ''), 'hex');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': mime,
    'Content-Length': buf.length,
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  res.end(buf);
}

export async function readJson(req, limit = 5 * 1024 * 1024) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body && typeof body === 'object' ? body : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, handler });
  };
  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'),
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/** Serve the built PWA with an index.html fallback for client-side routes. */
export function serveStatic(root, req, res, pathname) {
  let rel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) file = path.join(root, 'index.html');
  let stat = fs.existsSync(file) ? fs.statSync(file) : null;
  if (!stat || stat.isDirectory()) {
    file = path.join(root, 'index.html');
    stat = fs.existsSync(file) ? fs.statSync(file) : null;
    if (!stat) return false;
  }
  // Bundles in /assets have content hashes in their names, so they never change.
  const hashed = path.relative(root, file).startsWith('assets' + path.sep);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': stat.size,
    // Hashed bundles never change; everything else (index, sw.js, manifest) must revalidate.
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

export function sendFile(res, file, downloadName) {
  const stat = fs.statSync(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${downloadName.replace(/"/g, '')}"`,
    'Cache-Control': 'no-store',
  });
  return new Promise((resolve, reject) => {
    const s = fs.createReadStream(file);
    s.on('error', reject);
    res.on('finish', resolve);
    s.pipe(res);
  });
}

/** Fixed-window rate limiter keyed by client IP. */
export function rateLimiter({ windowMs, limit }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) h = { count: 0, reset: now + windowMs };
    h.count++;
    hits.set(key, h);
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    if (h.count > limit) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  };
}
