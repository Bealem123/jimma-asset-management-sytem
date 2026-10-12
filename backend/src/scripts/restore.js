// Restore a database backup: node src/scripts/restore.js <path-to-db-backup.sql.gz> --yes
// This REPLACES the contents of the configured database (DB_NAME). Stop the application first.
// Uploaded files are restored by copying the files-YYYY-... folder back over the uploads folder.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { verifyDump } from '../lib/backup.js';

const file = process.argv[2];
if (!file || !process.argv.includes('--yes')) {
  console.error('Usage: node src/scripts/restore.js <backup.sql.gz> --yes');
  console.error(`This replaces everything in the database "${config.db.database}".`);
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

if (!(await verifyDump(file))) {
  console.error('This file does not look like a valid database backup. Nothing was changed.');
  process.exit(1);
}

const bin = (process.env.MYSQLDUMP_PATH || 'mysqldump').replace(/mysqldump(\.exe)?$/i, 'mysql$1');
const child = spawn(bin, [`--host=${config.db.host}`, `--port=${config.db.port}`, `--user=${config.db.user}`, '--default-character-set=utf8mb4', config.db.database], {
  env: { ...process.env, MYSQL_PWD: config.db.password || '' }, stdio: ['pipe', 'inherit', 'inherit'],
});
child.on('error', (e) => { console.error(`Could not run the mysql client (${bin}): ${e.message}`); process.exit(1); });
const done = new Promise((resolve) => child.on('close', resolve));
await pipeline(fs.createReadStream(file), zlib.createGunzip(), child.stdin);
const code = await done;
console.log(code === 0 ? `Restored ${file} into ${config.db.database}.` : `Restore failed (exit code ${code}).`);
process.exitCode = code;
