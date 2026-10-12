import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { db } from '../db.js';
import { config } from '../config.js';

// Backups: a compressed database dump (mysqldump) and a copy of the uploads folder.
// BACKUP_DIR (default ./backups) should be on a different disk or synced off-site.
// MYSQLDUMP_PATH points at mysqldump if it is not on PATH.

export const backupDir = () => path.resolve(process.env.BACKUP_DIR || `backups${config.isTest ? '-test' : ''}`);
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

function runDump(outFile) {
  const bin = process.env.MYSQLDUMP_PATH || 'mysqldump';
  const args = [
    `--host=${config.db.host}`, `--port=${config.db.port}`, `--user=${config.db.user}`,
    '--single-transaction', '--routines', '--default-character-set=utf8mb4', config.db.database,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: { ...process.env, MYSQL_PWD: config.db.password || '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => reject(new Error(`Could not run mysqldump (${bin}): ${e.message}`)));
    pipeline(child.stdout, zlib.createGzip(), fs.createWriteStream(outFile)).catch(reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mysqldump failed (${code}): ${stderr.slice(0, 300)}`))));
  });
}

/** True if the gzip file decompresses fully and looks like a MySQL dump. */
export async function verifyDump(file) {
  let head = '';
  let size = 0;
  await pipeline(fs.createReadStream(file), zlib.createGunzip(), async function* sink(source) {
    for await (const chunk of source) {
      size += chunk.length;
      if (head.length < 4000) head += chunk.toString('utf8', 0, 4000);
    }
  });
  return size > 0 && /mysql dump|CREATE TABLE/i.test(head);
}

export async function backupDatabase(user) {
  fs.mkdirSync(backupDir(), { recursive: true });
  const filename = `db-${stamp()}.sql.gz`;
  const file = path.join(backupDir(), filename);
  try {
    await runDump(file);
    const ok = await verifyDump(file);
    const size = fs.statSync(file).size;
    const [id] = await db('backups').insert({
      filename, size_bytes: size, kind: 'DATABASE', status: ok ? 'OK' : 'FAILED', verified_at: ok ? db.fn.now() : null,
      note: ok ? 'Dump written and read back successfully' : 'Dump could not be verified', created_by: user?.id ?? null,
    });
    return db('backups').where({ id }).first();
  } catch (err) {
    await fs.promises.unlink(file).catch(() => {});
    const [id] = await db('backups').insert({ filename, size_bytes: 0, kind: 'DATABASE', status: 'FAILED', note: err.message.slice(0, 480), created_by: user?.id ?? null });
    return db('backups').where({ id }).first();
  }
}

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  let count = 0;
  let bytes = 0;
  for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    await fs.promises.copyFile(path.join(src, entry.name), path.join(dest, entry.name));
    bytes += fs.statSync(path.join(src, entry.name)).size;
    count += 1;
  }
  return { count, bytes };
}

/** Copy uploaded documents and photos into a dated folder next to the database dumps. */
export async function backupFiles(user) {
  const name = `files-${stamp()}`;
  const dest = path.join(backupDir(), name);
  try {
    const { count, bytes } = await copyDir(config.uploadDir, dest);
    const [id] = await db('backups').insert({
      filename: name, size_bytes: bytes, kind: 'FILES', status: 'OK', note: `${count} files copied`, verified_at: db.fn.now(), created_by: user?.id ?? null,
    });
    return db('backups').where({ id }).first();
  } catch (err) {
    const [id] = await db('backups').insert({ filename: name, size_bytes: 0, kind: 'FILES', status: 'FAILED', note: err.message.slice(0, 480), created_by: user?.id ?? null });
    return db('backups').where({ id }).first();
  }
}

export async function latestBackups() {
  const latest = async (kind) => db('backups').where({ kind, status: 'OK' }).orderBy('id', 'desc').first();
  const [database, files] = await Promise.all([latest('DATABASE'), latest('FILES')]);
  const ageHours = (b) => (b ? Math.round((Date.now() - new Date(String(b.created_at).replace(' ', 'T')).getTime()) / 3600000) : null);
  return { database, files, database_age_hours: ageHours(database), files_age_hours: ageHours(files) };
}
