// Bulk import of journeys from a CSV file, e.g. a spreadsheet kept before using the app
// or a file from this app's own export.
import { parseISODate, toISODate, roundTenth } from './util.js';

const MAX_ROWS = 5000;

/** CSV text to rows of cells. Handles quoted cells, doubled quotes, CRLF or LF, and a byte-order mark. */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  // Spreadsheets in some locales save with semicolons or tabs; go by the header line.
  const head = s.slice(0, s.search(/\r?\n|$/));
  const sep = [',', ';', '\t'].map((c) => [c, head.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Column headings we recognise, lower-cased with punctuation removed.
const COLUMNS = {
  date: ['date', 'trip date', 'journey date', 'day'],
  description: ['journey', 'description', 'where and why', 'purpose', 'details', 'reason', 'notes', 'destination'],
  miles: ['miles', 'business miles', 'distance', 'mileage', 'total miles'],
  start: ['start odometer', 'start reading', 'start', 'odometer start', 'start mileage'],
  end: ['end odometer', 'end reading', 'end', 'odometer end', 'end mileage'],
  vehicle: ['vehicle', 'car'],
  rate: ['pence per mile', 'rate', 'custom rate'],
  rateType: ['rate type'],
};
const norm = (h) => String(h).toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** '2026-10-02', '02/10/2026', '2.10.26' or '2 Oct 2026' (day first, as in the UK) to 'YYYY-MM-DD', or null. */
export function readDate(v) {
  const s = String(v).trim();
  let y, m, d;
  let match;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [, y, m, d] = match.map(Number);
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s))) { [, d, m, y] = match.map(Number); if (y < 100) y += 2000; }
  else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([a-z]{3})[a-z]*[ -](\d{4}|\d{2})$/i.exec(s))) {
    d = Number(match[1]); m = MONTHS.indexOf(match[2].toLowerCase()) + 1; y = Number(match[3]); if (y < 100) y += 2000;
  } else return null;
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return toISODate(parseISODate(iso)) === iso ? iso : null;
}

/** '1,234.5', '42.5 miles' or '' to a number, null when empty, NaN when it isn't a number. */
function readNumber(v) {
  const s = String(v ?? '').trim().replace(/,/g, '').replace(/\s*(miles?|mi|p)$/i, '');
  if (!s) return null;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

const sameJourney = (a, b) => a.tripDate === b.tripDate && Number(a.miles) === Number(b.miles)
  && (a.description || '') === (b.description || '') && (a.startOdometer ?? null) === (b.startOdometer ?? null);

/**
 * Read journeys out of CSV text.
 *   vehicles: the user's current vehicles, matched by name against a Vehicle column
 *   existing: journeys already logged, so the same file can't be imported twice
 * Returns { rows, skipped: [{ line, reason }], duplicates } or { error } when the file can't be used at all.
 */
export function readJourneys(text, { vehicles = [], existing = [] } = {}) {
  const table = parseCsv(text);
  if (table.length < 2) return { error: "That file doesn't have a heading row followed by journeys." };
  const headings = table[0].map(norm);
  const col = {};
  for (const [key, names] of Object.entries(COLUMNS)) col[key] = headings.findIndex((h) => names.includes(h));
  if (col.date < 0) return { error: 'No Date column found. The first row needs headings such as Date, Journey and Miles.' };
  if (col.miles < 0 && (col.start < 0 || col.end < 0)) return { error: 'No Miles column found (or Start odometer and End odometer columns to work the miles out from).' };
  if (table.length - 1 > MAX_ROWS) return { error: `That file has more than ${MAX_ROWS.toLocaleString('en-GB')} rows. Split it and import it in parts.` };

  const byName = new Map(vehicles.map((v) => [v.name.trim().toLowerCase(), v.id]));
  const only = vehicles.length === 1 ? vehicles[0].id : null;
  const rows = [];
  const skipped = [];
  const unmatched = existing.filter((t) => !t.deleted);
  let duplicates = 0;
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (key) => (col[key] >= 0 ? (cells[col[key]] ?? '').trim() : '');
    const skip = (reason) => skipped.push({ line, reason });
    const tripDate = readDate(get('date'));
    if (!tripDate) return skip(get('date') ? `"${get('date')}" isn't a date` : 'no date');
    const start = readNumber(get('start'));
    const end = readNumber(get('end'));
    if (Number.isNaN(start) || Number.isNaN(end)) return skip('odometer reading is not a number');
    const hasOdo = start !== null && end !== null;
    if (hasOdo && end < start) return skip('end reading is lower than the start');
    let miles = readNumber(get('miles'));
    if (Number.isNaN(miles)) return skip(`"${get('miles')}" isn't a number of miles`);
    if (miles === null) miles = hasOdo ? end - start : null;
    if (miles === null) return skip('no miles');
    if (miles > 100000) return skip('too many miles for one journey');
    // The rate column is only a per-journey rate when the file says so (as this app's export does).
    const custom = col.rateType >= 0 ? /custom/i.test(get('rateType')) : headings[col.rate] === 'custom rate';
    const rate = custom ? readNumber(get('rate')) : null;
    if (Number.isNaN(rate)) return skip('custom rate is not a number');
    const row = {
      tripDate,
      description: get('description').replace(/^'(?=[=+\-@])/, '').slice(0, 500),
      startOdometer: hasOdo ? start : null,
      endOdometer: hasOdo ? end : null,
      miles: roundTenth(miles),
      rateOverridePence: rate,
      vehicleId: byName.get(get('vehicle').toLowerCase()) ?? only,
    };
    // Each journey already logged cancels one matching row, so two identical legs in a day both survive
    // a first import and are both skipped on a second.
    const match = unmatched.findIndex((t) => sameJourney(t, row));
    if (match >= 0) { unmatched.splice(match, 1); duplicates++; return undefined; }
    rows.push(row);
    return undefined;
  });
  return { rows, skipped, duplicates };
}
