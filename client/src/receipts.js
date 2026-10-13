// Receipt photos: shrink on the phone, keep in IndexedDB, upload in the background.
import { store } from './store.js';
import { fetchFile } from './api.js';
import { uuid } from './util.js';

const MAX_SIDE = 1800;          // pixels on the longest side; plenty to read a till receipt
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

async function shrink(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // e.g. HEIC on browsers that can't decode it: keep the original
  }
}

/** Save picked files as receipts. Returns the new receipt ids; throws with a readable message. */
export async function addReceipts(fileList) {
  const ids = [];
  for (const file of fileList) {
    const type = (file.type || '').toLowerCase();
    if (!ALLOWED.includes(type)) throw new Error(`${file.name || 'That file'} isn't a photo or PDF`);
    const blob = await shrink(file);
    if (blob.size > MAX_BYTES) throw new Error(`${file.name || 'That file'} is over 10 MB`);
    const id = uuid();
    await store.putFile({ id, blob, mime: blob.type || type, size: blob.size, uploaded: false, failed: null, createdAt: new Date().toISOString() });
    ids.push(id);
  }
  return ids;
}

/** Get a receipt as a Blob: from this phone if we have it, otherwise from the server (then keep a copy). */
export async function getReceiptBlob(id) {
  const rec = await store.getFile(id);
  if (rec?.blob) return rec.blob;
  const blob = await fetchFile(id);
  await store.putFile({ id, blob, mime: blob.type, size: blob.size, uploaded: true, failed: null });
  return blob;
}
