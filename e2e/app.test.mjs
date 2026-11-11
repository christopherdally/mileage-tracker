// Drives the real app in a browser: sign in, vehicles, journeys, receipt scan, report exports, second device.
// Needs a server on an EMPTY database with ADMIN_PASSWORD set and ADMIN_USERNAME unset (run.mjs does this):
//   BASE=http://localhost:3000 ADMIN_PASSWORD=... node e2e/app.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const FIRST_PW = process.env.ADMIN_PASSWORD;
const PW = 'my-own-secret-99';
const FOCUS = 'Ford Focus AB12 CDE';
const VAN = 'Transit van XY70 ZZZ';

const step = (name) => console.log(`PASS ${name}`);
const browser = await chromium.launch();
const problems = [];
const pages = [];

async function newDevice() {
  const context = await browser.newContext({ viewport: { width: 400, height: 850 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  pages.push(page);
  // Anything the browser refuses (e.g. under the Content-Security-Policy) or the app throws fails the run.
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  // Nothing may be fetched from another origin.
  await context.route((url) => url.origin !== new URL(BASE).origin, (route) => { problems.push(`external request: ${route.request().url()}`); route.abort(); });
  return page;
}

async function signIn(page, password) {
  await page.goto(BASE);
  await page.getByLabel('Email or username').fill('admin@example.com');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const tab = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
const synced = async (page) => {
  await tab(page, 'Settings');
  await page.getByText('Everything is synced').waitFor();
};

/** A photo-like image of a till receipt dated today, rendered by the browser. */
async function receiptPhoto(dateText) {
  const page = await browser.newPage({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 3 });
  await page.setContent(`<body style="margin:0;background:#bbb;padding:30px"><div style="background:#fafafa;font:15px/1.5 monospace;padding:24px;transform:rotate(1.5deg)">
    <div style="text-align:center;font-weight:bold;font-size:20px">TESCO EXTRA</div><div style="text-align:center">CARDIFF WESTERN AVE<br>VAT NO 220 4302 31</div><br>
    PUMP 04 UNLEADED<br>42.31 LITRES @ 139.9 P/L<br><br>FUEL TOTAL &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; £59.19<br><b>TOTAL TO PAY &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; £59.19</b><br>VISA DEBIT &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; £59.19<br><br>${dateText} 17:42<br>THANK YOU</div></body>`);
  const buffer = await page.screenshot({ type: 'jpeg', quality: 85 });
  await page.close();
  return buffer;
}

try {
  const page = await newDevice();

  // ── First sign-in: the admin has to choose their own password ──
  await signIn(page, FIRST_PW);
  await page.getByLabel('Password you were given').fill(FIRST_PW);
  await page.getByLabel('New password', { exact: true }).fill(PW);
  await page.getByLabel('New password again').fill(PW);
  await page.getByRole('button', { name: 'Save password' }).click();
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  step('first sign-in and password change');

  // ── A rate, so journeys have a value ──
  await tab(page, 'Rates');
  await page.getByRole('button', { name: 'Add rate' }).first().click();
  const rateForm = page.locator('dialog[open]');
  await rateForm.getByLabel('Pence per mile').fill('45');
  await rateForm.getByLabel('Starts').fill('2020-01-01');
  await rateForm.getByRole('button', { name: 'Add rate' }).click();
  await rateForm.waitFor({ state: 'hidden' });

  // ── One vehicle: no picker on the journey form ──
  await tab(page, 'Settings');
  const addVehicle = async (name) => {
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    const form = page.locator('dialog[open]');
    await form.getByLabel('Vehicle').fill(name);
    await form.getByRole('button', { name: 'Add vehicle' }).click();
    await form.waitFor({ state: 'hidden' });
  };
  await addVehicle(FOCUS);
  await tab(page, 'Log');
  await page.getByRole('button', { name: 'Save journey' }).waitFor();
  assert.equal(await page.getByLabel('Vehicle').count(), 0, 'no vehicle picker with a single vehicle');
  await page.getByRole('radio', { name: 'Odometer' }).click();
  await page.getByLabel('Start reading').fill('41250');
  await page.getByLabel('End reading').fill('41292.5');
  await page.getByLabel('Where and why').fill('Site visit, Newport');
  await page.getByRole('button', { name: 'Save journey' }).click();
  await page.getByText('Saved 42.5 miles').waitFor();
  step('journey logged with a single vehicle');

  // ── Two vehicles: pick one per journey; odometer follows the vehicle ──
  await tab(page, 'Settings');
  await addVehicle(VAN);
  await page.getByRole('button', { name: 'Add vehicle' }).click();
  await page.locator('dialog[open]').getByLabel('Vehicle').fill(VAN.toLowerCase());
  await page.locator('dialog[open]').getByRole('button', { name: 'Add vehicle' }).click();
  await page.getByText('You already have a vehicle with that name').waitFor();
  await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();

  await tab(page, 'Log');
  const picker = page.getByLabel('Vehicle');
  assert.equal(await picker.locator('option:checked').textContent(), FOCUS, 'defaults to the vehicle used last');
  assert.equal(await page.getByLabel('Start reading').inputValue(), '41292.5', "start reading carries on from that vehicle's last journey");
  await picker.selectOption({ label: VAN });
  assert.equal(await page.getByLabel('Start reading').inputValue(), '', 'a vehicle with no journeys has no reading to carry on from');
  await page.getByRole('radio', { name: 'Miles' }).click();
  await page.getByLabel('Business miles').fill('88');
  await page.getByLabel('Where and why').fill('Delivery, Bristol');
  await page.getByRole('button', { name: 'Save journey' }).click();
  await page.getByText('Saved 88.0 miles').waitFor();

  await tab(page, 'Journeys');
  const rows = page.locator('.logbook li');
  await rows.filter({ hasText: 'Delivery, Bristol' }).filter({ hasText: VAN }).waitFor();
  await rows.filter({ hasText: 'Site visit, Newport' }).filter({ hasText: FOCUS }).waitFor();
  step('journeys logged against two vehicles');

  // ── Receipt scan fills in the fuel form ──
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const photo = await receiptPhoto(`${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`);
  await tab(page, 'Fuel');
  await page.getByRole('button', { name: 'Add fuel' }).click();
  const fuelForm = page.locator('dialog[open]').first();
  await fuelForm.locator('input[type=file][accept="image/*"]:not([capture])').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.getByRole('heading', { name: 'Review scanned receipt' }).waitFor({ timeout: 90000 });
  assert.equal(await page.getByLabel('Purchase date').inputValue(), iso);
  assert.equal(await page.getByLabel('Amount paid (£)').inputValue(), '59.19');
  assert.equal(await page.getByLabel('Litres').last().inputValue(), '42.31');
  assert.equal(await page.getByLabel('Retailer').inputValue(), 'TESCO EXTRA');
  await page.getByRole('button', { name: 'Use these details' }).click();
  await fuelForm.getByLabel('Vehicle').selectOption({ label: VAN });
  await fuelForm.getByRole('button', { name: 'Save fuel' }).click();
  await page.locator('.logbook li').filter({ hasText: 'TESCO EXTRA' }).filter({ hasText: VAN }).waitFor();
  step('receipt scanned on the device and saved as fuel');

  // ── Report: totals, vehicle filter, CSV and PDF ──
  await tab(page, 'Report');
  const total = (label) => page.locator('.totals div').filter({ hasText: label }).locator('dd').textContent();
  assert.equal(await total('Business miles'), '130.5');
  assert.equal(await total('To claim'), '£58.73');
  const download = async (button) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
    return { name: d.suggestedFilename(), data: fs.readFileSync(await d.path()) };
  };
  let csv = await download('Journeys (CSV)');
  assert.match(csv.name, /^mileage-journeys_Administrator_\d{4}-\d\d-\d\d_to_\d{4}-\d\d-\d\d\.csv$/);
  assert.deepEqual(csv.data.toString().replace(/^﻿/, '').trim().split('\r\n'), [
    'Date,Vehicle,Journey,Start odometer,End odometer,Miles,Pence per mile,Rate type,Amount (GBP)',
    `${iso},${VAN},"Delivery, Bristol",,,88.0,45,Rate period,39.60`,
    `${iso},${FOCUS},"Site visit, Newport",41250,41292.5,42.5,45,Rate period,19.13`,
  ]);
  csv = await download('Fuel (CSV)');
  assert.equal(csv.data.toString().trim().split('\r\n')[1], `${iso},${VAN},TESCO EXTRA,42.31,139.9,,1,59.19`);

  await page.getByLabel('Vehicle').selectOption({ label: FOCUS });
  assert.equal(await total('Business miles'), '42.5');
  assert.equal(await total('Journeys'), '1');
  assert.equal(await page.getByRole('button', { name: 'Fuel (CSV)' }).isDisabled(), true, 'no fuel for that vehicle');
  csv = await download('Journeys (CSV)');
  assert.equal(csv.data.toString().trim().split('\r\n').length, 2, 'filtered export has the one journey');
  await page.getByLabel('Vehicle').selectOption({ label: 'All vehicles' });
  const pdf = await download('Download PDF');
  assert.match(pdf.name, /^mileage-claim_Administrator_.*\.pdf$/);
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  step('report totals, vehicle filter, CSV and PDF downloads');

  // ── Everything reaches a second device ──
  await synced(page);
  const phone = await newDevice();
  await signIn(phone, PW);
  await tab(phone, 'Journeys');
  await phone.locator('.logbook li').filter({ hasText: 'Delivery, Bristol' }).filter({ hasText: VAN }).waitFor();
  await tab(phone, 'Fuel');
  await phone.locator('.logbook li').filter({ hasText: 'TESCO EXTRA' }).filter({ hasText: VAN }).waitFor();
  await tab(phone, 'Settings');
  await phone.getByRole('navigation', { name: 'Your vehicles' }).getByRole('button', { name: FOCUS }).waitFor();

  // Remove a vehicle on the second device: the first stops offering it, but its journeys keep the name.
  await phone.getByRole('navigation', { name: 'Your vehicles' }).getByRole('button', { name: VAN }).click();
  phone.once('dialog', (d) => d.accept());
  await phone.locator('dialog[open]').getByRole('button', { name: 'Remove' }).click();
  await synced(phone);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await page.getByRole('navigation', { name: 'Your vehicles' }).getByRole('button', { name: VAN }).waitFor({ state: 'detached' });
  await tab(page, 'Log');
  await page.getByRole('button', { name: 'Save journey' }).waitFor();
  assert.equal(await page.getByLabel('Vehicle').count(), 0, 'picker goes away once one vehicle is left');
  await tab(page, 'Journeys');
  await page.locator('.logbook li').filter({ hasText: 'Delivery, Bristol' }).filter({ hasText: VAN }).waitFor();
  step('second device syncs vehicles, journeys and fuel');

  assert.deepEqual(problems, [], 'no browser errors, blocked requests or requests to other origins');
  console.log('\nALL PASSED');
} catch (e) {
  console.error(`\nFAILED: ${e.stack || e}`);
  if (problems.length) console.error('Browser problems:\n  ' + problems.join('\n  '));
  // Kept as a CI artifact, to see what the app looked like when it went wrong.
  for (const [i, p] of pages.entries()) await p.screenshot({ path: new URL(`failure-${i + 1}.png`, import.meta.url).pathname, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
