// Usage:  npm run reset-password -- <username>
// For someone who can no longer sign in (the Super Administrator above all, whom nobody else can reset).
// The new password is read from the NEW_PASSWORD environment variable, or generated and printed once. It is
// temporary: the person chooses their own at the next sign-in. Open sessions end, and the reset is in the audit log.
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { BCRYPT_ROUNDS, strongTemporaryPassword, tempPasswordExpiry } from '../lib/security.js';
import { logAudit } from '../lib/audit.js';

const [username] = process.argv.slice(2);
try {
  if (!username) throw new Error('Usage: npm run reset-password -- <username>');
  const user = await db('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
  if (!user) throw new Error(`There is no user "${username}".`);
  const generated = !process.env.NEW_PASSWORD;
  const password = process.env.NEW_PASSWORD || strongTemporaryPassword();
  if (password.length < 8) throw new Error('NEW_PASSWORD must be at least 8 characters.');
  await db.transaction(async (trx) => {
    await trx('users').where({ id: user.id }).update({
      password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS), must_change_password: true, temp_password_expires_at: tempPasswordExpiry(), token_version: trx.raw('token_version + 1'),
    });
    await logAudit(trx, null, {
      action: 'USER_UPDATE', entity: 'user', entityId: user.id, summary: `Password of ${user.username} reset from the server (reset-password script)`,
    });
  });
  console.log(`Password of "${user.username}" reset${user.is_active ? '' : ' (the account is deactivated: it still cannot sign in)'}.`);
  if (generated) console.log(`Temporary password (shown once; a new one is chosen at sign-in): ${password}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
