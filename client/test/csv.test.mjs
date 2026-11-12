import assert from 'node:assert/strict';
import { buildReport, fuelSummary } from '../src/calc.js';
import { toCsv, journeysCsv, fuelCsv, csvFilename } from '../src/csv.js';

const lines = (csv) => csv.replace(/^﻿/, '').split('\r\n');

// Quoting, and text a spreadsheet would treat as a formula.
assert.equal(toCsv([['a', 'b,c', 'say "hi"', 'two\nlines', null, 0, -5]]), '﻿a,"b,c","say ""hi""","two\nlines",,0,-5\r\n');
assert.equal(lines(toCsv([['=SUM(A1:A9)', '+44 20', '-x', '@cmd']]))[0], "'=SUM(A1:A9),'+44 20,'-x,'@cmd");

const vehicles = [{ id: 'v1', name: 'Ford Focus AB12 CDE' }, { id: 'v2', name: 'Transit, pool van', deleted: true }];
const rates = [{ id: 'r', label: 'Standard', pencePerMile: 45, startDate: '2026-10-01', endDate: null, updatedAt: '1' }];
const trips = [
  { id: 'b', tripDate: '2026-10-05', description: 'Client visit, Bristol', miles: 88, vehicleId: 'v2', rateOverridePence: 25 },
  { id: 'a', tripDate: '2026-10-02', description: 'Site visit', startOdometer: 1000, endOdometer: 1042.5, miles: 42.5, vehicleId: 'v1' },
  { id: 'c', tripDate: '2026-09-30', description: '', miles: 10 },
  { id: 'd', tripDate: '2026-10-03', miles: 99, deleted: true },
  { id: 'e', tripDate: '2026-11-01', miles: 5 },
];
const report = buildReport({ trips, rates, from: '2026-09-26', to: '2026-10-25' });
const j = lines(journeysCsv(report, vehicles));
assert.equal(j[0], 'Date,Vehicle,Journey,Start odometer,End odometer,Miles,Pence per mile,Rate type,Amount (GBP)');
assert.equal(j[1], '2026-09-30,,,,,10.0,,No rate,');
assert.equal(j[2], '2026-10-02,Ford Focus AB12 CDE,Site visit,1000,1042.5,42.5,45,Rate period,19.13');
assert.equal(j[3], '2026-10-05,"Transit, pool van","Client visit, Bristol",,,88.0,25,Custom rate,22.00');
assert.equal(j.length, 5); // header, three journeys, trailing newline
assert.equal(j[4], '');

// One vehicle only.
const one = buildReport({ trips, rates, from: '2026-09-26', to: '2026-10-25', vehicleId: 'v1' });
assert.equal(one.tripCount, 1);
assert.equal(one.totalPence, 1913);
assert.deepEqual(report.byVehicle, [
  { vehicleId: null, tripCount: 1, miles: 10 },
  { vehicleId: 'v1', tripCount: 1, miles: 42.5 },
  { vehicleId: 'v2', tripCount: 1, miles: 88 },
]);

const fuelRows = [
  { id: 'f1', purchaseDate: '2026-10-13', amountPence: 8999, litres: 61.2, odometer: 41300, description: 'Tesco Extra, Cardiff', receiptIds: ['x'], vehicleId: 'v1' },
  { id: 'f2', purchaseDate: '2026-10-01', amountPence: 4000, litres: null, description: '', receiptIds: [] },
  { id: 'f3', purchaseDate: '2026-10-20', amountPence: 100, deleted: true },
];
const fuel = fuelSummary({ fuel: fuelRows, from: '2026-09-26', to: '2026-10-25' });
const f = lines(fuelCsv(fuel, vehicles));
assert.equal(f[0], 'Date,Vehicle,Where,Litres,Pence per litre,Odometer,Receipts,Amount paid (GBP)');
assert.equal(f[1], '2026-10-01,,,,,,0,40.00');
assert.equal(f[2], '2026-10-13,Ford Focus AB12 CDE,"Tesco Extra, Cardiff",61.2,147,41300,1,89.99');
assert.equal(fuelSummary({ fuel: fuelRows, from: '2026-09-26', to: '2026-10-25', vehicleId: 'v1' }).totalPence, 8999);

assert.equal(csvFilename('mileage-journeys', report, { displayName: 'Dave Jones' }), 'mileage-journeys_Dave-Jones_2026-09-26_to_2026-10-25.csv');
console.log('CSV tests passed');
