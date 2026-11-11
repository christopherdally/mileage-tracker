import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReport, fuelSummary } from '../src/calc.js';
import { buildClaimPdf } from '../src/pdf.js';
const rates = [
  { id: 'a', label: 'Diesel, summer', pencePerMile: 45, startDate: '2026-09-01', endDate: '2026-10-07', updatedAt: '1' },
  { id: 'b', label: 'Diesel, autumn price rise', pencePerMile: 48.5, startDate: '2026-10-08', endDate: null, updatedAt: '1' },
];
const places = ['Cardiff office to Newport site', 'Client visit Bristol, Temple Quay', 'Abertawe depot and Llanelli', 'Pen-y-bont ar Ogwr → Caerdydd, ŵyl site survey with a much longer description that wraps onto more lines to test wrapping', 'Swansea'];
const trips = [];
let odo = 41250.0;
for (let d = 26; d <= 30 + 25; d++) {
  const date = d <= 30 ? `2026-09-${d}` : `2026-10-${String(d - 30).padStart(2, '0')}`;
  const day = new Date(date).getDay(); if (day === 0 || day === 6) continue;
  const miles = Math.round((20 + ((d * 37) % 90)) * 10 + (d % 10)) / 10;
  trips.push({ id: 't' + d, tripDate: date, description: places[d % 5], startOdometer: odo, endOdometer: Math.round((odo + miles) * 10) / 10, miles, rateOverridePence: d === 40 ? 25 : null });
  odo = Math.round((odo + miles + 3.2) * 10) / 10;
}
trips.push({ id: 'old', tripDate: '2026-08-29', miles: 10 });
const report = buildReport({ trips, rates, from: '2026-08-26', to: '2026-10-25' });
const fuelRows = [
  { id: 'f1', purchaseDate: '2026-10-13', amountPence: 8999, litres: 61.2, description: 'Tesco Extra, Cardiff', receiptIds: ['r1'] },
  { id: 'f2', purchaseDate: '2026-09-28', amountPence: 7450, litres: 50.1, description: 'Shell, M4 Magor services', receiptIds: ['r2', 'r3'] },
  { id: 'f3', purchaseDate: '2026-10-20', amountPence: 4000, litres: null, description: 'Esso, Newport', receiptIds: [] },
  { id: 'f4', purchaseDate: '2026-10-21', amountPence: 5000, deleted: true, receiptIds: [] },
];
const fuel = fuelSummary({ fuel: fuelRows, from: '2026-08-26', to: '2026-10-25' });
const user = { username: 'dave', displayName: 'Dave Jones', vehicle: 'Ford Focus AB12 CDE' };
const bytes = await buildClaimPdf({ report, rates, fuel, user });
// Pass a path to keep the PDF for a look: node test/pdf.test.mjs out.pdf
if (process.argv[2]) fs.writeFileSync(process.argv[2], bytes);
assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
assert.equal(report.tripCount, trips.filter((t) => t.tripDate >= '2026-08-26').length);

// Two vehicles: the report says which was used for each entry and adds a per-vehicle breakdown.
const vehicles = [{ id: 'v1', name: 'Ford Focus AB12 CDE' }, { id: 'v2', name: 'Transit van XY70 ZZZ', deleted: true }];
const mixedTrips = trips.map((t, i) => ({ ...t, vehicleId: i % 3 === 0 ? 'v2' : i % 7 === 0 ? null : 'v1' }));
const mixedFuel = fuelRows.map((f, i) => ({ ...f, vehicleId: i ? 'v1' : 'v2' }));
const mixed = buildReport({ trips: mixedTrips, rates, from: '2026-08-26', to: '2026-10-25' });
assert.equal(mixed.byVehicle.length, 3);
assert.equal(mixed.byVehicle.reduce((s, v) => s + v.tripCount, 0), mixed.tripCount);
const mixedBytes = await buildClaimPdf({ report: mixed, rates, fuel: fuelSummary({ fuel: mixedFuel, from: '2026-08-26', to: '2026-10-25' }), user, vehicles });
assert.ok(mixedBytes.length > bytes.length, 'the multi-vehicle PDF carries the extra vehicle lines');
if (process.argv[3]) fs.writeFileSync(process.argv[3], mixedBytes);
const van = buildReport({ trips: mixedTrips, rates, from: '2026-08-26', to: '2026-10-25', vehicleId: 'v2' });
await buildClaimPdf({ report: van, rates, user, vehicles, vehicleId: 'v2' });
console.log('PDF tests passed');
