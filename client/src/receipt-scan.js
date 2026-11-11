import { createWorker } from 'tesseract.js';
import { parseReceiptText } from './receipt-text.js';

// The worker, WASM core and English data are copied here by build.mjs so nothing is fetched from a CDN.
const OCR_PATH = new URL(__TESSERACT_PATH__, location.origin).href;

export async function scanReceipt(blob, onProgress, signal) {
  if (!blob.type.startsWith('image/')) throw new Error('Choose a receipt photo. PDF receipts can still be attached manually.');
  if (signal?.aborted) throw new Error('Scan cancelled');
  let worker;
  let finished = false;
  let timer;
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(new Error('Scan cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new Error('Scan timed out. Try a clearer photo or enter the details manually.')), 90000);
  });
  try {
    const work = (async () => {
      worker = await createWorker('eng', 1, {
        workerPath: `${OCR_PATH}/worker.min.js`,
        corePath: OCR_PATH,
        langPath: OCR_PATH,
        workerBlobURL: false,
        logger: m => onProgress?.(m.status === 'recognizing text' ? `Reading receipt: ${Math.round((m.progress || 0) * 100)}%` : 'Preparing receipt scanner…'),
      });
      if (finished || signal?.aborted) { await worker.terminate(); throw new Error('Scan cancelled'); }
      const { data } = await worker.recognize(blob);
      return { text: data.text, fields: parseReceiptText(data.text) };
    })();
    return await Promise.race([work, stopped]);
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await worker?.terminate();
  }
}
