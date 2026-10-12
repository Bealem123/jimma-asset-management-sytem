import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { conflict, forbidden, notFound, parse } from '../middleware/errors.js';
import { applyScope, has, scopedAsset } from '../lib/permissions.js';
import { logAudit } from '../lib/audit.js';
import { fail } from '../lib/assetGuards.js';
import { notifyAsset, notifyUser } from '../lib/notify.js';
import { RESERVATION_STATUSES } from '../lib/constants.js';
import { idRef, oneOf, optStr, reqStr } from '../lib/schemas.js';

const router = Router();
router.use(authenticate);

const dateTime = z.string({ error: 'A date and time is required.' })
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, 'Use the format YYYY-MM-DD HH:MM.')
  .transform((s) => `${s.replace('T', ' ')}${s.length === 16 ? ':00' : ''}`);

const UNAVAILABLE = ['DISPOSED', 'RETIRED', 'LOST', 'DAMAGED', 'UNDER_MAINTENANCE', 'PLANNED'];

/** Reservations that overlap the window [start, end) and still hold the asset. */
const overlapping = (assetId, start, end, statuses, exceptId = null) => {
  const q = db('asset_reservations').where({ asset_id: assetId }).whereIn('status', statuses)
    .where('start_at', '<', end).where('end_at', '>', start);
  if (exceptId) q.whereNot('id', exceptId);
  return q;
};

const withNames = (q) => q.join('assets', 'assets.id', 'r.asset_id').leftJoin('users as u', 'u.id', 'r.requested_by')
  .select('r.*', 'assets.asset_code', 'assets.name as asset_name', 'u.full_name as requested_by_name');

router.get('/', async (req, res) => {
  const f = parse(z.object({
    asset_id: z.coerce.number().int().positive().optional(),
    status: z.preprocess((v) => v || undefined, oneOf(RESERVATION_STATUSES).optional()),
    mine: z.enum(['1']).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }), req.query);
  const q = applyScope(withNames(db('asset_reservations as r')), req.user).orderBy('r.start_at', 'desc').limit(300);
  if (f.asset_id) q.where('r.asset_id', f.asset_id);
  if (f.status) q.where('r.status', f.status);
  if (f.mine) q.where('r.requested_by', req.user.id);
  if (f.from) q.where('r.end_at', '>=', f.from);
  if (f.to) q.where('r.start_at', '<=', `${f.to} 23:59:59`);
  const rows = await q;
  res.json(rows.map((r) => ({
    ...r,
    can_decide: has(req.user, 'reservation.decide') && r.status === 'PENDING' && !(config.separationOfDuties && r.requested_by === req.user.id),
    can_cancel: ['PENDING', 'APPROVED'].includes(r.status) && (r.requested_by === req.user.id || has(req.user, 'reservation.decide')),
  })));
});

/** Reservable assets with whether each one is free in the window. */
router.get('/availability', async (req, res) => {
  const f = parse(z.object({ start_at: dateTime, end_at: dateTime }), req.query);
  if (f.end_at <= f.start_at) throw fail('end_at', 'The end must be after the start.');
  const assets = await applyScope(db('assets'), req.user).where('assets.is_reservable', 1).whereNull('assets.archived_at')
    .whereNotIn('assets.status', UNAVAILABLE)
    .select('assets.id', 'assets.asset_code', 'assets.name', 'assets.status', 'assets.location_detail').orderBy('assets.asset_code');
  const busy = assets.length
    ? await db('asset_reservations').whereIn('asset_id', assets.map((a) => a.id)).whereIn('status', ['PENDING', 'APPROVED'])
      .where('start_at', '<', f.end_at).where('end_at', '>', f.start_at)
    : [];
  res.json(assets.map((a) => {
    const holds = busy.filter((b) => b.asset_id === a.id);
    return {
      ...a,
      available: !holds.some((h) => h.status === 'APPROVED'),
      pending_requests: holds.filter((h) => h.status === 'PENDING').length,
      reserved: holds.filter((h) => h.status === 'APPROVED').map((h) => ({ start_at: h.start_at, end_at: h.end_at, purpose: h.purpose })),
    };
  }));
});

router.post('/', async (req, res) => {
  if (!has(req.user, 'reservation.request')) throw forbidden('Your role cannot request reservations.');
  const d = parse(z.object({
    asset_id: idRef, start_at: dateTime, end_at: dateTime, purpose: reqStr(500, 'The purpose'), requester_name: optStr(200),
  }), req.body);
  const asset = await scopedAsset(req.user, d.asset_id);
  if (!asset) throw notFound('Asset not found.');
  if (!asset.is_reservable) throw fail('asset_id', 'This asset cannot be reserved. An administrator can mark it as reservable.');
  if (UNAVAILABLE.includes(asset.status)) throw conflict(`This asset is ${asset.status.toLowerCase().replace('_', ' ')} and cannot be reserved.`);
  if (d.end_at <= d.start_at) throw fail('end_at', 'The end must be after the start.');
  // Pending requests also hold the slot, so two people cannot both be promised the same time.
  const clash = await overlapping(asset.id, d.start_at, d.end_at, ['PENDING', 'APPROVED']).first();
  if (clash) {
    throw conflict(`${asset.asset_code} is already ${clash.status === 'APPROVED' ? 'reserved' : 'requested'} from ${clash.start_at.slice(0, 16)} to ${clash.end_at.slice(0, 16)}.`);
  }

  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('asset_reservations').insert({
      asset_id: asset.id, requested_by: req.user.id, requester_name: d.requester_name || req.user.full_name,
      start_at: d.start_at, end_at: d.end_at, purpose: d.purpose,
    });
    await logAudit(trx, req.user, {
      action: 'RESERVATION_REQUEST', entity: 'reservation', entityId: newId, assetId: asset.id,
      summary: `${asset.asset_code}: reservation requested ${d.start_at.slice(0, 16)} to ${d.end_at.slice(0, 16)} (${d.purpose})`,
    });
    return newId;
  });
  await notifyAsset(asset, 'reservation.decide', {
    exceptUserId: req.user.id, type: 'APPROVAL_PENDING', title: `${asset.asset_code}: reservation waiting for approval`, body: d.purpose,
    link: '/reservations', dedupeKey: `RES:${id}:new`,
  });
  res.status(201).json(await withNames(db('asset_reservations as r')).where('r.id', id).first());
});

async function loadForDecision(req) {
  if (!has(req.user, 'reservation.decide')) throw forbidden('Your role cannot decide reservations.');
  const r = await db('asset_reservations').where({ id: req.params.id }).first();
  if (!r) throw notFound('Reservation not found.');
  const asset = await scopedAsset(req.user, r.asset_id);
  if (!asset) throw notFound('Reservation not found.');
  if (r.status !== 'PENDING') throw conflict(`This reservation is already ${r.status.toLowerCase()}.`);
  if (config.separationOfDuties && r.requested_by === req.user.id) throw conflict('Separation of duties: you cannot decide your own reservation.');
  return { r, asset };
}

router.post('/:id/approve', async (req, res) => {
  const { r, asset } = await loadForDecision(req);
  const clash = await overlapping(asset.id, r.start_at, r.end_at, ['APPROVED'], r.id).first();
  if (clash) throw conflict('Another approved reservation already covers this time.');
  await db('asset_reservations').where({ id: r.id }).update({ status: 'APPROVED', decided_by: req.user.id, decided_at: db.fn.now() });
  await logAudit(null, req.user, {
    action: 'RESERVATION_APPROVE', entity: 'reservation', entityId: r.id, assetId: asset.id,
    summary: `${asset.asset_code}: reservation approved ${r.start_at.slice(0, 16)} to ${r.end_at.slice(0, 16)}`,
  });
  await notifyUser(r.requested_by, {
    type: 'RESERVATION_DECISION', title: `Your reservation of ${asset.asset_code} was approved`,
    body: `${r.start_at.slice(0, 16)} to ${r.end_at.slice(0, 16)}`, assetId: asset.id, link: '/reservations', dedupeKey: `RES:${r.id}:decided`,
  });
  res.json(await withNames(db('asset_reservations as r')).where('r.id', r.id).first());
});

router.post('/:id/reject', async (req, res) => {
  const { comment } = parse(z.object({ comment: reqStr(500, 'A reason') }), req.body);
  const { r, asset } = await loadForDecision(req);
  await db('asset_reservations').where({ id: r.id }).update({ status: 'REJECTED', decided_by: req.user.id, decided_at: db.fn.now(), decision_note: comment });
  await logAudit(null, req.user, {
    action: 'RESERVATION_REJECT', entity: 'reservation', entityId: r.id, assetId: asset.id, summary: `${asset.asset_code}: reservation rejected (${comment})`,
  });
  await notifyUser(r.requested_by, {
    type: 'RESERVATION_DECISION', title: `Your reservation of ${asset.asset_code} was rejected`, body: comment, assetId: asset.id,
    link: '/reservations', dedupeKey: `RES:${r.id}:decided`,
  });
  res.json(await withNames(db('asset_reservations as r')).where('r.id', r.id).first());
});

router.post('/:id/cancel', async (req, res) => {
  const r = await db('asset_reservations').where({ id: req.params.id }).first();
  if (!r) throw notFound('Reservation not found.');
  const asset = await scopedAsset(req.user, r.asset_id);
  if (!asset) throw notFound('Reservation not found.');
  if (r.requested_by !== req.user.id && !has(req.user, 'reservation.decide')) throw forbidden('Only the requester or an approver can cancel a reservation.');
  if (!['PENDING', 'APPROVED'].includes(r.status)) throw conflict(`This reservation is already ${r.status.toLowerCase()}.`);
  await db('asset_reservations').where({ id: r.id }).update({ status: 'CANCELLED', decided_by: req.user.id, decided_at: db.fn.now(), decision_note: 'Cancelled' });
  await logAudit(null, req.user, { action: 'RESERVATION_CANCEL', entity: 'reservation', entityId: r.id, assetId: asset.id, summary: `${asset.asset_code}: reservation cancelled` });
  res.json(await withNames(db('asset_reservations as r')).where('r.id', r.id).first());
});

export default router;
