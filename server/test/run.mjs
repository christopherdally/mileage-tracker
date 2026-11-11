// Runs the server tests. The end-to-end suites each get a fresh database and their own server.
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm test
// pg_dump and pg_restore must be on the PATH (the backup test uses them).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, withServer } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'adminpass123' };
const SUITES = [
  { file: 'api.test.mjs', db: 'mileage_test_api', port: 3181, env: admin },
  { file: 'fuel.test.mjs', db: 'mileage_test_fuel', port: 3182, env: { ADMIN_PASSWORD: 'first-admin-pass' } },
  { file: 'vehicles.test.mjs', db: 'mileage_test_vehicles', port: 3183, env: admin },
];

let failed = await run(process.execPath, [path.join(here, 'report-upload.test.mjs')]);
for (const suite of SUITES) {
  console.log(`\n── ${suite.file} ──`);
  try {
    failed += await withServer(suite, (base) => run(process.execPath, [path.join(here, suite.file)], { BASE: base, ...suite.env }));
  } catch (e) {
    console.error(e.message);
    failed += 1;
  }
}

console.log(failed ? '\nServer tests FAILED' : '\nAll server tests passed');
process.exit(failed ? 1 : 0);
