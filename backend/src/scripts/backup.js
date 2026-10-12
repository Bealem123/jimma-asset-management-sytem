// Command-line backup: node src/scripts/backup.js [database|files|both]
// Schedule it with Windows Task Scheduler or cron, and copy the BACKUP_DIR folder off the server.
import { db } from '../db.js';
import { backupDatabase, backupDir, backupFiles } from '../lib/backup.js';

const kind = process.argv[2] || 'both';
let failed = false;
try {
  const made = [];
  if (kind !== 'files') made.push(await backupDatabase(null));
  if (kind !== 'database') made.push(await backupFiles(null));
  for (const b of made) {
    console.log(`${b.kind.padEnd(8)} ${b.status.padEnd(6)} ${b.filename}  ${b.note ?? ''}`);
    if (b.status !== 'OK') failed = true;
  }
  console.log(`Backups are in ${backupDir()}`);
} catch (err) {
  console.error('Backup failed:', err.message);
  failed = true;
} finally {
  await db.destroy();
}
if (failed) process.exitCode = 1;
