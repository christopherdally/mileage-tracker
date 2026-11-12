import assert from 'node:assert/strict';
import { buildReport } from '../src/calc.js';
import { journeysCsv } from '../src/csv.js';
import { parseCsv, readDate, readJourneys } from '../src/import.js';

// CSV parsing
assert.deepEqual(parseCsv('﻿a,b\r\n1,"x, y"\r\n"say ""hi""","two\nlines"\r\n\r\n,\r\n'), [['a', 'b'], ['1', 'x, y'], ['say "hi"', 'two\nlines']]);
assert.deepEqual(parseCsv('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']]);
assert.deepEqual(parseCsv('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']]);
assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);

// Dates, day first
assert.equal(readDate('2026-10-02'), '2026-10-02');
assert.equal(readDate('02/10/2026'), '2026-10-02');
assert.equal(readDate('2.10.26'), '2026-10-02');
assert.equal(readDate('2 Oct 2026'), '2026-10-02');
assert.equal(readDate('2nd October 2026'), '2026-10-02');
assert.equal(readDate('2026-10-02T09:30:00'), '2026-10-02');
assert.equal(readDate('31/02/2026'), null);
assert.equal(readDate('13/13/2026'), null);
assert.equal(readDate('yesterday'), null);
assert.equal(readDate(''), null);

// A spreadsheet someone kept by hand
const vehicles = [{ id: 'v1', name: 'Ford Focus AB12 CDE' }, { id: 'v2', name: 'Transit van' }];
const sheet = [
  'Date,Purpose,Start,End,Distance,Car',
  '02/10/2026,"Site visit, Newport",41250,41292.5,,ford focus ab12 cde',
  '03/10/2026,Client Bristol,,,88 miles,Transit van',
  '04/10/2026,Depot,,,"1,204.25",Hire car',
  'not a date,Oops,,,5,',
  '05/10/2026,No miles,,,,',
  '06/10/2026,Backwards,200,100,,',
  '07/10/2026,Words,,,lots,',
  ',,,,,',
].join('\n');
let r = readJourneys(sheet, { vehicles });
assert.deepEqual(r.rows, [
  { tripDate: '2026-10-02', description: 'Site visit, Newport', startOdometer: 41250, endOdometer: 41292.5, miles: 42.5, rateOverridePence: null, vehicleId: 'v1' },
  { tripDate: '2026-10-03', description: 'Client Bristol', startOdometer: null, endOdometer: null, miles: 88, rateOverridePence: null, vehicleId: 'v2' },
  { tripDate: '2026-10-04', description: 'Depot', startOdometer: null, endOdometer: null, miles: 1204.3, rateOverridePence: null, vehicleId: null },
]);
assert.deepEqual(r.skipped, [
  { line: 5, reason: '"not a date" isn\'t a date' },
  { line: 6, reason: 'no miles' },
  { line: 7, reason: 'end reading is lower than the start' },
  { line: 8, reason: '"lots" isn\'t a number of miles' },
]);
assert.equal(r.duplicates, 0);

// Importing the same file again adds nothing.
assert.deepEqual(readJourneys(sheet, { vehicles, existing: r.rows }).rows, []);
assert.equal(readJourneys(sheet, { vehicles, existing: r.rows }).duplicates, 3);
// Deleted journeys don't count as already there.
assert.equal(readJourneys(sheet, { vehicles, existing: r.rows.map((t) => ({ ...t, deleted: true })) }).rows.length, 3);
// Two identical legs in one day are both kept, and one already logged cancels only one of them.
const legs = 'Date,Journey,Miles\n2026-10-02,Office to site,12\n2026-10-02,Office to site,12\n';
assert.equal(readJourneys(legs).rows.length, 2);
assert.equal(readJourneys(legs, { existing: [{ tripDate: '2026-10-02', description: 'Office to site', miles: 12 }] }).rows.length, 1);

// With one vehicle, journeys with none named go on it.
assert.equal(readJourneys(legs, { vehicles: [vehicles[0]] }).rows[0].vehicleId, 'v1');

// Files that can't be used
assert.match(readJourneys('').error, /heading row/);
assert.match(readJourneys('Date,Miles').error, /heading row/);
assert.match(readJourneys('When,Miles\n2026-10-02,5').error, /No Date column/);
assert.match(readJourneys('Date,Journey\n2026-10-02,x').error, /No Miles column/);
assert.equal(readJourneys('Date,Start odometer,End odometer\n2026-10-02,10,25.5').rows[0].miles, 15.5);

// This app's own export comes back in unchanged, including custom rates but not the period rate.
const rates = [{ id: 'r', label: 'Standard', pencePerMile: 45, startDate: '2026-01-01', endDate: null, updatedAt: '1' }];
const trips = [
  { id: 'a', tripDate: '2026-10-02', description: 'Site visit', startOdometer: 1000, endOdometer: 1042.5, miles: 42.5, vehicleId: 'v1', rateOverridePence: null },
  { id: 'b', tripDate: '2026-10-05', description: '=HYPERLINK("x")', startOdometer: null, endOdometer: null, miles: 88, vehicleId: 'v2', rateOverridePence: 25 },
  { id: 'c', tripDate: '2026-10-06', description: '', startOdometer: null, endOdometer: null, miles: 3, vehicleId: null, rateOverridePence: null },
];
const exported = journeysCsv(buildReport({ trips, rates, from: '2026-10-01', to: '2026-10-31' }), vehicles);
r = readJourneys(exported, { vehicles });
assert.deepEqual(r.rows, trips.map(({ id, ...t }) => t)); // eslint-disable-line no-unused-vars
assert.deepEqual(r.skipped, []);
assert.equal(readJourneys(exported, { vehicles, existing: trips }).duplicates, 3);
console.log('Import tests passed');
