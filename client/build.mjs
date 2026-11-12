// Builds the PWA into dist/: bundles with esbuild, fingerprints assets, writes the service worker.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, 'dist');
const watch = process.argv.includes('--dev');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const appVersion = readJson('package.json').version;
// The receipt scanner's files are served from our own origin (the CSP blocks CDNs). Versioned path: /assets is cached forever.
const ocrPath = `/assets/tesseract-${readJson('node_modules/tesseract.js/package.json').version}`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunk.[hash]',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  outdir: path.join(out, 'assets'),
  entryNames: '[name].[hash]',
  assetNames: '[name].[hash]',
  metafile: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
    __APP_VERSION__: JSON.stringify(appVersion),
    __TESSERACT_PATH__: JSON.stringify(ocrPath),
  },
  logLevel: 'info',
});

const outputs = Object.keys(result.metafile.outputs).map((p) => '/' + path.relative(out, path.resolve(p)).split(path.sep).join('/'));
const js = outputs.find((p) => /\/main\.[^/]+\.js$/.test(p));
const css = outputs.find((p) => p.endsWith('.css'));

// Copy static files.
for (const f of fs.readdirSync(path.join(root, 'public'))) {
  fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));
}

// Not precached: about 11 MB, fetched (then cached by the service worker) the first time a receipt is scanned.
fs.mkdirSync(path.join(out, ocrPath));
for (const f of [
  'tesseract.js/dist/worker.min.js',
  'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract.js-core/tesseract-core-lstm.wasm.js',
  '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
]) {
  fs.copyFileSync(path.join(root, 'node_modules', f), path.join(out, ocrPath, path.basename(f)));
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="${css}">` : '')
  .replace('<!--JS-->', `<script type="module" src="${js}"></script>`);
fs.writeFileSync(path.join(out, 'index.html'), html);

const precache = ['/', '/index.html', ...outputs, ...fs.readdirSync(path.join(root, 'public')).map((f) => '/' + f)];
const version = crypto.createHash('sha256').update(precache.join() + html).digest('hex').slice(0, 12);
fs.writeFileSync(
  path.join(out, 'sw.js'),
  fs.readFileSync(path.join(root, 'sw.template.js'), 'utf8')
    .replace('__VERSION__', version)
    .replace('__PRECACHE__', JSON.stringify([...new Set(precache)], null, 2))
);
console.log(`Built ${js} ${css || ''} (sw ${version})`);
