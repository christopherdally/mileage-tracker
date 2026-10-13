const TOKEN_KEY = 'mt.token';
const USER_KEY = 'mt.user';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export const session = {
  get token() { return ls.get(TOKEN_KEY); },
  get user() { try { return JSON.parse(ls.get(USER_KEY) || 'null'); } catch { return null; } },
  save(token, user) {
    if (token) ls.set(TOKEN_KEY, token);
    if (user) ls.set(USER_KEY, JSON.stringify(user));
  },
  clear() { ls.set(TOKEN_KEY, null); ls.set(USER_KEY, null); },
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Thrown when there's no connection; callers treat it as "try again later", not as a failure. */
export class OfflineError extends Error {
  constructor() { super("You're offline"); }
}

const listeners = new Set();
export const onSignedOut = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new OfflineError();
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (res.status === 401 && path !== '/auth/login') listeners.forEach((fn) => fn());
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}

export async function uploadFile(id, blob, mime) {
  let res;
  try {
    res = await fetch(`/api/files/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': mime, Authorization: `Bearer ${session.token}` },
      body: blob,
    });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 401) listeners.forEach((fn) => fn());
  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
}

export async function fetchFile(id) {
  let res;
  try {
    res = await fetch(`/api/files/${id}`, { headers: { Authorization: `Bearer ${session.token}` } });
  } catch {
    throw new OfflineError();
  }
  if (!res.ok) throw new ApiError(res.status, 'Receipt not available');
  return res.blob();
}

export async function downloadWithAuth(path, filename) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  saveBlob(await res.blob(), filename);
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
