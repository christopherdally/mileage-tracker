// Spreadsheet exports of the journeys and fuel behind a claim report.
import { pencePerLitre } from './calc.js';
import { vehicleName } from './vehicles.js';

function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Text that a spreadsheet would run as a formula is made inert with a leading apostrophe.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells to CSV text. The byte-order mark and CRLF line ends are what Excel expects. */
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

const pounds = (pence) => (pence === null || pence === undefined ? '' : (pence / 100).toFixed(2));
const num = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));
const RATE_TYPE = { period: 'Rate period', custom: 'Custom rate', none: 'No rate' };

/** One row per journey in a report from buildReport(). */
export function journeysCsv(report, vehicles = []) {
  return toCsv([
    ['Date', 'Vehicle', 'Journey', 'Start odometer', 'End odometer', 'Miles', 'Pence per mile', 'Rate type', 'Amount (GBP)'],
    ...report.lines.map(({ trip: t, pence, source, amountPence }) => [
      t.tripDate, vehicleName(vehicles, t.vehicleId), t.description || '', num(t.startOdometer), num(t.endOdometer),
      Number(t.miles).toFixed(1), num(pence), RATE_TYPE[source], pounds(amountPence),
    ]),
  ]);
}

/** One row per purchase in a summary from fuelSummary(). */
export function fuelCsv(fuel, vehicles = []) {
  return toCsv([
    ['Date', 'Vehicle', 'Where', 'Litres', 'Pence per litre', 'Odometer', 'Receipts', 'Amount paid (GBP)'],
    ...fuel.lines.map((f) => [
      f.purchaseDate, vehicleName(vehicles, f.vehicleId), f.description || '', num(f.litres), num(pencePerLitre(f)),
      num(f.odometer), f.receiptIds?.length || 0, pounds(f.amountPence),
    ]),
  ]);
}

export function csvFilename(kind, { from, to }, user) {
  const who = (user.displayName || user.username).replace(/[^\w-]+/g, '-');
  return `${kind}_${who}_${from}_to_${to}.csv`;
}
