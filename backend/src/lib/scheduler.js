import { runAlertScan } from './alerts.js';
import { backupDatabase, backupFiles } from './backup.js';

const iso = (d) => d.toISOString().slice(0, 10);

let lastBackupDay = null;

/** Hourly housekeeping: alert scan (including the monthly report reminders) and, if AUTO_BACKUP=true, a daily backup. */
export function startScheduler() {
  const tick = async () => {
    try {
      await runAlertScan();
      if (process.env.AUTO_BACKUP === 'true' && lastBackupDay !== iso(new Date())) {
        lastBackupDay = iso(new Date());
        await backupDatabase(null);
        await backupFiles(null);
      }
    } catch (err) {
      console.error('Scheduled housekeeping failed:', err.message);
    }
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}
