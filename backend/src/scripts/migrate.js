import { db } from '../db.js';

const rollback = process.argv.includes('--rollback');
try {
  const [batch, files] = rollback ? await db.migrate.rollback() : await db.migrate.latest();
  console.log(`${rollback ? 'Rolled back' : 'Applied'} batch ${batch}: ${files.length ? files.join(', ') : 'nothing to do'}`);
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
