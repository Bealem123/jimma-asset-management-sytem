import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { parse } from '../middleware/errors.js';
import { applyScope, has } from '../lib/permissions.js';
import { REQUEST_STATUSES, REQUEST_TYPES } from '../lib/constants.js';
import { optStr, oneOf, likePattern } from '../lib/schemas.js';
import {
  approveRequest, cancelRequest, getWorkflow, presentRequest, rejectRequest, reviewRequest,
} from '../lib/requests.js';

const router = Router();
router.use(authenticate);

const decorate = async (user, rows) => {
  const out = [];
  for (const r of rows) {
    const wf = await getWorkflow(r.request_type);
    const open = ['PENDING', 'REVIEWED'].includes(r.status);
    const notOwn = !(config.separationOfDuties && r.requested_by === user.id);
    // the Kebele Administrator reviews (step 1 of 2), the Kifle Ketema Administrator gives the final approval
    const mayReview = has(user, 'request.review') && open && notOwn && wf.steps >= 2 && r.status === 'PENDING';
    const mayDecide = has(user, 'request.decide') && open && notOwn;
    out.push({
      ...presentRequest(r),
      steps: wf.steps,
      can_review: mayReview,
      can_approve: mayDecide && (wf.steps < 2 || (r.status === 'REVIEWED' && !(config.separationOfDuties && r.reviewed_by === user.id))),
      can_reject: mayDecide || mayReview,
      can_cancel: open && r.requested_by === user.id,
    });
  }
  return out;
};

router.get('/', async (req, res) => {
  const f = parse(z.object({
    status: z.preprocess((v) => v || undefined, oneOf(REQUEST_STATUSES).optional()),
    type: z.preprocess((v) => v || undefined, oneOf(REQUEST_TYPES).optional()),
    asset_id: z.coerce.number().int().positive().optional(),
    mine: z.enum(['1']).optional(),
    open: z.enum(['1']).optional(),
    q: z.string().trim().max(100).optional(),
    from: z.preprocess((v) => v || undefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    to: z.preprocess((v) => v || undefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  }), req.query);
  const q = applyScope(
    db('approval_requests as r').join('assets', 'assets.id', 'r.asset_id')
      .leftJoin('users as u', 'u.id', 'r.requested_by').leftJoin('users as d', 'd.id', 'r.decided_by')
      .leftJoin('users as rv', 'rv.id', 'r.reviewed_by'),
    req.user,
  ).select('r.*', 'assets.asset_code', 'assets.name as asset_name', 'u.full_name as requested_by_name', 'd.full_name as decided_by_name',
    'rv.full_name as reviewed_by_name')
    .orderBy('r.id', 'desc').limit(300);
  if (f.status) q.where('r.status', f.status);
  if (f.open) q.whereIn('r.status', ['PENDING', 'REVIEWED']);
  if (f.type) q.where('r.request_type', f.type);
  if (f.asset_id) q.where('r.asset_id', f.asset_id);
  if (f.q) q.where((b) => b.where('assets.asset_code', 'like', likePattern(f.q)).orWhere('assets.name', 'like', likePattern(f.q)));
  if (f.from) q.where('r.requested_at', '>=', f.from);
  if (f.to) q.where('r.requested_at', '<=', `${f.to} 23:59:59`);
  if (f.mine) {
    if (req.user.role === 'KEBELE_ADMIN' && req.user.scope?.kebeles?.length) {
      const kebeleUserIds = db('user_kebeles').whereIn('kebele_id', req.user.scope.kebeles).select('user_id');
      q.where((b) => b.where('r.requested_by', req.user.id)
        .orWhereIn('r.requested_by', kebeleUserIds)
        .orWhereIn('assets.kebele_id', req.user.scope.kebeles));
    } else if (req.user.role === 'KIFLE_ADMIN' && req.user.scope?.kifle?.length) {
      const kifleKebeles = db('kebeles').whereIn('kifle_ketema_id', req.user.scope.kifle).select('id');
      const kifleUserIds = db('user_kebeles').whereIn('kebele_id', kifleKebeles).select('user_id');
      q.where((b) => b.where('r.requested_by', req.user.id)
        .orWhereIn('r.requested_by', kifleUserIds)
        .orWhereIn('assets.kifle_ketema_id', req.user.scope.kifle));
    } else {
      q.where('r.requested_by', req.user.id);
    }
  }
  res.json(await decorate(req.user, await q));
});

const note = z.object({ comment: optStr(500) });
const act = (fn) => async (req, res) => {
  const { comment } = parse(note, req.body ?? {});
  res.json(await fn(req.user, Number(req.params.id), comment));
};

router.post('/:id/review', act(reviewRequest));
router.post('/:id/approve', act(approveRequest));
router.post('/:id/reject', act(rejectRequest));
router.post('/:id/cancel', act((user, id) => cancelRequest(user, id)));

export default router;
