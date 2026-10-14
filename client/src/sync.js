// Two-way sync between this device's store and the server. Safe to call as often as you like.
import { api, uploadFile, ApiError, OfflineError } from './api.js';
import { store } from './store.js';

const BATCH = 500;
const strip = ({ dirty, rejected, ...row }) => row; // eslint-disable-line no-unused-vars

let running = null;
let again = false;
const status = { state: 'idle', lastSync: null, error: null };
const listeners = new Set();
export const syncStatus = () => status;
export const onSyncStatus = (fn) => (listeners.add(fn), () => listeners.delete(fn));
function setStatus(patch) {
  Object.assign(status, patch);
  listeners.forEach((fn) => fn({ ...status }));
}

/** Merge rows from the server unless this device holds a newer unsynced edit of the same row. */
function merge(kind, incoming) {
  const map = store[kind];
  const out = [];
  for (const s of incoming) {
    const local = map.get(s.id);
    if (local?.dirty && Date.parse(local.updatedAt) > Date.parse(s.updatedAt)) continue;
    out.push({ ...s, dirty: false, rejected: false });
  }
  return out;
}

async function syncOnce() {
  for (let round = 0; round < 50; round++) {
    const dirtyRates = [...store.rates.values()].filter((r) => r.dirty).slice(0, BATCH);
    const dirtyTrips = [...store.trips.values()].filter((t) => t.dirty).slice(0, BATCH - dirtyRates.length);
    const dirtyFuel = [...store.fuel.values()].filter((f) => f.dirty).slice(0, Math.max(0, BATCH - dirtyRates.length - dirtyTrips.length));
    const sent = new Map([...dirtyRates, ...dirtyTrips, ...dirtyFuel].map((r) => [r.id, r.updatedAt]));

    const sentSettings = store.meta.periodSettings;
    const res = await api('POST', '/sync', {
      periodSettings: sentSettings?.dirty ? { days: sentSettings.days, updatedAt: sentSettings.updatedAt } : undefined,
      epoch: store.meta.epoch ?? null,
      cursor: store.meta.cursor ?? 0,
      rates: dirtyRates.map(strip),
      trips: dirtyTrips.map(strip),
      fuel: dirtyFuel.map(strip),
    });

    if (res.periodSettings) {
      const local = store.meta.periodSettings;
      if (!local?.dirty || Date.parse(local.updatedAt) <= Date.parse(res.periodSettings.updatedAt)) {
        await store.setMeta('periodSettings', { ...res.periodSettings, dirty: false });
      }
    }
    if (res.reset) {
      // Server data was restored from a backup (or this is a new device): drop the synced copy.
      const clean = (kind) => [...store[kind].values()].filter((r) => !r.dirty).map((r) => r.id);
      await store.remove('trips', clean('trips'));
      await store.remove('rates', clean('rates'));
      await store.remove('fuel', clean('fuel'));
    }

    const rejected = new Set((res.rejected || []).map((r) => r.id));
    const tidy = (kind, list) => {
      // Rows we sent that the server accepted (or overruled with a newer copy) are no longer pending.
      const fromServer = new Set((res[kind] || []).map((r) => r.id));
      const out = [];
      for (const row of list) {
        const now = store[kind].get(row.id);
        if (!now || now.updatedAt !== sent.get(row.id) || fromServer.has(row.id)) continue;
        out.push({ ...now, dirty: false, rejected: rejected.has(row.id) });
      }
      return out;
    };

    await store.put('rates', [...merge('rates', res.rates), ...tidy('rates', dirtyRates)]);
    await store.put('trips', [...merge('trips', res.trips), ...tidy('trips', dirtyTrips)]);
    await store.put('fuel', [...merge('fuel', res.fuel || []), ...tidy('fuel', dirtyFuel)]);
    await store.setMeta('epoch', res.epoch);
    await store.setMeta('cursor', res.cursor);

    const stillDirty = [...store.rates.values(), ...store.trips.values(), ...store.fuel.values()].some((r) => r.dirty);
    if (!store.meta.periodSettings?.dirty && (!stillDirty || sent.size === 0)) break;
  }
  await uploadReceipts();
  await store.setMeta('lastSync', new Date().toISOString());
}

/** Send receipt photos taken on this phone. Each is retried until the server has it. */
async function uploadReceipts() {
  for (const meta of [...store.files.values()]) {
    if (meta.uploaded || meta.failed) continue;
    const rec = await store.getFile(meta.id);
    if (!rec?.blob) continue;
    try {
      await uploadFile(rec.id, rec.blob, rec.mime);
      await store.markFile(rec.id, { uploaded: true });
    } catch (e) {
      // 4xx (other than auth) means the server will never accept it: stop retrying, keep it on the phone.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401) {
        await store.markFile(rec.id, { failed: e.message });
      } else {
        throw e;
      }
    }
  }
}

export async function sync() {
  if (!store.db) return;
  if (running) { again = true; return running; }
  setStatus({ state: 'syncing', error: null });
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
      setStatus({ state: 'idle', lastSync: new Date().toISOString(), error: null });
    } catch (e) {
      setStatus({ state: e instanceof OfflineError ? 'offline' : 'error', error: e.message });
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer = null;
/** Sync shortly after a local change, so a burst of edits goes up together. */
export function syncSoon(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(sync, delay);
}

let interval = null;
export function startAutoSync() {
  stopAutoSync();
  sync();
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  interval = setInterval(sync, 2 * 60 * 1000);
}
export function stopAutoSync() {
  clearInterval(interval);
  clearTimeout(timer);
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
}
function onOnline() { setStatus({ state: 'idle' }); sync(); }
function onVisible() { if (document.visibilityState === 'visible') sync(); }

