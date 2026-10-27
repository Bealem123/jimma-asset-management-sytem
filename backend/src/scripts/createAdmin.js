// Usage:  npm run create-admin -- <username> "<Full Name>"
// The password is read from the ADMIN_PASSWORD environment variable, or generated and printed once.
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { BCRYPT_ROUNDS, strongTemporaryPassword } from '../lib/security.js';

const [username, fullName] = process.argv.slice(2);
try {
  if (!username || !fullName) throw new Error('Usage: npm run create-admin -- <username> "<Full Name>"');
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(username)) throw new Error('Username: 3-80 letters, numbers, dot, dash or underscore.');
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || strongTemporaryPassword();
  if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  if (await db('users').where({ username }).first()) throw new Error(`User "${username}" already exists.`);
  await db('users').insert({ username, full_name: fullName, role: 'SUPER_ADMIN', password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS) });
  console.log(`Super Administrator "${username}" created.`);
  if (generated) console.log(`Password (shown once, change it after signing in): ${password}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
