import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { authenticate, require_ } from '../middleware/auth.js';
import { conflict, notFound, parse } from '../middleware/errors.js';
import { canManageSystem, invalidatePermissionCache, loadRolePermissions } from '../lib/permissions.js';
import { logAudit } from '../lib/audit.js';
import {
  DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES, ROLE_LABELS, SYSTEM_ROLES,
} from '../lib/constants.js';
import { DEFAULT_WORKFLOWS } from '../lib/constants.js';
import { listWorkflows } from '../lib/requests.js';
import { channelStatus } from '../lib/channels.js';
import { backupDatabase, backupDir, backupFiles, latestBackups, verifyDump } from '../lib/backup.js';
import { bool, oneOf, reqStr } from '../lib/schemas.js';

const router = Router();
router.use(authenticate, require_(canManageSystem, 'Only a Super Administrator can use system administration.'));

// ------------------------------------------------------------------ system health

const dirSize = (dir) => {
  let total = 0;
  let files = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile()) { total += fs.statSync(path.join(dir, e.name)).size; files += 1; }
    }
  } catch { /* folder missing */ }
  return { bytes: total, files };
};

router.get('/health', async (req, res) => {
  const t0 = Date.now();
  await db.raw('SELECT 1');
  const dbMs = Date.now() - t0;
  const [assets, users, openRequests, unread, failedBackups] = await Promise.all([
    db('assets').count({ n: 'id' }).first(), db('users').where({ is_active: true }).count({ n: 'id' }).first(),
    db('approval_requests').whereIn('status', ['PENDING', 'REVIEWED']).count({ n: 'id' }).first(),
    db('notifications').where({ is_read: 0 }).count({ n: 'id' }).first(),
    db('backups').where({ status: 'FAILED' }).where('created_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 7 DAY)')).count({ n: 'id' }).first(),
  ]);
  const backups = await latestBackups();
  const uploads = dirSize(config.uploadDir);
  const warnings = [];
  if (!backups.database) warnings.push('No successful database backup has been made yet.');
  else if (backups.database_age_hours > 36) warnings.push(`The last database backup is ${backups.database_age_hours} hours old.`);
  if (!backups.files && uploads.files) warnings.push('Uploaded documents have never been backed up.');
  if (Number(failedBackups.n)) warnings.push(`${failedBackups.n} backup(s) failed in the last 7 days.`);
  if (!channelStatus().email) warnings.push('E-mail is not configured (SMTP_HOST), so e-mail notifications are skipped.');
  res.json({
    status: warnings.length ? 'ATTENTION' : 'OK',
    warnings,
    database: { ok: true, latency_ms: dbMs },
    server: { uptime_seconds: Math.round(process.uptime()), node: process.version, memory_mb: Math.round(process.memoryUsage().rss / 1048576) },
    counts: { assets: Number(assets.n), active_users: Number(users.n), open_requests: Number(openRequests.n), unread_notifications: Number(unread.n) },
    uploads, backups, channels: channelStatus(), backup_dir: backupDir(),
  });
});

// ------------------------------------------------------------------ approval workflows

router.get('/workflows', async (req, res) => res.json(await listWorkflows()));

router.put('/workflows/:type', async (req, res) => {
  const type = req.params.type;
  if (!DEFAULT_WORKFLOWS[type]) throw notFound('Unknown request type.');
  const d = parse(z.object({ requires_approval: bool, steps: z.coerce.number().int().min(1).max(2).default(1) }), req.body);
  await db('workflow_configs').insert({ request_type: type, ...d, updated_at: db.fn.now() }).onConflict('request_type').merge();
  await logAudit(null, req.user, { action: 'WORKFLOW_CONFIG', entity: 'workflow', summary: `Approval workflow for ${type}: ${d.requires_approval ? `${d.steps}-step approval` : 'no approval'}`, changes: d });
  res.json({ request_type: type, ...d });
});

// ------------------------------------------------------------------ roles and permissions

router.get('/permissions', async (req, res) => {
  const effective = await loadRolePermissions();
  res.json({
    permissions: Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label })),
    roles: SYSTEM_ROLES.map((role) => ({
      role, label: ROLE_LABELS[role], locked: role === ROLES.SUPER_ADMIN,
      permissions: [...effective[role]].sort(), defaults: [...DEFAULT_ROLE_PERMISSIONS[role]].sort(),
    })),
  });
});

router.put('/permissions/:role', async (req, res) => {
  const role = req.params.role;
  if (!ROLE_LABELS[role]) throw notFound('Unknown role.');
  if (role === ROLES.SUPER_ADMIN) throw conflict('The Super Administrator always has every permission.');
  const { permissions } = parse(z.object({ permissions: z.array(oneOf(Object.keys(PERMISSIONS), 'Permission')).max(100) }), req.body);
  const wanted = new Set(permissions);
  const defaults = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
  await db.transaction(async (trx) => {
    await trx('role_permissions').where({ role }).delete();
    const rows = Object.keys(PERMISSIONS)
      .filter((p) => wanted.has(p) !== defaults.has(p))
      .map((p) => ({ role, permission: p, allowed: wanted.has(p) }));
    if (rows.length) await trx('role_permissions').insert(rows);
    await logAudit(trx, req.user, {
      action: 'PERMISSIONS_CHANGE', entity: 'role', summary: `Permissions changed for ${ROLE_LABELS[role]} (${rows.length} differ from the default)`,
      changes: Object.fromEntries(rows.map((r) => [r.permission, r.allowed])),
    });
  });
  invalidatePermissionCache();
  const effective = await loadRolePermissions();
  res.json({ role, permissions: [...effective[role]].sort() });
});

// ------------------------------------------------------------------ settings

const SETTING_KEYS = {
  report_calendar: 'Calendar of the monthly reports',
};
// Settings chosen from a list: the allowed values (the first is the default) and how each is shown.
const SETTING_CHOICES = {
  report_calendar: { ET: 'Ethiopian calendar', GC: 'Gregorian calendar' },
};

async function getSettings() {
  const rows = await db('system_settings');
  return Object.fromEntries(Object.keys(SETTING_KEYS).map((k) => [k, rows.find((r) => r.key === k)?.value ?? Object.keys(SETTING_CHOICES[k] || { '': '' })[0]]));
}

router.get('/settings', async (req, res) => {
  res.json({ values: await getSettings(), labels: SETTING_KEYS, choices: SETTING_CHOICES });
});

router.put('/settings', async (req, res) => {
  const field = (k) => (SETTING_CHOICES[k] ? oneOf(Object.keys(SETTING_CHOICES[k]), SETTING_KEYS[k]).optional() : z.string().trim().max(300).optional());
  const d = parse(z.object(Object.fromEntries(Object.keys(SETTING_KEYS).map((k) => [k, field(k)]))), req.body);
  for (const [key, value] of Object.entries(d)) {
    if (value === undefined) continue;
    await db('system_settings').insert({ key, value }).onConflict('key').merge();
  }
  await logAudit(null, req.user, { action: 'SETTINGS_CHANGE', entity: 'settings', summary: `System settings changed: ${Object.keys(d).join(', ')}`, changes: d });
  res.json({ values: await getSettings(), labels: SETTING_KEYS, choices: SETTING_CHOICES });
});

// ------------------------------------------------------------------ backups

router.get('/backups', async (req, res) => {
  res.json({ backups: await db('backups').orderBy('id', 'desc').limit(60), latest: await latestBackups(), dir: backupDir() });
});

router.post('/backups', async (req, res) => {
  const { kind } = parse(z.object({ kind: oneOf(['database', 'files', 'both'], 'Kind').default('both') }), req.body ?? {});
  const made = [];
  if (kind !== 'files') made.push(await backupDatabase(req.user));
  if (kind !== 'database') made.push(await backupFiles(req.user));
  await logAudit(null, req.user, { action: 'BACKUP', entity: 'backup', summary: `Backup run: ${made.map((b) => `${b.kind} ${b.status}`).join(', ')}` });
  res.status(made.some((b) => b.status === 'FAILED') ? 500 : 201).json(made);
});

router.post('/backups/:id/verify', async (req, res) => {
  const b = await db('backups').where({ id: req.params.id, kind: 'DATABASE' }).first();
  if (!b) throw notFound('Backup not found.');
  const ok = await verifyDump(path.join(backupDir(), path.basename(b.filename))).catch(() => false);
  await db('backups').where({ id: b.id }).update({ status: ok ? 'OK' : 'FAILED', verified_at: ok ? db.fn.now() : null, note: ok ? 'Verified again: file reads back correctly' : 'Verification failed: file is missing or damaged' });
  res.json(await db('backups').where({ id: b.id }).first());
});

// ------------------------------------------------------------------ API keys for other city systems

router.get('/api-keys', async (req, res) => {
  res.json(await db('api_keys').select('id', 'name', 'key_prefix', 'is_active', 'last_used_at', 'created_at').orderBy('id', 'desc'));
});

router.post('/api-keys', async (req, res) => {
  const { name } = parse(z.object({ name: reqStr(120, 'Name') }), req.body);
  const key = `jam_${crypto.randomBytes(24).toString('hex')}`;
  const [id] = await db('api_keys').insert({
    name, key_prefix: key.slice(0, 8), key_hash: crypto.createHash('sha256').update(key).digest('hex'), created_by: req.user.id,
  });
  await logAudit(null, req.user, { action: 'API_KEY_CREATE', entity: 'api_key', entityId: id, summary: `API key created for "${name}"` });
  // The key is shown exactly once; only its hash is stored.
  res.status(201).json({ id, name, key, note: 'Copy this key now. It cannot be shown again.' });
});

router.post('/api-keys/:id/disable', async (req, res) => {
  const k = await db('api_keys').where({ id: req.params.id }).first();
  if (!k) throw notFound();
  await db('api_keys').where({ id: k.id }).update({ is_active: false });
  await logAudit(null, req.user, { action: 'API_KEY_DISABLE', entity: 'api_key', entityId: k.id, summary: `API key "${k.name}" disabled` });
  res.json({ ok: true });
});

export default router;
