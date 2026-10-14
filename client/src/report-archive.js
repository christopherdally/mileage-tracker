import { api } from './api.js';
export async function archivePdf(blob, month, filename) {
  if (blob.size > 3 * 1024 * 1024) throw new Error('Choose a PDF up to 3 MB');
  const pdf = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read PDF'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
  return api('POST', '/report-archives', { month, filename, pdf });
}
