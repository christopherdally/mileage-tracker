// Create an admin, or reset an existing account to admin with a new password:
//   docker compose exec app npm run create-admin -- <username> <password>
import { pool, migrate } from './db.js';
import { hashPassword } from './auth.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- <username> <password (8+ characters)>');
  process.exit(1);
}
await migrate();
await pool.query(
  `INSERT INTO users (username, display_name, password_hash, is_admin)
   VALUES ($1, $1, $2, true)
   ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, is_admin=true, is_active=true,
     token_version=users.token_version+1, updated_at=now()`,
  [username.toLowerCase(), await hashPassword(password)]
);
console.log(`Admin "${username.toLowerCase()}" is ready.`);
await pool.end();
