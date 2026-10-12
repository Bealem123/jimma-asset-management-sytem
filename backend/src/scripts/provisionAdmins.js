// Create the standard administrator accounts (see lib/provision.js).
//   node src/scripts/provisionAdmins.js            create the missing accounts and write their temporary passwords to a file
//   node src/scripts/provisionAdmins.js --dry-run  only list what would be created
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { planAdminAccounts, provisionAdminAccounts } from '../lib/provision.js';
import { ROLE_LABELS } from '../lib/constants.js';

const csv = (v) => `"${String(v).replace(/"/g, '""')}"`;
try {
  if (process.argv.includes('--dry-run')) {
    const plan = await planAdminAccounts();
    const existing = new Set((await db('users').select('username')).map((u) => u.username.toLowerCase()));
    for (const a of plan) console.log(`${existing.has(a.username) ? 'exists ' : 'new    '} ${a.username.padEnd(28)} ${ROLE_LABELS[a.role].padEnd(28)} ${a.area}`);
    console.log(`\n${plan.length} accounts in the standard set, ${plan.filter((a) => !existing.has(a.username)).length} not created yet.`);
  } else {
    const { created, skipped } = await provisionAdminAccounts();
    if (created.length) {
      const dir = path.resolve('credentials');
      fs.mkdirSync(dir, { recursive: true });
      // Never overwrite an earlier file: it may hold passwords that have not been handed out yet.
      const stem = `admin-accounts-${new Date().toISOString().slice(0, 10)}`;
      let file = path.join(dir, `${stem}.csv`);
      for (let n = 2; fs.existsSync(file); n += 1) file = path.join(dir, `${stem}-${n}.csv`);
      const rows = [['Username', 'Full name', 'Role', 'Area', 'Temporary password']]
        .concat(created.map((c) => [c.username, c.full_name, ROLE_LABELS[c.role], c.area, c.password]));
      fs.writeFileSync(file, `﻿${rows.map((r) => r.map(csv).join(',')).join('\r\n')}\r\n`, { mode: 0o600 });
      console.log(`Created ${created.length} accounts. Temporary passwords are in:\n  ${file}`);
      console.log('Hand each person their own row, then DELETE this file. Everyone must choose a new password at first sign-in.');
    } else {
      console.log('Nothing to create: every account in the standard set already exists.');
    }
    if (skipped.length) console.log(`${skipped.length} accounts already existed and were left unchanged.`);
  }
} catch (err) {
  console.error('Provisioning failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
