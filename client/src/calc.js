// Mileage claim maths, shared by the app screens and the PDF so both always agree.
import { fmtRate } from './util.js';

const live = (rows) => rows.filter((r) => !r.deleted);

/** The rate period covering a date. If periods overlap, the one that started most recently wins. */
export function periodFor(date, rates) {
  let best = null;
  for (const p of live(rates)) {
    if (p.startDate <= date && (!p.endDate || date <= p.endDate)) {
      if (!best || p.startDate > best.startDate || (p.startDate === best.startDate && p.updatedAt > best.updatedAt)) best = p;
    }
  }
  return best;
}

/** Rate (pence per mile) used for one trip, and where it came from. */
export function rateForTrip(trip, rates) {
  if (trip.rateOverridePence !== null && trip.rateOverridePence !== undefined && trip.rateOverridePence !== '') {
    return { pence: Number(trip.rateOverridePence), source: 'custom', period: null };
  }
  const period = periodFor(trip.tripDate, rates);
  return period ? { pence: Number(period.pencePerMile), source: 'period', period } : { pence: null, source: 'none', period: null };
}

// Work in tenths of a mile (integers) so totals never drift.
const tenths = (miles) => Math.round(Number(miles) * 10);
const penceFor = (milesTenths, pence) => Math.round((milesTenths * pence) / 10 + 1e-9);

/**
 * Build a claim report for a date range.
 * Trips are grouped by the rate that applies to them; each group's amount is
 * total miles × rate, rounded to the penny once. The claim total is the sum of group amounts.
 */
export function buildReport({ trips, rates, from, to }) {
  const rows = live(trips)
    .filter((t) => t.tripDate >= from && t.tripDate <= to)
    .sort((a, b) => (a.tripDate === b.tripDate ? (a.startOdometer ?? 0) - (b.startOdometer ?? 0) : a.tripDate < b.tripDate ? -1 : 1));

  const groups = new Map();
  const lines = rows.map((t) => {
    const r = rateForTrip(t, rates);
    const key = r.source === 'custom' ? `custom:${r.pence}` : r.source === 'period' ? `period:${r.period.id}` : 'none';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        source: r.source,
        pence: r.pence,
        label:
          r.source === 'period' ? r.period.label || `${fmtRate(r.pence)} per mile`
          : r.source === 'custom' ? `Custom rate ${fmtRate(r.pence)} per mile`
          : 'No rate set for these dates',
        periodStart: r.period?.startDate ?? null,
        periodEnd: r.period?.endDate ?? null,
        firstDate: t.tripDate,
        lastDate: t.tripDate,
        milesTenths: 0,
        trips: [],
      });
    }
    const g = groups.get(key);
    const mt = tenths(t.miles);
    g.milesTenths += mt;
    g.lastDate = t.tripDate;
    const line = { trip: t, pence: r.pence, source: r.source, amountPence: r.pence === null ? null : penceFor(mt, r.pence), groupKey: key };
    g.trips.push(line);
    return line;
  });

  const groupList = [...groups.values()]
    .map((g) => ({ ...g, miles: g.milesTenths / 10, amountPence: g.pence === null ? 0 : penceFor(g.milesTenths, g.pence) }))
    .sort((a, b) => (a.source === 'none') - (b.source === 'none') || (a.firstDate < b.firstDate ? -1 : 1));

  const totalTenths = groupList.reduce((s, g) => s + g.milesTenths, 0);
  const unratedMiles = groupList.filter((g) => g.source === 'none').reduce((s, g) => s + g.milesTenths, 0) / 10;

  return {
    from,
    to,
    lines,
    groups: groupList,
    tripCount: rows.length,
    days: new Set(rows.map((t) => t.tripDate)).size,
    totalMiles: totalTenths / 10,
    totalPence: groupList.reduce((s, g) => s + g.amountPence, 0),
    unratedMiles,
  };
}

/** Problems with the rate periods themselves, for the Rates screen. */
export function rateIssues(rates) {
  const list = live(rates).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const issues = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!a.endDate || b.startDate <= a.endDate) {
        issues.push({ kind: 'overlap', a, b });
      }
    }
  }
  const open = list.filter((p) => !p.endDate);
  if (open.length > 1) issues.push({ kind: 'multiple-open', periods: open });
  return issues;
}

/** Fuel bought in a date range, for comparing money paid out with the mileage claimed. */
export function fuelSummary({ fuel, from, to }) {
  const lines = live(fuel)
    .filter((f) => f.purchaseDate >= from && f.purchaseDate <= to)
    .sort((a, b) => (a.purchaseDate < b.purchaseDate ? -1 : a.purchaseDate > b.purchaseDate ? 1 : 0));
  const totalPence = lines.reduce((s, f) => s + Math.round(Number(f.amountPence) || 0), 0);
  const withLitres = lines.filter((f) => Number(f.litres) > 0);
  const litres = Math.round(withLitres.reduce((s, f) => s + Number(f.litres) * 100, 0)) / 100;
  const litrePence = withLitres.reduce((s, f) => s + Number(f.amountPence), 0);
  return {
    lines,
    count: lines.length,
    totalPence,
    litres,
    // Average price only over purchases where litres were recorded.
    avgPencePerLitre: litres > 0 ? Math.round((litrePence / litres) * 10) / 10 : null,
    receiptCount: lines.reduce((s, f) => s + (f.receiptIds?.length || 0), 0),
  };
}

/** Pence per litre for one purchase, or null. */
export const pencePerLitre = (f) => (Number(f.litres) > 0 ? Math.round((Number(f.amountPence) / Number(f.litres)) * 10) / 10 : null);
