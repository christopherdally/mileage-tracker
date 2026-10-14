import { HttpError } from './http.js';
export function validateReportUpload(body, currentMonth) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || '') || body.month >= currentMonth) throw new HttpError(400, 'Choose a previous report month');
  if (typeof body.pdf !== 'string' || body.pdf.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.pdf)) throw new HttpError(400, 'Upload a PDF up to 3 MB');
  const data = Buffer.from(body.pdf, 'base64');
  if (data.length > 3 * 1024 * 1024 || data.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'Upload a valid PDF up to 3 MB');
  return { data, month: body.month, filename: String(body.filename || 'claim-report.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150).replace(/(?:\.pdf)?$/i, '.pdf') };
}
