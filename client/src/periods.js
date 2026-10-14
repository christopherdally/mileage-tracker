import { addDays, toISODate } from './util.js';

export function shiftMonth(month, offset) {
  const [y, m] = month.split('-').map(Number);
  return toISODate(new Date(y, m - 1 + offset, 1)).slice(0, 7);
}
export function cutoff(month, kind, settings = {}) {
  const [y, m] = month.split('-').map(Number);
  const day = settings[`${kind}:${month}`] ?? (kind === 'fuel' ? 7 : 9);
  return toISODate(new Date(y, m - 1, Math.min(day, new Date(y, m, 0).getDate())));
}
export function reportPeriod(month, kind, settings = {}) {
  return { from: addDays(cutoff(shiftMonth(month, -1), kind, settings), 1), to: cutoff(month, kind, settings) };
}
export function currentMonth(date, kind, settings = {}) {
  const month = date.slice(0, 7);
  return date <= cutoff(month, kind, settings) ? month : shiftMonth(month, 1);
}
export function dueSoon(date, kind, settings = {}) {
  const end = cutoff(currentMonth(date, kind, settings), kind, settings);
  return date >= addDays(end, -3) ? end : null;
}
