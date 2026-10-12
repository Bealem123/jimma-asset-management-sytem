import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, require_ } from '../middleware/auth.js';
import { parse } from '../middleware/errors.js';
import { canViewAudit } from '../lib/permissions.js';
import { likePattern, optDate, optIdRef } from '../lib/schemas.js';

const router = Router();
router.use(authenticate, require_(canViewAudit, 'Only administrators and auditors can view the audit log.'));

router.get('/', async (req, res) => {
  const f = parse(z.object({
    q: z.string().trim().max(100).optional(),
    action: z.string().max(40).optional(),
    entity: z.string().max(40).optional(),
    asset_id: optIdRef,
    user_id: optIdRef,
    from: optDate,
    to: optDate,
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(50),
  }), req.query);

  const build = () => {
    const q = db('audit_logs as a').leftJoin('assets', 'assets.id', 'a.asset_id');
    if (f.q) q.where('a.summary', 'like', likePattern(f.q));
    if (f.action) q.where('a.action', f.action);
    if (f.entity) q.where('a.entity', f.entity);
    if (f.asset_id) q.where('a.asset_id', f.asset_id);
    if (f.user_id) q.where('a.user_id', f.user_id);
    if (f.from) q.where('a.created_at', '>=', `${f.from} 00:00:00`);
    if (f.to) q.where('a.created_at', '<=', `${f.to} 23:59:59`);
    return q;
  };

  const { total } = await build().count({ total: 'a.id' }).first();
  const rows = await build()
    .select('a.*', 'assets.asset_code')
    .orderBy('a.id', 'desc')
    .limit(f.page_size)
    .offset((f.page - 1) * f.page_size);
  res.json({ rows, total: Number(total), page: f.page, page_size: f.page_size });
});

export default router;
