// Offline-first store: everything lives in IndexedDB on the device (one database per user)
// and is mirrored in memory for instant reads. Edits are marked `dirty` until the server has them.
import { useSyncExternalStore } from 'react';

const STORES = ['trips', 'rates', 'fuel', 'meta'];
const KEYED = ['trips', 'rates', 'fuel', 'meta', 'files'];

function idbOpen(name) {
  return new Promise((resolve, reject) => {
    // v2 added fuel purchases and receipt files.
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of KEYED) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export class Store {
  constructor() {
    this.db = null;
    this.trips = new Map();
    this.rates = new Map();
    this.fuel = new Map();
    this.files = new Map(); // receipt metadata only: { id, mime, size, uploaded, failed }
    this.meta = {};
    this.version = 0;
    this.listeners = new Set();
    this.snapshot = null;
  }

  async open(userId) {
    this.db = await idbOpen(`mileage-${userId}`);
    const tx = this.db.transaction([...STORES, 'files'], 'readonly');
    // Issue every read before awaiting, so the transaction stays active.
    const [trips, rates, fuel, meta, files] = await Promise.all([...STORES, 'files'].map((s) => reqP(tx.objectStore(s).getAll())));
    this.trips = new Map(trips.map((t) => [t.id, t]));
    this.rates = new Map(rates.map((r) => [r.id, r]));
    this.fuel = new Map(fuel.map((f) => [f.id, f]));
    this.files = new Map(files.map(({ blob, ...m }) => [m.id, m])); // eslint-disable-line no-unused-vars
    this.meta = Object.fromEntries(meta.map((m) => [m.key, m.value]));
    this.emit();
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  // ── subscription for React ──
  subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  emit() {
    this.version++;
    this.snapshot = null;
    this.listeners.forEach((fn) => fn());
  }
  getSnapshot = () => {
    if (!this.snapshot) {
      const trips = [...this.trips.values()];
      const rates = [...this.rates.values()];
      const fuel = [...this.fuel.values()];
      const files = [...this.files.values()];
      this.snapshot = {
        version: this.version,
        trips,
        rates,
        fuel,
        liveTrips: trips.filter((t) => !t.deleted),
        liveRates: rates.filter((r) => !r.deleted),
        liveFuel: fuel.filter((f) => !f.deleted),
        files: this.files,
        pendingFiles: files.filter((f) => !f.uploaded && !f.failed).length,
        pending: [...trips, ...rates, ...fuel].filter((r) => r.dirty).length + files.filter((f) => !f.uploaded && !f.failed).length,
        meta: this.meta,
      };
    }
    return this.snapshot;
  };

  // ── writes ──
  async put(kind, rows) {
    const map = this[kind];
    const tx = this.db.transaction(kind, 'readwrite');
    const os = tx.objectStore(kind);
    for (const r of rows) { map.set(r.id, r); os.put(r); }
    await txDone(tx);
    this.emit();
  }

  async remove(kind, ids) {
    const map = this[kind];
    const tx = this.db.transaction(kind, 'readwrite');
    const os = tx.objectStore(kind);
    for (const id of ids) { map.delete(id); os.delete(id); }
    await txDone(tx);
    this.emit();
  }

  // ── receipt files (blobs live only in IndexedDB, not in memory) ──
  async putFile(rec) {
    const tx = this.db.transaction('files', 'readwrite');
    tx.objectStore('files').put(rec);
    await txDone(tx);
    const { blob, ...meta } = rec; // eslint-disable-line no-unused-vars
    this.files.set(rec.id, meta);
    this.emit();
  }

  async getFile(id) {
    if (!this.db) return null;
    return reqP(this.db.transaction('files', 'readonly').objectStore('files').get(id));
  }

  async markFile(id, patch) {
    const rec = await this.getFile(id);
    if (rec) await this.putFile({ ...rec, ...patch });
  }

  async setMeta(key, value) {
    this.meta = { ...this.meta, [key]: value };
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    await txDone(tx);
    this.emit();
  }

  /** Save a local edit. The timestamp always moves forward so this edit beats the version it replaced. */
  async save(kind, row) {
    const prev = this[kind].get(row.id);
    const now = Date.now();
    const prevT = prev ? Date.parse(prev.updatedAt) || 0 : 0;
    const updatedAt = new Date(Math.max(now, prevT + 1)).toISOString();
    await this.put(kind, [{ ...prev, ...row, updatedAt, dirty: true, rejected: false }]);
  }

  async softDelete(kind, id) {
    const prev = this[kind].get(id);
    if (prev) await this.save(kind, { ...prev, deleted: true });
  }
}

export const store = new Store();

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
