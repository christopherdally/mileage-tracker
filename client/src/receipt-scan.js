import { parseReceiptText } from './receipt-text.js';

export async function scanReceipt(blob, onProgress, signal) {
  if (!blob.type.startsWith('image/')) throw new Error('Choose a receipt photo. PDF receipts can still be attached manually.');
  const { createWorker } = await import('tesseract.js');
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
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
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
