// The activity log: what admins did and security changes to accounts.
import { query } from './db.js';

/** Record an action. `actor` is a user row or null; a failure to log never fails the action itself. */
export async function audit(actor, action, { target = '', detail = {}, ip = '' } = {}) {
  try {
    await query('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES ($1,$2,$3,$4,$5)',
      [actor?.username || '', action, target, JSON.stringify(detail), ip]);
  } catch (e) {
    console.error('Could not write to the activity log:', e.message);
  }
}
