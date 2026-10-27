import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { HttpError, conflict, forbidden, notFound, parse } from '../middleware/errors.js';
import { allowedAreas, applyScope, has, hasAllScope } from '../lib/permissions.js';
import { logAudit } from '../lib/audit.js';
import { fail, findVisibleByCodeOrId } from '../lib/assetGuards.js';
import { notifyAsset } from '../lib/notify.js';
import { RETIRED_LABEL, readLabel } from '../lib/publicAsset.js';
import { toCsv } from '../lib/csv.js';
import { CONDITIONS, ROLES, VERIFICATION_RESULTS } from '../lib/constants.js';
import {
  bool, lat, lng, oneOf, optDate, optIdRef, optStr, reqStr, likePattern
} from '../lib/schemas.js';

// Physical verification: the City compares what the database says with what officers find on the ground.
// Example: the database says AST-000125 is in Kebele 05, an officer finds it in Kebele 07 ->
// discrepancy detected -> investigation -> correction approved -> history preserved.

const router = Router();
router.use(authenticate);

// Who may follow a stock-taking: those who record or manage it, the keepers of the assets (asset.edit), who see
// the results for their own assets without recording them, and the Internal Auditor, read-only and city-wide.
const needView = (user) => {
  if (user.role === ROLES.AUDITOR) return;
  if (!['verification.record', 'verification.manage', 'asset.edit'].some((p) => has(user, p))) throw forbidden('Your role cannot take part in verification.');
};
const needManage = (user) => { if (!has(user, 'verification.manage')) throw forbidden('Only a verification manager can do this.'); };

const itemsQuery = (user) => applyScope(
  db('verification_items as i').join('assets', 'assets.id', 'i.asset_id')
    .leftJoin('kifle_ketemas as ek', 'ek.id', 'i.expected_kifle_ketema_id').leftJoin('kebeles as eb', 'eb.id', 'i.expected_kebele_id')
    .leftJoin('kifle_ketemas as fk', 'fk.id', 'i.found_kifle_ketema_id').leftJoin('kebeles as fb', 'fb.id', 'i.found_kebele_id')
    .leftJoin('users as v', 'v.id', 'i.verified_by'),
  user,
).select(
  'i.*', 'assets.asset_code', 'assets.name as asset_name', 'ek.name as expected_kifle_name', 'eb.name as expected_kebele_name',
  'fk.name as found_kifle_name', 'fb.name as found_kebele_name', 'v.full_name as verified_by_name',
);

async function loadCampaign(id) {
  const c = await db('verification_campaigns').where({ id }).first();
  if (!c) throw notFound('Verification campaign not found.');
  return c;
}

async function summary(user, campaignId) {
  const rows = await applyScope(db('verification_items as i').join('assets', 'assets.id', 'i.asset_id'), user)
    .where('i.campaign_id', campaignId).select('i.result', 'i.discrepancy_status').count({ n: 'i.id' }).groupBy('i.result', 'i.discrepancy_status');
  const s = { total: 0, pending: 0, found: 0, missing: 0, wrong_location: 0, duplicate: 0, open_discrepancies: 0, corrected: 0, dismissed: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    s.total += n;
    if (r.result === 'PENDING') s.pending += n;
    if (r.result === 'FOUND') s.found += n;
    if (r.result === 'MISSING') s.missing += n;
    if (r.result === 'WRONG_LOCATION') s.wrong_location += n;
    if (r.result === 'DUPLICATE') s.duplicate += n;
    if (['OPEN', 'INVESTIGATING'].includes(r.discrepancy_status)) s.open_discrepancies += n;
    if (r.discrepancy_status === 'CORRECTED') s.corrected += n;
    if (r.discrepancy_status === 'DISMISSED') s.dismissed += n;
  }
  s.verified = s.total - s.pending;
  s.progress = s.total ? Math.round((s.verified / s.total) * 100) : 0;
  return s;
}

// ------------------------------------------------------------------ campaigns

router.get('/', async (req, res) => {
  needView(req.user);
  const f = parse(z.object({
    q: z.string().trim().max(100).optional(),
    status: z.preprocess((v) => v || undefined, z.enum(['OPEN', 'CLOSED']).optional()),
  }), req.query);
  const q = db('verification_campaigns as c').leftJoin('users as u', 'u.id', 'c.created_by')
    .leftJoin('kifle_ketemas as k', 'k.id', 'c.kifle_ketema_id').leftJoin('kebeles as b', 'b.id', 'c.kebele_id').leftJoin('sectors as s', 's.id', 'c.sector_id')
    .select('c.*', 'u.full_name as created_by_name', 'k.name as kifle_ketema_name', 'b.name as kebele_name', 's.name as sector_name')
    .orderBy('c.id', 'desc').limit(100);
  if (f.q) q.where('c.name', 'like', likePattern(f.q));
  if (f.status) q.where('c.status', f.status);
  // only the stock-takings that include at least one asset of the user's own area
  if (!hasAllScope(req.user)) {
    q.whereIn('c.id', applyScope(db('verification_items as vi').join('assets', 'assets.id', 'vi.asset_id'), req.user).distinct('vi.campaign_id'));
  }
  const campaigns = await q;
  const out = [];
  for (const c of campaigns) out.push({ ...c, summary: await summary(req.user, c.id) });
  res.json(out);
});

router.post('/', async (req, res) => {
  needManage(req.user);
  const d = parse(z.object({
    name: reqStr(200, 'Name'), kifle_ketema_id: optIdRef, kebele_id: optIdRef, sector_id: optIdRef, due_date: optDate,
  }), req.body);
  // the area must be the user's own, and a Kebele must lie in the Kifle Ketema chosen with it
  const allowed = await allowedAreas(req.user);
  if (d.kifle_ketema_id && allowed && !allowed.kifle.has(d.kifle_ketema_id)) throw fail('kifle_ketema_id', 'This Kifle Ketema is outside your area.');
  if (d.kebele_id) {
    const kebele = await db('kebeles').where({ id: d.kebele_id }).first();
    if (!kebele || (allowed && !allowed.kebeles.has(d.kebele_id))) throw fail('kebele_id', 'This Kebele is outside your area.');
    if (d.kifle_ketema_id && kebele.kifle_ketema_id !== d.kifle_ketema_id) throw fail('kebele_id', 'This Kebele is not in the chosen Kifle Ketema.');
  }
  if (d.sector_id && req.user.role === 'SECTOR_ADMIN' && !req.user.scope.sectors.includes(d.sector_id)) throw fail('sector_id', 'This sector is outside your area.');
  // one Kebele (or Kifle Ketema) in all: the stock-taking is named after it, not "the whole area you can see"
  if (allowed && !d.kebele_id && !d.kifle_ketema_id) {
    if (allowed.kebeles.size === 1) [d.kebele_id] = allowed.kebeles;
    else if (allowed.kifle.size === 1) [d.kifle_ketema_id] = allowed.kifle;
  }
  if (d.kebele_id && !d.kifle_ketema_id) d.kifle_ketema_id = (await db('kebeles').where({ id: d.kebele_id }).first()).kifle_ketema_id;
  const q = applyScope(db('assets'), req.user).whereNotIn('assets.status', ['DISPOSED', 'PLANNED']).whereNull('assets.archived_at')
    .where('assets.approval_state', 'ACTIVE');
  if (d.kebele_id) q.where('assets.kebele_id', d.kebele_id);
  if (d.kifle_ketema_id) q.where('assets.kifle_ketema_id', d.kifle_ketema_id);
  if (d.sector_id) q.where('assets.sector_id', d.sector_id);
  const assets = await q.select('assets.id', 'assets.kifle_ketema_id', 'assets.kebele_id', 'assets.location_detail', 'assets.condition');
  if (!assets.length) throw fail('name', 'No active assets match this area, so there is nothing to verify.');
  if (assets.length > 5000) throw fail('name', 'Too many assets for one campaign (limit 5000). Choose a smaller area.');

  const id = await db.transaction(async (trx) => {
    const [cid] = await trx('verification_campaigns').insert({ ...d, created_by: req.user.id });
    for (let i = 0; i < assets.length; i += 500) {
      await trx('verification_items').insert(assets.slice(i, i + 500).map((a) => ({
        campaign_id: cid, asset_id: a.id, expected_kifle_ketema_id: a.kifle_ketema_id, expected_kebele_id: a.kebele_id,
        expected_location_detail: a.location_detail, expected_condition: a.condition,
      })));
    }
    await logAudit(trx, req.user, {
      action: 'VERIFICATION_OPEN', entity: 'verification', entityId: cid, summary: `Verification campaign "${d.name}" opened for ${assets.length} assets`,
    });
    return cid;
  });
  res.status(201).json({ ...(await loadCampaign(id)), summary: await summary(req.user, id) });
});

router.get('/:id', async (req, res) => {
  needView(req.user);
  const c = await loadCampaign(req.params.id);
  const f = parse(z.object({
    result: z.string().max(20).optional(), discrepancy: z.string().max(20).optional(), q: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1), page_size: z.coerce.number().int().min(1).max(200).default(50),
  }), req.query);
  const build = () => {
    const q = itemsQuery(req.user).where('i.campaign_id', c.id);
    if (f.result) q.where('i.result', f.result);
    if (f.discrepancy === 'open') q.whereIn('i.discrepancy_status', ['OPEN', 'INVESTIGATING']);
    else if (f.discrepancy) q.where('i.discrepancy_status', f.discrepancy);
    if (f.q) q.where((b) => b.where('assets.asset_code', 'like', likePattern(f.q)).orWhere('assets.name', 'like', likePattern(f.q)));
    return q;
  };
  const { n } = await build().clear('select').count({ n: 'i.id' }).first();
  const items = await build().orderBy('assets.asset_code').limit(f.page_size).offset((f.page - 1) * f.page_size);
  res.json({
    campaign: c, summary: await summary(req.user, c.id), items, total: Number(n), page: f.page, page_size: f.page_size,
    can_manage: has(req.user, 'verification.manage'), can_record: has(req.user, 'verification.record'),
  });
});

// ------------------------------------------------------------------ recording what the officer found

const recordSchema = z.object({
  asset: reqStr(300, 'The asset'), // what the label holds (asset code or QR card address), or the id
  result: oneOf(VERIFICATION_RESULTS, 'Result').default('FOUND'),
  found_kifle_ketema_id: optIdRef,
  found_kebele_id: optIdRef,
  found_location_detail: optStr(255),
  found_condition: z.preprocess((v) => v || null, oneOf(CONDITIONS, 'Condition').nullable()).default(null),
  latitude: lat,
  longitude: lng,
  method: oneOf(['MANUAL', 'SCAN'], 'Method').default('MANUAL'),
  notes: optStr(2000),
});

router.post('/:id/record', async (req, res) => {
  if (!has(req.user, 'verification.record')) throw forbidden('Your role cannot record verification results.');
  const c = await loadCampaign(req.params.id);
  if (c.status !== 'OPEN') throw conflict('This campaign is closed.');
  const d = parse(recordSchema, req.body);
  const label = await readLabel(d.asset);
  if (label?.retired) throw new HttpError(410, RETIRED_LABEL);
  const asset = await findVisibleByCodeOrId(req.user, label?.code || d.asset);
  const item = await db('verification_items').where({ campaign_id: c.id, asset_id: asset.id }).first();
  if (!item) throw new HttpError(404, `${asset.asset_code} is not part of this campaign.`);
  if (['CORRECTED', 'DISMISSED'].includes(item.discrepancy_status)) throw conflict('This asset was already verified and its discrepancy resolved.');

  let found = {
    found_kifle_ketema_id: null, found_kebele_id: null, found_location_detail: d.found_location_detail,
  };
  let result = d.result;
  if (result === 'FOUND' || result === 'WRONG_LOCATION') {
    // If the officer says nothing about where it was, it was found where the database expects it.
    const where = d.found_kebele_id || d.found_kifle_ketema_id
      ? { kebele: d.found_kebele_id, kifle: d.found_kifle_ketema_id }
      : { kebele: item.expected_kebele_id, kifle: item.expected_kifle_ketema_id };
    let kifleId = where.kifle;
    if (where.kebele) {
      const kebele = await db('kebeles').where({ id: where.kebele }).first();
      if (!kebele) throw fail('found_kebele_id', 'Unknown Kebele.');
      if (!kebele.kifle_ketema_id) throw fail('found_kebele_id', 'This Kebele is not yet linked to a Kifle Ketema.');
      if (kifleId && kifleId !== kebele.kifle_ketema_id) throw fail('found_kebele_id', 'This Kebele does not belong to the chosen Kifle Ketema.');
      kifleId = kebele.kifle_ketema_id;
    } else if (!(await db('kifle_ketemas').where({ id: kifleId }).first())) {
      throw fail('found_kifle_ketema_id', 'Unknown Kifle Ketema.');
    }
    found = { found_kifle_ketema_id: kifleId, found_kebele_id: where.kebele ?? null, found_location_detail: d.found_location_detail ?? item.expected_location_detail };
    const sameKebele = (where.kebele ?? null) === (item.expected_kebele_id ?? null);
    result = kifleId === item.expected_kifle_ketema_id && sameKebele ? 'FOUND' : 'WRONG_LOCATION';
  }
  const discrepancy = result === 'FOUND' ? 'NONE' : 'OPEN';

  await db.transaction(async (trx) => {
    await trx('verification_items').where({ id: item.id }).update({
      result, ...found, found_condition: d.found_condition, latitude: d.latitude, longitude: d.longitude, method: d.method, notes: d.notes,
      verified_by: req.user.id, verified_at: db.fn.now(), discrepancy_status: discrepancy,
    });
    if (d.method === 'SCAN') {
      await trx('scan_events').insert({ asset_id: asset.id, user_id: req.user.id, context: 'VERIFICATION', latitude: d.latitude, longitude: d.longitude });
    }
    await logAudit(trx, req.user, {
      action: 'VERIFICATION_RECORD', entity: 'verification', entityId: item.id, assetId: asset.id,
      summary: `${asset.asset_code}: verification "${c.name}" - ${result.toLowerCase().replace('_', ' ')}${discrepancy === 'OPEN' ? ' (discrepancy)' : ''}`,
      changes: result === 'FOUND' ? null : { result, found_kebele_id: found.found_kebele_id, expected_kebele_id: item.expected_kebele_id },
    });
  });
  if (discrepancy === 'OPEN') {
    await notifyAsset(asset, 'verification.manage', {
      exceptUserId: req.user.id, type: result === 'MISSING' ? 'ASSET_MISSING' : 'VERIFICATION_DISCREPANCY',
      title: `${asset.asset_code}: ${result === 'MISSING' ? 'not found during verification' : 'verification discrepancy'}`,
      body: `${asset.name} - campaign "${c.name}"`, link: `/verification/${c.id}`, dedupeKey: `VER:${item.id}:${result}`,
    });
  }
  res.json((await itemsQuery(req.user).where('i.id', item.id).first()));
});

// ------------------------------------------------------------------ investigating and correcting discrepancies

router.post('/items/:itemId/resolve', async (req, res) => {
  needManage(req.user);
  const d = parse(z.object({ action: oneOf(['INVESTIGATE', 'CORRECT', 'DISMISS'], 'Action'), note: optStr(500) }), req.body);
  const item = await itemsQuery(req.user).where('i.id', req.params.itemId).first();
  if (!item) throw notFound('Item not found.');
  if (!['OPEN', 'INVESTIGATING'].includes(item.discrepancy_status)) throw conflict('There is no open discrepancy on this item.');
  if (d.action !== 'INVESTIGATE' && !d.note) throw fail('note', 'Please explain the decision.');
  if (config.separationOfDuties && d.action !== 'INVESTIGATE' && item.verified_by === req.user.id) {
    throw conflict('Separation of duties: the officer who recorded the finding cannot approve its correction.');
  }
  const asset = await db('assets').where({ id: item.asset_id }).first();

  await db.transaction(async (trx) => {
    if (d.action === 'INVESTIGATE') {
      await trx('verification_items').where({ id: item.id }).update({ discrepancy_status: 'INVESTIGATING', resolution_note: d.note });
      await logAudit(trx, req.user, { action: 'VERIFICATION_INVESTIGATE', entity: 'verification', entityId: item.id, assetId: asset.id, summary: `${asset.asset_code}: discrepancy under investigation${d.note ? ` (${d.note})` : ''}` });
      return;
    }
    if (d.action === 'DISMISS') {
      await trx('verification_items').where({ id: item.id }).update({ discrepancy_status: 'DISMISSED', resolution_note: d.note, resolved_by: req.user.id, resolved_at: db.fn.now() });
      await logAudit(trx, req.user, { action: 'VERIFICATION_DISMISS', entity: 'verification', entityId: item.id, assetId: asset.id, summary: `${asset.asset_code}: discrepancy dismissed (${d.note})` });
      return;
    }
    // CORRECT: make the database match reality, keeping the old values in history
    if (item.result === 'WRONG_LOCATION') {
      await trx('asset_transfers').insert({
        asset_id: asset.id, from_kifle_ketema_id: asset.kifle_ketema_id, from_kebele_id: asset.kebele_id, from_location_detail: asset.location_detail,
        to_kifle_ketema_id: item.found_kifle_ketema_id, to_kebele_id: item.found_kebele_id, to_location_detail: item.found_location_detail,
        transfer_date: new Date().toISOString().slice(0, 10), reason: `Location corrected after physical verification: ${d.note}`,
        authorized_by: req.user.full_name, recorded_by: req.user.id, approved_by: req.user.id,
      });
      await trx('assets').where({ id: asset.id }).update({
        kifle_ketema_id: item.found_kifle_ketema_id, kebele_id: item.found_kebele_id, location_detail: item.found_location_detail, updated_at: db.fn.now(),
      });
      await logAudit(trx, req.user, {
        action: 'LOCATION_CORRECTION', entity: 'asset', entityId: asset.id, assetId: asset.id,
        summary: `${asset.asset_code}: location corrected after verification (${d.note})`,
        changes: { kebele_id: { from: asset.kebele_id, to: item.found_kebele_id }, kifle_ketema_id: { from: asset.kifle_ketema_id, to: item.found_kifle_ketema_id } },
      });
    } else if (item.result === 'MISSING') {
      await trx('assets').where({ id: asset.id }).update({ status: 'LOST', updated_at: db.fn.now() });
      await logAudit(trx, req.user, {
        action: 'STATUS_CHANGE', entity: 'asset', entityId: asset.id, assetId: asset.id,
        summary: `${asset.asset_code}: status ${asset.status} → LOST (confirmed missing in verification: ${d.note})`,
        changes: { status: { from: asset.status, to: 'LOST' } },
      });
    } else if (item.result === 'DUPLICATE') {
      await trx('follow_up_actions').insert({
        asset_id: asset.id, source_type: 'VERIFICATION', source_id: item.id, created_by: req.user.id,
        description: `Resolve duplicate registration found in verification: ${d.note}`,
      });
    }
    if (item.found_condition && item.found_condition !== asset.condition && item.result !== 'MISSING') {
      await trx('assets').where({ id: asset.id }).update({ condition: item.found_condition });
      await logAudit(trx, req.user, {
        action: 'CONDITION_CHANGE', entity: 'asset', entityId: asset.id, assetId: asset.id,
        summary: `${asset.asset_code}: condition ${asset.condition} → ${item.found_condition} (verification)`, changes: { condition: { from: asset.condition, to: item.found_condition } },
      });
    }
    await trx('verification_items').where({ id: item.id }).update({ discrepancy_status: 'CORRECTED', resolution_note: d.note, resolved_by: req.user.id, resolved_at: db.fn.now() });
    await logAudit(trx, req.user, { action: 'VERIFICATION_CORRECT', entity: 'verification', entityId: item.id, assetId: asset.id, summary: `${asset.asset_code}: discrepancy corrected (${d.note})` });
  });
  res.json(await itemsQuery(req.user).where('i.id', item.id).first());
});

// ------------------------------------------------------------------ closing and reporting

router.post('/:id/close', async (req, res) => {
  needManage(req.user);
  const c = await loadCampaign(req.params.id);
  if (c.status !== 'OPEN') throw conflict('This campaign is already closed.');
  const { mark_unverified_missing } = parse(z.object({ mark_unverified_missing: bool.default(false) }), req.body ?? {});
  let marked = 0;
  await db.transaction(async (trx) => {
    if (mark_unverified_missing) {
      marked = await trx('verification_items').where({ campaign_id: c.id, result: 'PENDING' })
        .update({ result: 'MISSING', discrepancy_status: 'OPEN', notes: 'Not found by the closing date', verified_by: req.user.id, verified_at: db.fn.now() });
    }
    await trx('verification_campaigns').where({ id: c.id }).update({ status: 'CLOSED', closed_at: db.fn.now() });
    await logAudit(trx, req.user, {
      action: 'VERIFICATION_CLOSE', entity: 'verification', entityId: c.id,
      summary: `Verification campaign "${c.name}" closed${marked ? ` (${marked} unverified assets marked missing)` : ''}`,
    });
  });
  res.json({ ...(await loadCampaign(c.id)), summary: await summary(req.user, c.id) });
});

router.get('/:id/report.csv', async (req, res) => {
  needView(req.user);
  const c = await loadCampaign(req.params.id);
  const rows = await itemsQuery(req.user).where('i.campaign_id', c.id).orderBy('assets.asset_code');
  await logAudit(null, req.user, { action: 'EXPORT', entity: 'verification', entityId: c.id, summary: `Exported verification report "${c.name}" (${rows.length} rows)` });
  const cols = [
    ['asset_code', 'Asset ID'], ['asset_name', 'Asset'], ['expected_kifle_name', 'Expected Kifle Ketema'], ['expected_kebele_name', 'Expected Kebele'],
    ['expected_location_detail', 'Expected location'], ['result', 'Result'], ['found_kifle_name', 'Found Kifle Ketema'], ['found_kebele_name', 'Found Kebele'],
    ['found_location_detail', 'Found location'], ['found_condition', 'Condition found'], ['discrepancy_status', 'Discrepancy'], ['resolution_note', 'Resolution'],
    ['verified_by_name', 'Verified by'], ['verified_at', 'Verified at'], ['method', 'Method'], ['notes', 'Notes'],
  ].map(([key, label]) => ({ key, label }));
  res.type('text/csv; charset=utf-8').attachment(`verification-${c.id}.csv`).send(toCsv(cols, rows));
});

export default router;
