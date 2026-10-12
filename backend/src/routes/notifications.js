import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, require_ } from '../middleware/auth.js';
import { notFound, parse } from '../middleware/errors.js';
import { canManageSystem } from '../lib/permissions.js';
import { logAudit } from '../lib/audit.js';
import { NOTIFICATION_TYPES } from '../lib/constants.js';
import { channelStatus } from '../lib/channels.js';
import { runAlertScan } from '../lib/alerts.js';
import { bool } from '../lib/schemas.js';

const router = Router();
router.use(authenticate);

// ---- the signed-in user's own notifications

router.get('/', async (req, res) => {
  const f = parse(z.object({ unread: z.enum(['1']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
  const q = db('notifications as n').leftJoin('assets', 'assets.id', 'n.asset_id').where('n.user_id', req.user.id)
    .select('n.*', 'assets.asset_code').orderBy('n.id', 'desc').limit(f.limit);
  if (f.unread) q.where('n.is_read', 0);
  const rows = await q;
  res.json(rows.map((r) => ({ ...r, is_read: Boolean(r.is_read), type_label: NOTIFICATION_TYPES[r.type]?.label || r.type })));
});

router.get('/count', async (req, res) => {
  const { n } = await db('notifications').where({ user_id: req.user.id, is_read: 0 }).count({ n: 'id' }).first();
  res.json({ unread: Number(n) });
});

router.post('/read-all', async (req, res) => {
  await db('notifications').where({ user_id: req.user.id, is_read: 0 }).update({ is_read: 1 });
  res.json({ ok: true });
});

router.post('/:id/read', async (req, res) => {
  const n = await db('notifications').where({ id: req.params.id, user_id: req.user.id }).first();
  if (!n) throw notFound();
  await db('notifications').where({ id: n.id }).update({ is_read: 1 });
  res.json({ ok: true });
});

// ---- administration: rules and manual scan

router.get('/rules', require_(canManageSystem), async (req, res) => {
  const rows = await db('notification_rules');
  res.json({
    channels: channelStatus(),
    rules: Object.entries(NOTIFICATION_TYPES).map(([type, meta]) => {
      const r = rows.find((x) => x.type === type);
      return {
        type, label: meta.label, scan_based: 'lead' in meta,
        enabled: r ? Boolean(r.enabled) : true, lead_days: r ? r.lead_days : meta.lead ?? null, email: r ? Boolean(r.email) : false, sms: r ? Boolean(r.sms) : false,
      };
    }),
  });
});

router.put('/rules/:type', require_(canManageSystem), async (req, res) => {
  const type = req.params.type;
  if (!NOTIFICATION_TYPES[type]) throw notFound('Unknown notification type.');
  const d = parse(z.object({
    enabled: bool, email: bool.default(false), sms: bool.default(false),
    lead_days: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(0).max(365).nullable()).default(null),
  }), req.body);
  await db('notification_rules').insert({ type, ...d }).onConflict('type').merge();
  await logAudit(null, req.user, { action: 'NOTIFICATION_RULE', entity: 'notification_rule', summary: `Notification rule "${type}" updated`, changes: d });
  res.json({ type, ...d });
});

router.post('/run', require_(canManageSystem), async (req, res) => {
  const created = await runAlertScan();
  await logAudit(null, req.user, { action: 'ALERT_SCAN', entity: 'notification', summary: `Alert scan run manually: ${JSON.stringify(created)}` });
  res.json({ created });
});

export default router;
