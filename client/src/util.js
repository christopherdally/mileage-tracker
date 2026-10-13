// Dates are always local calendar dates as 'YYYY-MM-DD' strings — never Date objects in storage.
const pad = (n) => String(n).padStart(2, '0');

export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISODate(new Date());

export function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 13 Oct 2026 */
export function fmtDate(s, { year = true, weekday = false } = {}) {
  if (!s) return '';
  const d = parseISODate(s);
  return `${weekday ? DAYS[d.getDay()] + ' ' : ''}${d.getDate()} ${MONTHS[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
}
export const monthName = (s) => { const d = parseISODate(s); return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`; };

export function fmtRange(from, to) {
  if (!to) return `From ${fmtDate(from)}`;
  return `${fmtDate(from)} to ${fmtDate(to)}`;
}

export const fmtMiles = (n) => (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtPounds = (pence) =>
  '£' + ((Number(pence) || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 45p, 48.5p */
export const fmtRate = (pence) => `${Number(pence).toLocaleString('en-GB', { maximumFractionDigits: 2 })}p`;

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Claim periods: many employers run monthly claims from e.g. the 26th to the 25th.
 * startDay = 1 means calendar months.
 */
export function claimPeriod(dateStr, startDay = 1, offset = 0) {
  const d = parseISODate(dateStr);
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < startDay) m -= 1;
  m += offset;
  const from = new Date(y, m, startDay);
  const to = new Date(y, m + 1, startDay);
  to.setDate(to.getDate() - 1);
  return { from: toISODate(from), to: toISODate(to) };
}

export const roundTenth = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** 1 journey, 2 journeys */
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
