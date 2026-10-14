// Mileage claim PDF, built on the device with pdf-lib (works offline).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fmtDate, fmtMiles, fmtPounds, fmtRate, today, parseISODate, plural } from './util.js';

const A4 = [595.28, 841.89];
const M = 42; // page margin
const C = {
  ink: rgb(0.12, 0.137, 0.149),
  muted: rgb(0.38, 0.41, 0.43),
  rule: rgb(0.835, 0.851, 0.863),
  blue: rgb(0.114, 0.353, 0.651),
  band: rgb(0.93, 0.945, 0.965),
  warn: rgb(0.776, 0.231, 0.18),
};

const longDate = (s) => {
  const d = parseISODate(s);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

export async function buildClaimPdf({ report, rates, user, fuel = null }) {
  const hasFuel = fuel && fuel.count > 0;
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Mileage claim ${report.from} to ${report.to}`);
  doc.setAuthor(user.displayName || user.username);
  doc.setCreator('Mileage Tracker');

  // Standard PDF fonts only cover Western European characters; fall back gracefully (ŵ → w).
  const safe = (font, text) => {
    let out = '';
    const swapped = String(text ?? '').replace(/[\u2192\u27a1]/g, '-').replace(/[\u2190]/g, '-');
    for (const ch of swapped) {
      try { font.encodeText(ch); out += ch; } catch {
        const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        try { font.encodeText(base); out += base; } catch { out += '?'; }
      }
    }
    return out;
  };
  const width = (font, text, size) => font.widthOfTextAtSize(safe(font, text), size);

  let page;
  let y;
  const pages = [];
  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
  };
  const text = (s, x, size = 9.5, font = reg, color = C.ink) => page.drawText(safe(font, s), { x, y, size, font, color });
  const right = (s, xRight, size = 9.5, font = reg, color = C.ink) => text(s, xRight - width(font, s, size), size, font, color);
  const rule = (yy = y, color = C.rule, thickness = 0.6) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: A4[0] - M, y: yy }, thickness, color });
  const ensure = (h, onNewPage) => {
    if (y - h < M + 30) { newPage(); onNewPage?.(); }
  };
  const wrap = (font, s, size, maxW) => {
    const words = safe(font, s).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (width(font, t, size) <= maxW) line = t;
      else { if (line) lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };

  const name = user.displayName || user.username;
  const W = A4[0] - 2 * M;

  // ── Header ──
  newPage();
  text('Mileage claim', M, 22, bold);
  y -= 26;
  text(`${longDate(report.from)} to ${longDate(report.to)}`, M, 12, reg, C.muted);
  y -= 26;

  const meta = [
    ['Name', name],
    ['Vehicle', user.vehicle || 'Not recorded'],
    ['Prepared', longDate(today())],
    ...(fuel?.from && fuel?.to ? [['Fuel period', `${longDate(fuel.from)} to ${longDate(fuel.to)}`]] : []),
  ];
  for (const [k, v] of meta) {
    text(k, M, 9.5, reg, C.muted);
    text(v, M + 70, 9.5, bold);
    y -= 15;
  }
  y -= 8;

  // ── Summary band ──
  const bandH = 58;
  page.drawRectangle({ x: M, y: y - bandH, width: W, height: bandH, color: C.band });
  const cols = [
    ['Business miles', fmtMiles(report.totalMiles)],
    ['Journeys', String(report.tripCount)],
    ['Days driven', String(report.days)],
    ['Amount claimed', fmtPounds(report.totalPence)],
  ];
  const cw = W / cols.length;
  cols.forEach(([k, v], i) => {
    const x = M + 14 + i * cw;
    const save = y;
    y -= 20;
    text(k, x, 8.5, reg, C.muted);
    y -= 22;
    text(v, x, i === 3 ? 17 : 15, bold, i === 3 ? C.blue : C.ink);
    y = save;
  });
  y -= bandH + 26;

  // ── Workings ──
  text('How the amount is worked out', M, 13, bold);
  y -= 8;
  rule();
  y -= 18;

  if (!report.groups.length) {
    text('No journeys were logged in this period.', M, 10, reg, C.muted);
    y -= 18;
  }
  for (const g of report.groups) {
    ensure(48);
    const covered = g.source === 'period'
      ? `Rate period ${fmtDate(g.periodStart)} to ${g.periodEnd ? fmtDate(g.periodEnd) : 'ongoing'}`
      : g.source === 'custom' ? 'Rate entered on individual journeys' : 'Add a rate period that covers these dates';
    text(g.label, M, 10.5, bold, g.source === 'none' ? C.warn : C.ink);
    right(g.source === 'none' ? 'Not claimed' : fmtPounds(g.amountPence), A4[0] - M, 10.5, bold, g.source === 'none' ? C.warn : C.ink);
    y -= 14;
    text(`${covered}. Journeys ${fmtDate(g.firstDate)} to ${fmtDate(g.lastDate)}: ${plural(g.trips.length, 'journey')}.`, M, 8.8, reg, C.muted);
    y -= 14;
    const sum = g.source === 'none'
      ? `${fmtMiles(g.miles)} miles with no rate, so nothing is claimed for them`
      : `${fmtMiles(g.miles)} miles × ${fmtRate(g.pence)} per mile = ${fmtMiles(g.miles)} × £${(g.pence / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} = ${fmtPounds(g.amountPence)}`;
    text(sum, M + 12, 9.5, reg, g.source === 'none' ? C.warn : C.ink);
    y -= 20;
  }
  ensure(30);
  rule(y + 6, C.ink, 0.9);
  y -= 10;
  const totalParts = report.groups.filter((g) => g.source !== 'none').map((g) => fmtPounds(g.amountPence));
  text(totalParts.length > 1 ? `Total  (${totalParts.join(' + ')})` : 'Total', M, 11, bold);
  right(fmtPounds(report.totalPence), A4[0] - M, 11, bold, C.blue);
  y -= 30;

  // ── Fuel paid compared with the claim ──
  if (hasFuel) {
    ensure(90);
    text('Fuel paid compared with the claim', M, 13, bold);
    y -= 8;
    rule();
    y -= 16;
    const diff = report.totalPence - fuel.totalPence;
    const rows = [
      ['Amount claimed for mileage', fmtPounds(report.totalPence), reg, C.ink],
      [`Fuel paid (${plural(fuel.count, 'purchase')}, listed below)`, fmtPounds(fuel.totalPence), reg, C.ink],
      [diff >= 0 ? 'Claim is more than fuel paid by' : 'Fuel paid is more than the claim by', fmtPounds(Math.abs(diff)), bold, diff >= 0 ? C.blue : C.warn],
    ];
    for (const [k, v, f, col] of rows) {
      text(k, M, 10, f);
      right(v, A4[0] - M, 10, f, col);
      y -= 16;
    }
    if (fuel.avgPencePerLitre) {
      text(`${fuel.litres.toLocaleString('en-GB', { maximumFractionDigits: 2 })} litres at an average of ${fuel.avgPencePerLitre.toFixed(1)}p per litre.`, M, 8.8, reg, C.muted);
      y -= 14;
    }
    y -= 16;
  }

  // ── Rate periods ──
  const used = rates
    .filter((r) => !r.deleted && r.startDate <= report.to && (!r.endDate || r.endDate >= report.from))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  if (used.length) {
    ensure(60);
    text('Rates in force during this period', M, 13, bold);
    y -= 8;
    rule();
    y -= 15;
    const rx = [M, M + 200, M + 300, A4[0] - M];
    text('Rate', rx[0], 8.5, bold, C.muted); text('From', rx[1], 8.5, bold, C.muted); text('To', rx[2], 8.5, bold, C.muted);
    right('Pence per mile', rx[3], 8.5, bold, C.muted);
    y -= 14;
    for (const r of used) {
      ensure(16);
      text(r.label || 'Rate', rx[0]); text(fmtDate(r.startDate), rx[1]); text(r.endDate ? fmtDate(r.endDate) : 'Ongoing', rx[2]);
      right(fmtRate(r.pencePerMile), rx[3]);
      y -= 14;
    }
    y -= 18;
  }

  // ── Journey log ──
  // Right-hand edges of the numeric columns, left edges of the text columns.
  const X = { date: M, desc: M + 68, start: M + 312, end: M + 366, miles: M + 410, rate: M + 455, amt: A4[0] - M };
  const DESC_W = X.start - 52 - X.desc;
  const header = () => {
    text('Date', X.date, 8.5, bold, C.muted);
    text('Journey', X.desc, 8.5, bold, C.muted);
    right('Start', X.start, 8.5, bold, C.muted);
    right('End', X.end, 8.5, bold, C.muted);
    right('Miles', X.miles, 8.5, bold, C.muted);
    right('Rate', X.rate, 8.5, bold, C.muted);
    right('Amount', X.amt, 8.5, bold, C.muted);
    y -= 6;
    rule();
    y -= 13;
  };
  ensure(80);
  text('Journey log', M, 13, bold);
  y -= 8;
  rule();
  y -= 15;
  header();

  const odo = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  for (const line of report.lines) {
    const t = line.trip;
    const desc = wrap(reg, t.description || 'Business journey', 9, DESC_W).slice(0, 3);
    const h = 13 * desc.length + 2;
    ensure(h, () => { text('Journey log (continued)', M, 10, bold, C.muted); y -= 16; header(); });
    text(fmtDate(t.tripDate, { weekday: true, year: false }), X.date, 9);
    desc.forEach((l, i) => page.drawText(l, { x: X.desc, y: y - i * 13, size: 9, font: reg, color: C.ink }));
    right(odo(t.startOdometer), X.start, 9);
    right(odo(t.endOdometer), X.end, 9);
    right(fmtMiles(t.miles), X.miles, 9);
    right(line.pence === null ? 'None' : fmtRate(line.pence) + (line.source === 'custom' ? '*' : ''), X.rate, 9, reg, line.pence === null ? C.warn : C.ink);
    right(line.amountPence === null ? '-' : fmtPounds(line.amountPence), X.amt, 9);
    y -= h;
  }
  ensure(40);
  rule(y + 6, C.ink, 0.9);
  y -= 8;
  text(plural(report.tripCount, 'journey'), X.date, 9.5, bold);
  right(fmtMiles(report.totalMiles), X.miles, 9.5, bold);
  right(fmtPounds(report.totalPence), X.amt, 9.5, bold);
  y -= 18;

  const notes = [
    'Amounts are total miles × rate for each rate, rounded to the nearest penny once, so journey amounts may differ by a penny from the total.',
  ];
  if (report.lines.some((l) => l.source === 'custom')) notes.push('* Rate entered for that journey instead of the rate period.');
  if (report.unratedMiles > 0) notes.push(`${fmtMiles(report.unratedMiles)} miles fall outside any rate period and are not included in the amount claimed.`);
  for (const n of notes) {
    for (const l of wrap(reg, n, 8, W)) { ensure(12); text(l, M, 8, reg, C.muted); y -= 11; }
  }

  // ── Fuel purchases (receipt photos are kept in the app, not reproduced here) ──
  if (hasFuel) {
    const F = { date: M, where: M + 68, litres: M + 330, ppl: M + 392, receipt: M + 440, amt: A4[0] - M };
    const fHeader = () => {
      text('Date', F.date, 8.5, bold, C.muted);
      text('Where', F.where, 8.5, bold, C.muted);
      right('Litres', F.litres, 8.5, bold, C.muted);
      right('p/litre', F.ppl, 8.5, bold, C.muted);
      text('Receipt', F.receipt, 8.5, bold, C.muted);
      right('Paid', F.amt, 8.5, bold, C.muted);
      y -= 6;
      rule();
      y -= 13;
    };
    y -= 14;
    ensure(70);
    text('Fuel purchases', M, 13, bold);
    y -= 8;
    rule();
    y -= 15;
    fHeader();
    for (const f of fuel.lines) {
      const where = wrap(reg, f.description || 'Fuel', 9, F.litres - 50 - F.where).slice(0, 2);
      const h = 13 * where.length + 2;
      ensure(h, () => { text('Fuel purchases (continued)', M, 10, bold, C.muted); y -= 16; fHeader(); });
      text(fmtDate(f.purchaseDate, { weekday: true, year: false }), F.date, 9);
      where.forEach((l, i) => page.drawText(l, { x: F.where, y: y - i * 13, size: 9, font: reg, color: C.ink }));
      right(f.litres ? Number(f.litres).toLocaleString('en-GB', { maximumFractionDigits: 2 }) : '', F.litres, 9);
      right(Number(f.litres) > 0 ? (f.amountPence / f.litres).toFixed(1) : '', F.ppl, 9);
      const n = f.receiptIds?.length || 0;
      text(n ? (n === 1 ? 'Held' : `${n} held`) : 'None', F.receipt, 9, reg, n ? C.ink : C.warn);
      right(fmtPounds(f.amountPence), F.amt, 9);
      y -= h;
    }
    ensure(24);
    rule(y + 6, C.ink, 0.9);
    y -= 8;
    text(plural(fuel.count, 'purchase'), F.date, 9.5, bold);
    if (fuel.litres) right(fuel.litres.toLocaleString('en-GB', { maximumFractionDigits: 2 }), F.litres, 9.5, bold);
    right(fmtPounds(fuel.totalPence), F.amt, 9.5, bold);
    y -= 16;
    for (const l of wrap(reg, 'Fuel is shown for comparison only and is not part of the amount claimed. Receipts marked Held are stored with the entry and available on request.', 8, W)) {
      ensure(12); text(l, M, 8, reg, C.muted); y -= 11;
    }
  }

  // ── Sign-off ──
  ensure(90);
  y -= 30;
  const sig = (label, x) => {
    page.drawLine({ start: { x, y }, end: { x: x + 220, y }, thickness: 0.6, color: C.ink });
    page.drawText(label, { x, y: y - 12, size: 8.5, font: reg, color: C.muted });
  };
  sig('Claimant signature and date', M);
  sig('Approved by and date', A4[0] - M - 220);

  // ── Footers ──
  pages.forEach((p, i) => {
    const f = `${safe(reg, name)}  |  ${fmtDate(report.from)} to ${fmtDate(report.to)}  |  Page ${i + 1} of ${pages.length}`;
    p.drawText(f, { x: M, y: 24, size: 7.5, font: reg, color: C.muted });
  });

  return doc.save();
}

export function claimFilename(report, user) {
  const who = (user.displayName || user.username).replace(/[^\w-]+/g, '-');
  return `mileage-claim_${who}_${report.from}_to_${report.to}.pdf`;
}

