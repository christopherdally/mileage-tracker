// Drives the real app in a browser: sign in, vehicles, journeys, receipt scan, report exports, CSV import, second device,
// two-step sign-in, password reset by email and the activity log.
// Needs a server on an EMPTY database with ADMIN_PASSWORD, APP_URL, SMTP_HOST=127.0.0.1 and SMTP_PORT set
// and ADMIN_USERNAME unset (run.mjs does this):
//   BASE=http://localhost:3000 ADMIN_PASSWORD=... SMTP_PORT=... node e2e/app.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startSmtpSink } from '../server/test/smtp-sink.mjs';
import { codeAt, currentStep } from '../server/src/totp.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const FIRST_PW = process.env.ADMIN_PASSWORD;
const PW = 'my-own-secret-99';
const NEW_PW = 'after-the-reset-7';
const FOCUS = 'Ford Focus AB12 CDE';
const VAN = 'Transit van XY70 ZZZ';

const step = (name) => console.log(`PASS ${name}`);
const browser = await chromium.launch();
const mail = await startSmtpSink(Number(process.env.SMTP_PORT));
const problems = [];
const pages = [];

async function newDevice() {
  const context = await browser.newContext({ viewport: { width: 400, height: 850 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  pages.push(page);
  // Anything the browser refuses (e.g. under the Content-Security-Policy) or the app throws fails the run.
  // (A refused request is logged by the browser too; wrong passwords and codes are part of the test.)
  page.on('console', (m) => { if (m.type() === 'error' && !/the server responded with a status of 40[01] /.test(m.text())) problems.push(m.text()); });
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
  const journeysExport = csv.data;
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

  // ── Import journeys from a spreadsheet ──
  await tab(page, 'Journeys');
  await page.getByRole('button', { name: 'Import' }).click();
  const importer = page.locator('dialog[open]');
  const chooseFile = (name, text) => importer.getByTestId('import-picker').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
  await chooseFile('export.csv', journeysExport);
  await importer.getByText('No new journeys to import.').waitFor();
  await importer.getByText('2 already in your journeys').waitFor();
  await chooseFile('old-logbook.csv', [
    'Date,Purpose,Start,End,Distance,Car',
    `03/02/2025,"Depot run, Swansea",,,61.5,${VAN}`,
    `04/02/2025,Client visit Bath,52000,52047.2,,${FOCUS}`,
    '31/02/2025,Impossible date,,,5,',
  ].join('\r\n'));
  await importer.getByText('2 journeys to import, 3 Feb 2025 to 4 Feb 2025, 108.7 miles in total.').waitFor();
  await importer.getByText("Row 4: \"31/02/2025\" isn't a date").waitFor();
  await importer.getByRole('button', { name: 'Import 2 journeys' }).click();
  await page.getByText('Imported 2 journeys').waitFor();
  await rows.filter({ hasText: 'Depot run, Swansea' }).filter({ hasText: VAN }).filter({ hasText: '61.5' }).waitFor();
  await rows.filter({ hasText: 'Client visit Bath' }).filter({ hasText: '52000 to 52047.2' }).filter({ hasText: '47.2' }).waitFor();
  step('journeys imported from a CSV file, without duplicating existing ones');

  // ── Everything reaches a second device ──
  await synced(page);
  const phone = await newDevice();
  await signIn(phone, PW);
  await tab(phone, 'Journeys');
  await phone.locator('.logbook li').filter({ hasText: 'Delivery, Bristol' }).filter({ hasText: VAN }).waitFor();
  await phone.locator('.logbook li').filter({ hasText: 'Depot run, Swansea' }).waitFor();
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

  // ── Two-step sign-in ──
  await tab(page, 'Settings');
  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  const setup = page.locator('dialog[open]');
  await setup.getByRole('img', { name: 'QR code for your authenticator app' }).waitFor();
  const secret = (await setup.getByTestId('totp-secret').textContent()).replace(/\s/g, '');
  await setup.getByLabel('Code from the app').fill('000000');
  await setup.getByRole('button', { name: 'Turn on' }).click();
  await setup.getByText("That code isn't right").waitFor();
  const usedStep = currentStep();
  await setup.getByLabel('Code from the app').fill(codeAt(secret, usedStep));
  await setup.getByRole('button', { name: 'Turn on' }).click();
  await setup.locator('.codes li').first().waitFor();
  const recovery = await setup.locator('.codes li').allTextContents();
  assert.equal(recovery.length, 10);
  await setup.getByRole('button', { name: "I've saved them" }).click();
  await page.getByText('On. Signing in needs your password and a code').waitFor();

  const laptop = await newDevice();
  await signIn(laptop, PW);
  const codeBox = laptop.getByLabel('Code from your authenticator app');
  await codeBox.fill('123456');
  await laptop.getByRole('button', { name: 'Sign in' }).click();
  await laptop.getByText("That code isn't right").waitFor();
  await codeBox.fill(codeAt(secret, usedStep + 1));
  await laptop.getByRole('button', { name: 'Sign in' }).click();
  await laptop.getByRole('navigation', { name: 'Main' }).waitFor();
  step('two-step sign-in set up and used on another device');

  // ── Forgotten password: reset link by email, then sign in with a recovery code ──
  const tablet = await newDevice();
  await tablet.goto(BASE);
  await tablet.getByRole('button', { name: 'Forgot your password?' }).click();
  await tablet.getByLabel('Email address').fill('admin@example.com');
  await tablet.getByRole('button', { name: 'Send reset link' }).click();
  await tablet.getByText('a link to choose a new password is on its way').waitFor();
  const email = await mail.next();
  assert.equal(email.to, 'admin@example.com');
  const link = /http:\/\/\S+#reset\?token=[\w-]+/.exec(email.text)[0];
  await tablet.goto(link);
  await tablet.getByLabel('New password', { exact: true }).fill(NEW_PW);
  await tablet.getByLabel('New password again').fill(NEW_PW);
  await tablet.getByRole('button', { name: 'Save password' }).click();
  await tablet.getByText('Your password has been changed').waitFor();
  await tablet.getByRole('button', { name: 'Sign in' }).click();
  await tablet.getByLabel('Email or username').fill('admin@example.com');
  await tablet.getByLabel('Password').fill(NEW_PW);
  await tablet.getByRole('button', { name: 'Sign in' }).click();
  await tablet.getByLabel('Code from your authenticator app').fill(recovery[0]);
  await tablet.getByRole('button', { name: 'Sign in' }).click();
  await tablet.getByRole('navigation', { name: 'Main' }).waitFor();
  // The reset signed the other devices out.
  await tab(laptop, 'Settings');
  await laptop.getByRole('button', { name: 'Sync now' }).click();
  await laptop.getByText('Your session ended').waitFor();
  step('password reset by email, then sign-in with a recovery code');

  // ── Activity log ──
  await tab(tablet, 'Settings');
  await tablet.getByRole('button', { name: 'Activity log' }).click();
  const log = tablet.locator('.activity li');
  await log.filter({ hasText: 'admin@example.com signed in with a recovery code' }).waitFor();
  await log.filter({ hasText: 'admin@example.com set a new password from a reset email' }).waitFor();
  await log.filter({ hasText: 'admin@example.com turned on two-step sign-in' }).waitFor();
  step('activity log shows the security changes');

  assert.deepEqual(problems, [], 'no browser errors, blocked requests or requests to other origins');
  console.log('\nALL PASSED');
} catch (e) {
  console.error(`\nFAILED: ${e.stack || e}`);
  if (problems.length) console.error('Browser problems:\n  ' + problems.join('\n  '));
  // Kept as a CI artifact, to see what the app looked like when it went wrong.
  for (const [i, p] of pages.entries()) await p.screenshot({ path: new URL(`failure-${i + 1}.png`, import.meta.url).pathname, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await mail.close();
  await browser.close();
}
