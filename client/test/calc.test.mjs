import assert from 'node:assert/strict';
import { buildReport, periodFor, rateIssues, fuelSummary, pencePerLitre } from '../src/calc.js';
import { claimPeriod } from '../src/util.js';

const rates = [
  { id: 'a', label: 'Summer', pencePerMile: 45, startDate: '2026-09-01', endDate: '2026-09-30', updatedAt: '1' },
  { id: 'b', label: 'Autumn', pencePerMile: 48.5, startDate: '2026-10-01', endDate: null, updatedAt: '1' },
  { id: 'x', label: 'Gone', pencePerMile: 99, startDate: '2026-01-01', endDate: null, updatedAt: '1', deleted: true },
];
const trips = [
  { id: '1', tripDate: '2026-09-29', miles: 42.5 },
  { id: '2', tripDate: '2026-10-02', miles: 88 },
  { id: '3', tripDate: '2026-10-03', miles: 10.3, rateOverridePence: 25 },
  { id: '4', tripDate: '2026-10-04', miles: 0.1 },
  { id: '5', tripDate: '2026-10-05', miles: 7, deleted: true },
  { id: '6', tripDate: '2026-08-15', miles: 12 }, // no rate covers August
];
assert.equal(periodFor('2026-09-30', rates).id, 'a');
assert.equal(periodFor('2026-10-01', rates).id, 'b');
assert.equal(periodFor('2026-08-01', rates), null);

const r = buildReport({ trips, rates, from: '2026-08-01', to: '2026-10-31' });
assert.equal(r.tripCount, 5);
assert.equal(r.totalMiles, 152.9);
const g = Object.fromEntries(r.groups.map((x) => [x.key, x]));
assert.equal(g['period:a'].amountPence, 1913);          // 42.5 × 45 = 1912.5 → 1913
assert.equal(g['period:b'].miles, 88.1);
assert.equal(g['period:b'].amountPence, 4273);          // 88.1 × 48.5 = 4272.85 → 4273
assert.equal(g['custom:25'].amountPence, 258);          // 10.3 × 25 = 257.5 → 258
assert.equal(g['none'].amountPence, 0);
assert.equal(r.unratedMiles, 12);
assert.equal(r.totalPence, 1913 + 4273 + 258);
assert.equal(r.groups.at(-1).key, 'none');              // unrated listed last
// 0.1 + 0.2 style float drift check
const drift = buildReport({ trips: Array.from({ length: 10 }, (_, i) => ({ id: 'd' + i, tripDate: '2026-10-10', miles: 0.1 })), rates, from: '2026-10-01', to: '2026-10-31' });
assert.equal(drift.totalMiles, 1);

assert.deepEqual(claimPeriod('2026-10-13', 1), { from: '2026-10-01', to: '2026-10-31' });
assert.deepEqual(claimPeriod('2026-10-13', 26), { from: '2026-09-26', to: '2026-10-25' });
assert.deepEqual(claimPeriod('2026-10-27', 26), { from: '2026-10-26', to: '2026-11-25' });
assert.deepEqual(claimPeriod('2026-01-10', 26, -1), { from: '2025-11-26', to: '2025-12-25' });
assert.deepEqual(claimPeriod('2026-03-05', 1, -1), { from: '2026-02-01', to: '2026-02-28' });

assert.equal(rateIssues(rates).length, 0);
assert.equal(rateIssues([...rates, { id: 'c', pencePerMile: 50, startDate: '2026-10-10', endDate: null }]).length, 2);
const fs1 = fuelSummary({ from: '2026-10-01', to: '2026-10-31', fuel: [
  { id: 'a', purchaseDate: '2026-10-13', amountPence: 8999, litres: 61.2, receiptIds: ['x'] },
  { id: 'b', purchaseDate: '2026-10-20', amountPence: 4000, litres: null, receiptIds: [] },
  { id: 'c', purchaseDate: '2026-11-01', amountPence: 1000 },
  { id: 'd', purchaseDate: '2026-10-05', amountPence: 999, deleted: true },
] });
assert.equal(fs1.count, 2);
assert.equal(fs1.totalPence, 12999);
assert.equal(fs1.litres, 61.2);
assert.equal(fs1.avgPencePerLitre, 147.0);   // only purchases with litres count towards the average
assert.equal(fs1.receiptCount, 1);
assert.equal(pencePerLitre({ amountPence: 8999, litres: 61.2 }), 147);
assert.equal(pencePerLitre({ amountPence: 100 }), null);
console.log('calc tests passed');
