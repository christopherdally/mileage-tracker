// Browser test of the built app against a real server and a fresh database.
//   (cd client && npm install && npm run build) && (cd server && npm install)
//   cd e2e && npm install && npx playwright install chromium
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm test
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, withServer } from '../server/test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, '..', 'client', 'dist');
if (!fs.existsSync(path.join(clientDir, 'index.html'))) {
  console.error('Build the client first: cd client && npm install && npm run build');
  process.exit(1);
}

const env = {
  ADMIN_PASSWORD: 'first-admin-pass',
  // Password reset emails go to a mail server the test runs itself.
  APP_URL: 'http://127.0.0.1:3190', SMTP_HOST: '127.0.0.1', SMTP_PORT: '3195',
};
const code = await withServer({ db: 'mileage_test_e2e', port: 3190, env, clientDir }, (base) =>
  run(process.execPath, [path.join(here, 'app.test.mjs')], { BASE: base, ...env }));
process.exit(code);
