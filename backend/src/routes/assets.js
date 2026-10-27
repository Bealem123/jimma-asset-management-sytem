import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { HttpError, badRequest, conflict, forbidden, notFound, parse } from '../middleware/errors.js';
import { applyScope, has, maskFinancial, canViewFinancial, inScope } from '../lib/permissions.js';
import { diff, logAudit } from '../lib/audit.js';
import { assetBase, applyFilters, normalizeAsset, parseDetails } from '../lib/assetQuery.js';
import { TRANSITIONS, checkTransition } from '../lib/workflow.js';
import { toCsv } from '../lib/csv.js';
import {
  APPROVAL_STATES, CONDITIONS, DOC_RELATED, DOC_TYPES, INSPECTION_RESULTS, MAINTENANCE_KINDS, MAINTENANCE_STATUSES, OWNERSHIP_TYPES,
  ROLES, STATUSES, USE_TYPES,
} from '../lib/constants.js';
import {
  bool, dateStr, lat, lng, money, oneOf, optDate, optIdRef, optNameText, optPastDate, optStr, pastDate, present, reqNameText, reqPersonName, reqStr,
} from '../lib/schemas.js';
import {
  assetCode, fail, getVisibleAsset, guardAsset, resolveRefs,
} from '../lib/assetGuards.js';
import { ASSET_FIELDS, acquisitionSchema, assertNoDuplicates, assetSchema } from '../lib/assetSchemas.js';
import { submitOrExecute } from '../lib/requests.js';
import { notifyAsset, notifyUser } from '../lib/notify.js';
import { depreciation } from '../lib/depreciation.js';
import { evidenceSchema, isOwnLabel, placeCheck } from '../lib/siteCheck.js';
import { MONEY_DETAIL_KEYS, cleanDetails } from '../lib/sectorFields.js';
import { notAfterToday } from '../lib/calendar.js';
import { assertFileContent } from '../lib/security.js';
import { recordValuation, valuationSchema } from '../lib/money.js';

const router = Router();
router.use(authenticate);

const FINANCIAL_DOC_TYPES = ['PURCHASE', 'INVOICE', 'CONTRACT'];
const asset_ = (user) => (row) => maskFinancial(user, normalizeAsset(row));

const createSchema = assetSchema.extend({
  status: oneOf(['PLANNED', 'REGISTERED'], 'Initial status').default('REGISTERED'),
  current_valuation: money,
  valuation_date: optPastDate,
  acquisition: acquisitionSchema.nullish(),
  submit: bool.default(false), // enter the approval workflow straight away
});

// A registration carries a photo of the asset: the form sends multipart, the fields as JSON in "data" and the
// picture in "photo". An asset is never sent for verification without a photo (see also the submit step below).
fs.mkdirSync(config.uploadDir, { recursive: true });
const PHOTO_TYPES = { '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'] };
const registrationPhoto = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = PHOTO_TYPES[path.extname(file.originalname).toLowerCase()]?.includes(file.mimetype);
    cb(ok ? null : badRequest('Please correct the highlighted fields.', { photo: 'Use a JPG, PNG or WebP picture.' }), Boolean(ok));
  },
}).single('photo');
const NEEDS_PHOTO = 'Add a photo of the asset before sending it for verification.';
const sectorCode = async (sectorId) => (await db('sectors').where({ id: sectorId }).first('code'))?.code;
const hasPhoto = async (assetId) => Boolean(await db('asset_documents').where({ asset_id: assetId, doc_type: 'PHOTO' }).first('id'));

// ------------------------------------------------------------------ list / export

export const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category_id: optIdRef,
  asset_type_id: optIdRef,
  sector_id: optIdRef,
  department_id: optIdRef,
  kifle_ketema_id: optIdRef,
  kebele_id: optIdRef,
  status: z.preprocess((v) => v || undefined, oneOf(STATUSES).optional()),
  condition: z.preprocess((v) => v || undefined, oneOf(CONDITIONS).optional()),
  approval_state: z.preprocess((v) => v || undefined, oneOf(APPROVAL_STATES).optional()),
  ownership_type: z.preprocess((v) => v || undefined, oneOf(OWNERSHIP_TYPES).optional()),
  revenue: z.preprocess((v) => v || undefined, z.enum(['yes', 'no']).optional()),
  reservable: z.preprocess((v) => v || undefined, z.enum(['yes']).optional()),
  maintenance: z.preprocess((v) => v || undefined, z.enum(['due']).optional()),
  serial_number: z.string().trim().max(120).optional(),
  responsible: z.string().trim().max(160).optional(),
  location: z.string().trim().max(160).optional(),
  include_archived: bool.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['asset_code', 'name', 'status', 'condition', 'created_at', 'updated_at', 'approval_state_at']).default('asset_code'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

const latest = (col, as) => db.raw(`(SELECT c.${col} FROM asset_site_checks c WHERE c.asset_id = assets.id ORDER BY c.id DESC LIMIT 1) AS ${as}`);
const LATEST_SITE_CHECK = [
  latest('distance_m', 'site_distance_m'), latest('far', 'site_far'), latest('qr_scanned', 'site_qr_scanned'),
  latest('found_condition', 'site_found_condition'), latest('location_saved', 'site_location_saved'), latest('created_at', 'site_checked_at'),
];

// The only asset record that may be removed outright: a draft its registrar never sent for verification (a mistake
// or a duplicate nobody else has seen). Every other asset leaves through retirement, disposal and archiving, so the
// register keeps its history. A rejected registration comes back as a draft but was sent once: it stays.
const NOT_DELETABLE = 'Only a draft that was never sent for verification can be deleted, and only by the person who registered it. Retire or dispose of other assets instead.';
async function deletableIds(user, assets) {
  const drafts = assets.filter((a) => a.approval_state === 'DRAFT' && a.created_by === user.id).map((a) => a.id);
  if (!drafts.length) return new Set();
  const sent = new Set(await db('audit_logs').whereIn('asset_id', drafts).where('action', 'SUBMIT').distinct().pluck('asset_id'));
  return new Set(drafts.filter((id) => !sent.has(id)));
}

router.get('/', async (req, res) => {
  const f = parse(listSchema, req.query);
  const filtered = () => applyFilters(applyScope(db('assets'), req.user), f);
  const { n } = await filtered().count({ n: 'assets.id' }).first();
  const q = applyFilters(applyScope(assetBase(), req.user), f)
    .orderBy(`assets.${f.sort}`, f.dir).orderBy('assets.id', 'desc')
    .limit(f.page_size).offset((f.page - 1) * f.page_size);
  if (f.approval_state) q.select(LATEST_SITE_CHECK); // the approval queues show the evidence from the site
  const rows = await q;
  const deletable = await deletableIds(req.user, rows);
  res.json({ rows: rows.map((r) => ({ ...asset_(req.user)(r), can_delete: deletable.has(r.id) })), total: Number(n), page: f.page, page_size: f.page_size });
});

// What a registration itself creates goes with the draft; any other record (a use, maintenance, a request ...)
// means the asset has been worked on, and it stays. The audit trail and notifications are kept as they are.
const DRAFT_PARTS = ['asset_documents', 'asset_valuations', 'asset_acquisitions', 'scan_events'];
const KEPT_APART = ['audit_logs', 'notifications'];

router.delete('/:id', guardAsset('asset.create'), async (req, res) => {
  const asset = req.asset;
  if (!(await deletableIds(req.user, [asset])).has(asset.id)) throw conflict(NOT_DELETABLE);
  const tables = (await db('information_schema.COLUMNS').whereRaw('TABLE_SCHEMA = DATABASE()').where('COLUMN_NAME', 'asset_id').pluck('TABLE_NAME'))
    .filter((tbl) => !DRAFT_PARTS.includes(tbl) && !KEPT_APART.includes(tbl));
  for (const tbl of tables) {
    if (await db(tbl).where({ asset_id: asset.id }).first()) {
      throw conflict('This draft already has other records (a use, maintenance, a request ...), so it stays. Correct it, or ask for it to be retired.');
    }
  }
  const files = await db('asset_documents').where({ asset_id: asset.id }).pluck('stored_name');
  try {
    await db.transaction(async (trx) => {
      for (const tbl of DRAFT_PARTS) await trx(tbl).where({ asset_id: asset.id }).delete();
      await trx('assets').where({ id: asset.id }).delete();
      await logAudit(trx, req.user, {
        action: 'DELETE', entity: 'asset', entityId: asset.id, assetId: asset.id,
        summary: `${asset.asset_code}: draft "${asset.name}" deleted by its registrar before it was sent for verification`,
      });
    });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') throw conflict(NOT_DELETABLE);
    throw err;
  }
  await Promise.all(files.map((f) => fs.promises.unlink(path.join(config.uploadDir, path.basename(f))).catch(() => {})));
  res.json({ ok: true });
});

const EXPORT_COLUMNS = [
  { key: 'asset_code', label: 'Asset ID' }, { key: 'name', label: 'Name' }, { key: 'category_name', label: 'Category' },
  { key: 'asset_type_name', label: 'Type' }, { key: 'serial_number', label: 'Serial number' }, { key: 'registration_number', label: 'Registration number' },
  { key: 'sector_name', label: 'Sector' }, { key: 'department_name', label: 'Department' },
  { key: 'kifle_ketema_name', label: 'Kifle Ketema' }, { key: 'kebele_name', label: 'Kebele' }, { key: 'location_detail', label: 'Location' },
  { key: 'latitude', label: 'Latitude' }, { key: 'longitude', label: 'Longitude' },
  { key: 'owner_name', label: 'Owner' }, { key: 'ownership_type', label: 'Ownership type' }, { key: 'responsible_office', label: 'Responsible office' },
  { key: 'responsible_officer', label: 'Responsible officer' }, { key: 'current_holder', label: 'Current holder' },
  { key: 'condition', label: 'Condition' }, { key: 'status', label: 'Status' }, { key: 'approval_state', label: 'Approval state' },
  { key: 'generates_revenue', label: 'Generates revenue now' }, { key: 'acquisition_date', label: 'Acquisition date' },
  { key: 'acquisition_cost', label: 'Acquisition cost (ETB)', financial: true }, { key: 'current_valuation', label: 'Current valuation (ETB)', financial: true },
];

router.get('/export.csv', async (req, res) => {
  if (!has(req.user, 'asset.export')) throw forbidden('Your role cannot export data.');
  const f = parse(listSchema, req.query);
  const rows = await applyFilters(applyScope(assetBase(), req.user), f).orderBy('assets.asset_code');
  const columns = EXPORT_COLUMNS.filter((c) => !c.financial || canViewFinancial(req.user));
  await logAudit(null, req.user, { action: 'EXPORT', entity: 'assets', summary: `Exported ${rows.length} assets to CSV` });
  res.type('text/csv; charset=utf-8').attachment('jimma-assets.csv')
    .send(toCsv(columns, rows.map((r) => ({ ...r, generates_revenue: r.generates_revenue ? 'Yes' : 'No' }))));
});

// ------------------------------------------------------------------ create / read / update

/**
 * A Sector Administrator registers for their own office, so three fields are not typed but set here: the legal owner
 * is the asset's Kebele, the responsible office is the sector, and the responsible officer is the Sector
 * Administrator. They can change later (ownership change, assignment); this is only what a registration starts with.
 */
async function registeredBy(user, asset) {
  const [sector, kebele] = await Promise.all([
    db('sectors').where({ id: asset.sector_id }).first('name'),
    asset.kebele_id ? db('kebeles').where({ id: asset.kebele_id }).first('name') : null,
  ]);
  return {
    ...(kebele && { owner_name: `${kebele.name} Kebele` }),
    ...(sector && { responsible_office: sector.name }),
    responsible_officer: user.full_name,
  };
}

router.post('/', registrationPhoto, async (req, res) => {
  try {
    await assertFileContent(req.file, 'photo', 'Use a JPG, PNG or WebP picture.'); // a real picture, not a renamed file
    await register(req, res);
  } catch (err) {
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => {}); // nothing was registered: drop the photo
    throw err;
  }
});

async function register(req, res) {
  if (!has(req.user, 'asset.create')) throw forbidden('Your role is read-only.');
  let body = req.body;
  if (req.is('multipart/form-data')) {
    try { body = JSON.parse(req.body.data || '{}'); } catch { throw badRequest('Invalid input.'); }
  }
  const { acquisition, submit, ...data } = parse(createSchema, body);
  if (submit && !req.file) throw fail('photo', NEEDS_PHOTO);
  const resolved = await resolveRefs(req.user, data, null);
  // the sector's own fields: all the required ones are needed to send it for verification straight away
  const details = cleanDetails(await sectorCode(resolved.sector_id), data.details, { requireAll: submit });
  resolved.details = Object.keys(details).length ? JSON.stringify(details) : null;
  if (req.user.role === ROLES.SECTOR_ADMIN) Object.assign(resolved, await registeredBy(req.user, resolved));
  if ((data.current_valuation == null) !== (data.valuation_date == null)) {
    throw fail(data.current_valuation == null ? 'current_valuation' : 'valuation_date', 'Enter both the valuation and its date, or neither.');
  }
  await assertNoDuplicates(data);
  // the acquisition record is the source of truth for date and cost when one is supplied
  if (acquisition) {
    resolved.acquisition_date = acquisition.acquisition_date ?? resolved.acquisition_date;
    resolved.acquisition_cost = acquisition.cost ?? resolved.acquisition_cost;
  }

  const id = await db.transaction(async (trx) => {
    const { current_valuation, valuation_date, ...fields } = resolved;
    const [newId] = await trx('assets').insert({
      ...fields, current_valuation, valuation_date, approval_state: submit ? 'SUBMITTED' : 'DRAFT',
      submitted_by: submit ? req.user.id : null, created_by: req.user.id,
    });
    await trx('assets').where({ id: newId }).update({ asset_code: assetCode(newId) });
    if (current_valuation != null) {
      await trx('asset_valuations').insert({
        asset_id: newId, valuation_date, value: current_valuation, method: 'Initial valuation at registration', recorded_by: req.user.id,
      });
    }
    if (acquisition) {
      await trx('asset_acquisitions').insert({ ...acquisition, asset_id: newId, recorded_by: req.user.id });
    }
    if (req.file) {
      await trx('asset_documents').insert({
        asset_id: newId, doc_type: 'PHOTO', title: 'Registration photo', original_name: req.file.originalname.slice(0, 255),
        stored_name: req.file.filename, mime_type: req.file.mimetype, size_bytes: req.file.size, uploaded_by: req.user.id,
      });
    }
    await logAudit(trx, req.user, {
      action: 'CREATE', entity: 'asset', entityId: newId, assetId: newId,
      summary: `Registered ${assetCode(newId)}: ${fields.name}${acquisition ? ` (acquired by ${acquisition.method.toLowerCase().replace('_', ' ')})` : ''}${req.file ? ', with a photo' : ''}`,
    });
    if (submit) {
      await logAudit(trx, req.user, {
        action: 'SUBMIT', entity: 'asset', entityId: newId, assetId: newId,
        summary: `${assetCode(newId)}: DRAFT → SUBMITTED`, changes: { approval_state: { from: 'DRAFT', to: 'SUBMITTED' } },
      });
    }
    return newId;
  });
  const row = await assetBase().where('assets.id', id).first();
  if (submit) {
    await notifyAsset(row, 'asset.review', {
      exceptUserId: req.user.id, type: 'APPROVAL_PENDING', title: `${row.asset_code} is waiting for review`, body: row.name,
      link: '/approvals', dedupeKey: `ASSET:${id}:SUBMITTED`,
    });
  }
  res.status(201).json(asset_(req.user)(row));
}

router.get('/:id', async (req, res) => {
  const visible = await getVisibleAsset(req);
  const asset = asset_(req.user)(await assetBase().where('assets.id', visible.id).first());
  const financial = canViewFinancial(req.user);
  const [
    utilizations, maintenance, inspections, transfers, documents, valuations, history, acquisition, assignments,
    ownershipHistory, disposals, followUps, revenues, reservations, requests, siteChecks,
  ] = await Promise.all([
    db('utilizations as u').leftJoin('sectors as s', 's.id', 'u.revenue_sector_id')
      .where('u.asset_id', asset.id).select('u.*', 's.name as revenue_sector_name').orderBy('u.start_date', 'desc').orderBy('u.id', 'desc'),
    db('maintenance_records').where({ asset_id: asset.id }).orderBy('maintenance_date', 'desc').orderBy('id', 'desc'),
    db('inspection_records').where({ asset_id: asset.id }).orderBy('inspection_date', 'desc').orderBy('id', 'desc'),
    db('asset_transfers as t')
      .leftJoin('kifle_ketemas as fk', 'fk.id', 't.from_kifle_ketema_id').leftJoin('kebeles as fb', 'fb.id', 't.from_kebele_id')
      .leftJoin('kifle_ketemas as tk', 'tk.id', 't.to_kifle_ketema_id').leftJoin('kebeles as tb', 'tb.id', 't.to_kebele_id')
      .leftJoin('departments as fd', 'fd.id', 't.from_department_id').leftJoin('departments as td', 'td.id', 't.to_department_id')
      .where('t.asset_id', asset.id)
      .select('t.*', 'fk.name as from_kifle_ketema_name', 'fb.name as from_kebele_name', 'tk.name as to_kifle_ketema_name', 'tb.name as to_kebele_name',
        'fd.name as from_department_name', 'td.name as to_department_name')
      .orderBy('t.transfer_date', 'desc').orderBy('t.id', 'desc'),
    db('asset_documents as d').leftJoin('users as u', 'u.id', 'd.uploaded_by').where('d.asset_id', asset.id)
      .modify((q) => { if (!financial) q.whereNotIn('d.doc_type', FINANCIAL_DOC_TYPES); })
      .select('d.id', 'd.doc_type', 'd.title', 'd.original_name', 'd.mime_type', 'd.size_bytes', 'd.uploaded_at', 'd.related_type', 'd.related_id', 'd.expires_on', 'u.full_name as uploaded_by_name')
      .orderBy('d.uploaded_at', 'desc'),
    financial ? db('asset_valuations').where({ asset_id: asset.id }).orderBy('valuation_date', 'desc').orderBy('id', 'desc') : [],
    db('audit_logs').where({ asset_id: asset.id }).orderBy('id', 'desc').limit(300),
    db('asset_acquisitions').where({ asset_id: asset.id }).first(),
    db('asset_assignments as a').leftJoin('sectors as s', 's.id', 'a.sector_id').leftJoin('departments as d', 'd.id', 'a.department_id')
      .where('a.asset_id', asset.id).select('a.*', 's.name as sector_name', 'd.name as department_name').orderBy('a.id', 'desc'),
    db('asset_ownership_history').where({ asset_id: asset.id }).orderBy('id', 'desc'),
    db('asset_disposals').where({ asset_id: asset.id }).orderBy('id', 'desc'),
    db('follow_up_actions').where({ asset_id: asset.id }).orderBy('id', 'desc'),
    financial ? db('asset_revenues').where({ asset_id: asset.id }).orderBy('received_date', 'desc').orderBy('id', 'desc') : [],
    db('asset_reservations').where({ asset_id: asset.id }).orderBy('start_at', 'desc').limit(50),
    db('approval_requests as r').leftJoin('users as u', 'u.id', 'r.requested_by').where('r.asset_id', asset.id)
      .select('r.*', 'u.full_name as requested_by_name').orderBy('r.id', 'desc'),
    db('asset_site_checks as c').leftJoin('users as u', 'u.id', 'c.user_id').where('c.asset_id', asset.id)
      .select('c.*', 'u.full_name as checked_by_name').orderBy('c.id', 'desc'),
  ]);

  const total_maintenance_cost = maintenance
    .filter((m) => m.status !== 'CANCELLED').reduce((sum, m) => sum + (m.cost || 0), 0);
  const workflow = Object.keys(TRANSITIONS).filter((a) => checkTransition(req.user, asset, a) === null);
  const locked = asset.status === 'DISPOSED';
  const editor = has(req.user, 'asset.edit') && !locked;

  res.json({
    asset: {
      ...asset,
      ...(financial ? { total_maintenance_cost, total_revenue: revenues.reduce((s, r) => s + r.amount, 0) } : {}),
    },
    acquisition: financial || !acquisition ? acquisition : { ...acquisition, cost: null },
    utilizations, maintenance: financial ? maintenance : maintenance.map((m) => ({ ...m, cost: null })), inspections, transfers, documents, valuations,
    history, assignments, ownership_history: ownershipHistory, disposals, follow_ups: followUps, revenues, reservations,
    requests: requests.map((r) => ({ ...r, payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload })),
    depreciation: financial ? depreciation(asset) : null,
    site_checks: siteChecks.map((c) => ({ ...c, far: Boolean(c.far), qr_scanned: Boolean(c.qr_scanned), location_saved: Boolean(c.location_saved) })),
    site_check_max_distance_m: config.siteCheckMaxDistanceM,
    site_check_max_accuracy_m: config.siteCheckMaxAccuracyM,
    permissions: {
      can_edit: editor,
      can_dispose: has(req.user, 'request.create') && !locked,
      can_request: has(req.user, 'request.create') && !locked,
      can_maintain: has(req.user, 'maintenance.record') && !locked,
      can_inspect: has(req.user, 'inspection.record') && !locked,
      can_check_follow_ups: checksFollowUps(req.user) && !locked,
      can_edit_financial: (has(req.user, 'financial.edit') || has(req.user, 'asset.edit')) && !locked,
      can_reserve: has(req.user, 'reservation.request') && !locked && asset.is_reservable,
      can_view_financial: financial,
      workflow,
      locked,
    },
  });
});

router.patch('/:id', guardAsset('asset.edit'), async (req, res) => {
  const patch = present(parse(assetSchema.partial(), req.body), req.body);
  const before = req.asset;
  const merged = { ...before, ...patch };
  if ('kebele_id' in patch && !('kifle_ketema_id' in patch)) merged.kifle_ketema_id = null; // re-derive from the new Kebele
  const resolved = await resolveRefs(req.user, merged, Object.keys(patch));
  if (!inScope(req.user, before)) throw forbidden();
  if ('serial_number' in patch || 'registration_number' in patch) await assertNoDuplicates(merged, before.id);

  // choosing a listed type clears a typed-in one
  const update = Object.fromEntries(ASSET_FIELDS.filter((k) => k in patch || k === 'kifle_ketema_id' || (k === 'asset_type_other' && 'asset_type_id' in patch)).map((k) => [k, resolved[k]]));
  const changes = diff(before, { ...before, ...update }, ASSET_FIELDS);
  // the sector's own fields: re-checked when they or the sector change (another sector keeps only what applies to it)
  if ('details' in patch || 'sector_id' in patch) {
    const was = parseDetails(before.details);
    // money fields this person cannot see (and so did not send back) are kept as they were
    const unseen = canViewFinancial(req.user) ? {} : Object.fromEntries(Object.entries(was).filter(([k]) => MONEY_DETAIL_KEYS.includes(k)));
    const now = cleanDetails(await sectorCode(resolved.sector_id), 'details' in patch ? { ...unseen, ...patch.details } : was);
    if (JSON.stringify(now) !== JSON.stringify(was)) {
      update.details = Object.keys(now).length ? JSON.stringify(now) : null;
      changes.details = { from: was, to: now };
    }
  }
  if (Object.keys(changes).length) {
    await db.transaction(async (trx) => {
      await trx('assets').where({ id: before.id }).update({ ...update, updated_at: db.fn.now() });
      await logAudit(trx, req.user, {
        action: 'UPDATE', entity: 'asset', entityId: before.id, assetId: before.id,
        summary: `Updated ${before.asset_code}: ${Object.keys(changes).join(', ')}`, changes,
      });
    });
  }
  res.json(asset_(req.user)(await assetBase().where('assets.id', before.id).first()));
});

// ------------------------------------------------------------------ approval workflow and status

router.post('/:id/workflow', async (req, res) => {
  const { action, comment, evidence } = parse(z.object({ action: z.string(), comment: optStr(500), evidence: z.unknown().optional() }), req.body);
  const asset = await getVisibleAsset(req);
  const t = TRANSITIONS[action];
  const problem = checkTransition(req.user, asset, action);
  if (problem) throw (problem.startsWith('Your role') ? forbidden(problem) : conflict(problem));
  if (t?.needsComment && !comment) throw fail('comment', 'Please give a reason.');
  if (action === 'submit' && !(await hasPhoto(asset.id))) throw fail('photo', NEEDS_PHOTO);
  if (action === 'submit') cleanDetails(await sectorCode(asset.sector_id), parseDetails(asset.details), { requireAll: true });

  // Verifying a registration means going to the asset: the Kebele Administrator brings back their location,
  // a photo taken there by themselves, the condition found and (when the asset has a label) a scan of its QR code.
  let check = null;
  if (action === 'review') {
    if (!evidence || typeof evidence !== 'object') throw fail('evidence', 'Verify on site: your location, a photo taken there and the condition you found are needed.');
    const e = parse(evidenceSchema, evidence);
    const photo = await db('asset_documents').where({ id: e.photo_document_id, asset_id: asset.id, doc_type: 'PHOTO', uploaded_by: req.user.id }).first();
    if (!photo) throw fail('photo_document_id', 'Take a photo of the asset on site and add it to the verification.');
    // the verifier must be at the asset: a rough reading cannot show it, and a far one shows they are not
    const accuracy = Math.round(e.accuracy_m);
    if (accuracy > config.siteCheckMaxAccuracyM) {
      throw fail('accuracy_m', `Your location is only precise to ± ${accuracy} m; it must be within ± ${config.siteCheckMaxAccuracyM} m. Step outside, wait for the GPS and measure again.`);
    }
    const place = placeCheck(asset, e, config.siteCheckMaxDistanceM);
    if (place.far) {
      throw fail('latitude', `You are ${place.distance_m} m from where this asset is recorded; you must be within ${config.siteCheckMaxDistanceM} m to verify it. Go to the asset and measure again. If the recorded location is wrong, send the registration back to be corrected.`);
    }
    check = {
      asset_id: asset.id, user_id: req.user.id, latitude: e.latitude, longitude: e.longitude, accuracy_m: accuracy,
      ...place,
      qr_scanned: isOwnLabel(e.qr_code, asset), found_condition: e.found_condition, photo_document_id: photo.id, note: e.note,
    };
  }

  const update = { approval_state: t.to, approval_state_at: db.fn.now(), updated_at: db.fn.now() };
  if (action === 'submit') update.submitted_by = req.user.id;
  if (action === 'review') update.reviewed_by = req.user.id;
  if (action === 'approve') update.approved_by = req.user.id;
  if (action === 'reject') Object.assign(update, { submitted_by: null, reviewed_by: null, approved_by: null });
  if (action === 'activate' && ['PLANNED', 'REGISTERED'].includes(asset.status)) update.status = 'ACTIVE';
  if (check?.location_saved) Object.assign(update, { latitude: check.latitude, longitude: check.longitude }); // it had none
  const where = !check ? '' : check.location_saved ? 'its location was recorded'
    : `${check.distance_m} m from the recorded location${check.far ? ' (further than allowed)' : ''}`;
  const onSite = check ? ` · verified on site: ${where}; QR label ${check.qr_scanned ? 'scanned' : 'not scanned'}; condition found ${check.found_condition.toLowerCase()}` : '';

  await db.transaction(async (trx) => {
    await trx('assets').where({ id: asset.id }).update(update);
    if (check) await trx('asset_site_checks').insert(check);
    await logAudit(trx, req.user, {
      action: action.toUpperCase(), entity: 'asset', entityId: asset.id, assetId: asset.id,
      summary: `${asset.asset_code}: ${asset.approval_state} → ${t.to}${comment ? ` (${comment})` : ''}${onSite}`,
      changes: {
        approval_state: { from: asset.approval_state, to: t.to }, ...(update.status ? { status: { from: asset.status, to: update.status } } : {}),
        ...(check ? { site_check: { distance_m: check.distance_m, far: check.far, qr_scanned: check.qr_scanned, found_condition: check.found_condition, location_saved: check.location_saved } } : {}),
      },
    });
  });

  if (['submit', 'review', 'approve'].includes(action)) {
    await notifyAsset(asset, action === 'submit' ? 'asset.review' : 'asset.approve', {
      exceptUserId: req.user.id, type: 'APPROVAL_PENDING', title: `${asset.asset_code} is waiting for ${action === 'submit' ? 'review' : action === 'review' ? 'approval' : 'activation'}`,
      body: check?.far ? `${asset.name} · verified ${check.distance_m} m from its recorded location` : asset.name, link: '/approvals', dedupeKey: `ASSET:${asset.id}:${t.to}`,
    });
  }
  if (action === 'reject' && asset.submitted_by) {
    await notifyUser(asset.submitted_by, {
      type: 'REQUEST_REJECTED', title: `${asset.asset_code} registration was rejected`, body: comment, assetId: asset.id,
      link: `/assets/${asset.id}`, dedupeKey: `ASSET:${asset.id}:REJECT:${Date.now()}`,
    });
  }
  res.json(asset_(req.user)(await assetBase().where('assets.id', asset.id).first()));
});

router.post('/:id/status', guardAsset('asset.edit'), async (req, res) => {
  const { status, reason } = parse(z.object({ status: oneOf(STATUSES, 'Status'), reason: reqStr(500, 'A reason') }), req.body);
  const asset = req.asset;
  if (status === asset.status) throw fail('status', 'The asset already has this status.');
  if (['RETIRED', 'DISPOSED'].includes(status)) {
    throw fail('status', 'Use the Retire / Dispose action: it records the reason, method and value and needs approval.');
  }
  if (asset.status === 'RETIRED') throw conflict('A retired asset can only be disposed of.');
  if (['ACTIVE', 'LEASED', 'RENTED'].includes(status) && asset.approval_state !== 'ACTIVE') {
    throw conflict('The asset must complete the approval workflow (state ACTIVE) before it can be put into operation.');
  }
  await db.transaction(async (trx) => {
    await trx('assets').where({ id: asset.id }).update({ status, updated_at: db.fn.now() });
    await logAudit(trx, req.user, {
      action: 'STATUS_CHANGE', entity: 'asset', entityId: asset.id, assetId: asset.id,
      summary: `${asset.asset_code}: status ${asset.status} → ${status} (${reason})`,
      changes: { status: { from: asset.status, to: status }, reason },
    });
  });
  if (status === 'LOST') {
    await notifyAsset(asset, 'asset.edit', {
      exceptUserId: req.user.id, type: 'ASSET_MISSING', title: `${asset.asset_code} was reported lost`, body: reason, dedupeKey: `LOST:${asset.id}:${Date.now()}`,
    });
  }
  res.json(asset_(req.user)(await assetBase().where('assets.id', asset.id).first()));
});

// ------------------------------------------------------------------ utilization (how the asset is used)

const utilizationSchema = z.object({
  use_type: oneOf(USE_TYPES, 'Use type'),
  user_party: optNameText(200, 'User or party'),
  purpose: optStr(2000),
  authorization_basis: optStr(255),
  start_date: dateStr,
  end_date: optDate,
  generates_revenue: bool.default(false),
  revenue_sector_id: optIdRef,
  notes: optStr(2000),
});

router.post('/:id/utilizations', guardAsset('asset.edit'), async (req, res) => {
  const d = parse(utilizationSchema, req.body);
  if (d.end_date && d.end_date < d.start_date) throw fail('end_date', 'The end date cannot be before the start date.');
  if (!d.generates_revenue && d.revenue_sector_id) throw fail('revenue_sector_id', 'Remove the classification, or mark this use as generating revenue.');
  if (d.revenue_sector_id && !(await db('sectors').where({ id: d.revenue_sector_id }).first())) throw fail('revenue_sector_id', 'Unknown sector.');
  const [id] = await db('utilizations').insert({ ...d, asset_id: req.asset.id, recorded_by: req.user.id });
  await logAudit(null, req.user, {
    action: 'UTILIZATION_ADD', entity: 'utilization', entityId: id, assetId: req.asset.id,
    summary: `${req.asset.asset_code}: use recorded - ${d.use_type}${d.generates_revenue ? ' (generates revenue)' : ''}`,
  });
  res.status(201).json(await db('utilizations').where({ id }).first());
});

router.post('/:id/utilizations/:uid/end', guardAsset('asset.edit'), async (req, res) => {
  const { end_date } = parse(z.object({ end_date: dateStr }), req.body);
  const u = await db('utilizations').where({ id: req.params.uid, asset_id: req.asset.id }).first();
  if (!u) throw notFound();
  if (u.end_date) throw conflict('This use has already ended.');
  if (end_date < u.start_date) throw fail('end_date', 'The end date cannot be before the start date.');
  await db('utilizations').where({ id: u.id }).update({ end_date });
  await logAudit(null, req.user, {
    action: 'UTILIZATION_END', entity: 'utilization', entityId: u.id, assetId: req.asset.id,
    summary: `${req.asset.asset_code}: use ended on ${end_date} (${u.use_type})`,
  });
  res.json(await db('utilizations').where({ id: u.id }).first());
});

// ------------------------------------------------------------------ maintenance, inspection

const maintenanceSchema = z.object({
  maintenance_date: dateStr,
  maintenance_type: reqStr(120, 'Maintenance type'),
  kind: oneOf(MAINTENANCE_KINDS, 'Kind').default('ROUTINE'),
  description: optStr(2000),
  cost: money,
  provider: optNameText(200, 'Provider'),
  status: oneOf(MAINTENANCE_STATUSES, 'Status').default('COMPLETED'),
  next_maintenance_date: optDate,
});

router.post('/:id/maintenance', guardAsset('maintenance.record'), async (req, res) => {
  const d = parse(maintenanceSchema, req.body);
  if (d.next_maintenance_date && d.next_maintenance_date < d.maintenance_date) throw fail('next_maintenance_date', 'The next date cannot be before this maintenance date.');
  if (d.status !== 'PLANNED' && !notAfterToday(d.maintenance_date)) throw fail('maintenance_date', 'Only planned maintenance can be dated in the future.');
  const [id] = await db('maintenance_records').insert({ ...d, asset_id: req.asset.id, recorded_by: req.user.id });
  await logAudit(null, req.user, {
    action: 'MAINTENANCE_ADD', entity: 'maintenance', entityId: id, assetId: req.asset.id,
    summary: `${req.asset.asset_code}: maintenance "${d.maintenance_type}" (${d.status})${d.cost != null ? `, ${d.cost} ETB` : ''}`,
  });
  res.status(201).json(await db('maintenance_records').where({ id }).first());
});

// Track a maintenance job through PLANNED > IN_PROGRESS > COMPLETED
router.patch('/:id/maintenance/:mid', guardAsset('maintenance.record'), async (req, res) => {
  const patch = present(parse(maintenanceSchema.pick({ status: true, cost: true, provider: true, description: true, next_maintenance_date: true }).partial(), req.body), req.body);
  const m = await db('maintenance_records').where({ id: req.params.mid, asset_id: req.asset.id }).first();
  if (!m) throw notFound();
  const changes = diff(m, { ...m, ...patch }, Object.keys(patch));
  if (!Object.keys(changes).length) return res.json(m);
  await db('maintenance_records').where({ id: m.id }).update(patch);
  await logAudit(null, req.user, {
    action: 'MAINTENANCE_UPDATE', entity: 'maintenance', entityId: m.id, assetId: req.asset.id,
    summary: `${req.asset.asset_code}: maintenance "${m.maintenance_type}" updated (${Object.keys(changes).join(', ')})`, changes,
  });
  res.json(await db('maintenance_records').where({ id: m.id }).first());
});

const inspectionSchema = z.object({
  inspection_date: pastDate,
  inspector: reqPersonName(160, 'Inspector'),
  condition_found: oneOf(CONDITIONS, 'Condition'),
  result: oneOf(INSPECTION_RESULTS, 'Result').default('PASSED'),
  notes: optStr(2000),
  next_inspection_date: optDate,
  latitude: lat,
  longitude: lng,
  method: oneOf(['MANUAL', 'SCAN'], 'Method').default('MANUAL'),
  follow_up: optStr(500), // what must be done after a failed inspection
  follow_up_due: optDate,
});

router.post('/:id/inspections', guardAsset('inspection.record'), async (req, res) => {
  const { follow_up, follow_up_due, ...d } = parse(inspectionSchema, req.body);
  if (d.next_inspection_date && d.next_inspection_date < d.inspection_date) throw fail('next_inspection_date', 'The next date cannot be before this inspection date.');
  if (follow_up_due && follow_up_due < d.inspection_date) throw fail('follow_up_due', 'The follow-up cannot be due before the inspection.');
  const asset = req.asset;
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('inspection_records').insert({ ...d, asset_id: asset.id, recorded_by: req.user.id });
    await logAudit(trx, req.user, {
      action: 'INSPECTION_ADD', entity: 'inspection', entityId: newId, assetId: asset.id,
      summary: `${asset.asset_code}: inspected, ${d.result.toLowerCase()}, condition found ${d.condition_found}`,
    });
    if (d.condition_found !== asset.condition) {
      await trx('assets').where({ id: asset.id }).update({ condition: d.condition_found, updated_at: db.fn.now() });
      await logAudit(trx, req.user, {
        action: 'CONDITION_CHANGE', entity: 'asset', entityId: asset.id, assetId: asset.id,
        summary: `${asset.asset_code}: condition ${asset.condition} → ${d.condition_found} (inspection)`,
        changes: { condition: { from: asset.condition, to: d.condition_found } },
      });
    }
    if (d.result === 'FAILED') {
      const [fid] = await trx('follow_up_actions').insert({
        asset_id: asset.id, source_type: 'INSPECTION', source_id: newId, created_by: req.user.id,
        description: follow_up || d.notes || 'Failed inspection: investigate and correct', due_date: follow_up_due,
      });
      await logAudit(trx, req.user, {
        action: 'FOLLOW_UP_ADD', entity: 'follow_up', entityId: fid, assetId: asset.id, summary: `${asset.asset_code}: follow-up created after failed inspection`,
      });
    }
    return newId;
  });
  if (d.condition_found === 'CRITICAL' && asset.condition !== 'CRITICAL') {
    await notifyAsset(asset, 'asset.edit', {
      exceptUserId: req.user.id, type: 'CRITICAL_CONDITION', title: `${asset.asset_code} is in critical condition`, body: asset.name, dedupeKey: `CRITICAL:${asset.id}:${id}`,
    });
  }
  res.status(201).json(await db('inspection_records').where({ id }).first());
});

// ------------------------------------------------------------------ follow-up actions

/**
 * Who checks that a follow-up was really done: the Inspector, or a verification manager (the Kebele and Kifle Ketema
 * Administrators). The asset's keeper (the Sector Administrator) does the work and reports it done; only a note it
 * added itself it may close on its own word.
 */
const checksFollowUps = (user) => has(user, 'inspection.record') || has(user, 'verification.manage');
const FOLLOW_UP_ACCESS = ['asset.edit', 'inspection.record', 'verification.manage'];

async function openFollowUp(req) {
  const f = await db('follow_up_actions').where({ id: req.params.fid, asset_id: req.asset.id }).first();
  if (!f) throw notFound();
  if (!['OPEN', 'REPORTED'].includes(f.status)) throw conflict('This follow-up is already closed.');
  return f;
}

router.post('/:id/follow-ups', guardAsset(FOLLOW_UP_ACCESS), async (req, res) => {
  const d = parse(z.object({ description: reqStr(500, 'Description'), due_date: optDate, assigned_to: optNameText(160, 'Assigned to') }), req.body);
  const [id] = await db('follow_up_actions').insert({ ...d, asset_id: req.asset.id, source_type: 'MANUAL', created_by: req.user.id });
  await logAudit(null, req.user, { action: 'FOLLOW_UP_ADD', entity: 'follow_up', entityId: id, assetId: req.asset.id, summary: `${req.asset.asset_code}: follow-up - ${d.description}` });
  res.status(201).json(await db('follow_up_actions').where({ id }).first());
});

router.post('/:id/follow-ups/:fid/close', guardAsset(FOLLOW_UP_ACCESS), async (req, res) => {
  const { resolution } = parse(z.object({ resolution: optStr(500) }), req.body);
  const f = await openFollowUp(req);
  const asset = req.asset;
  const ownNote = f.source_type === 'MANUAL' && f.created_by === req.user.id;
  if (!checksFollowUps(req.user) && !ownNote) {
    // the keeper reports the work done; the Inspector or the Kebele Administrator checks it
    if (f.status === 'REPORTED') throw conflict('This follow-up was already reported done and waits for a check.');
    if (!resolution) throw fail('resolution', 'Say what was done.');
    await db('follow_up_actions').where({ id: f.id }).update({ status: 'REPORTED', resolution, reported_by: req.user.id, reported_at: db.fn.now() });
    await logAudit(null, req.user, { action: 'FOLLOW_UP_REPORT', entity: 'follow_up', entityId: f.id, assetId: asset.id, summary: `${asset.asset_code}: follow-up reported done - ${resolution}` });
    const message = {
      exceptUserId: req.user.id, type: 'FOLLOW_UP_REPORTED', title: `${asset.asset_code}: follow-up reported done, to check`,
      body: `${f.description} - ${resolution}`, dedupeKey: `FU:${f.id}:reported:${Date.now()}`,
    };
    for (const permission of ['inspection.record', 'verification.manage']) await notifyAsset(asset, permission, message);
    return res.json(await db('follow_up_actions').where({ id: f.id }).first());
  }
  const text = resolution || f.resolution;
  if (!text) throw fail('resolution', 'Say what was done.');
  await db('follow_up_actions').where({ id: f.id }).update({ status: 'DONE', resolution: text, closed_by: req.user.id, closed_at: db.fn.now() });
  await logAudit(null, req.user, {
    action: 'FOLLOW_UP_CLOSE', entity: 'follow_up', entityId: f.id, assetId: asset.id,
    summary: `${asset.asset_code}: follow-up ${f.status === 'REPORTED' ? 'checked and closed' : 'done'} - ${text}`,
  });
  res.json(await db('follow_up_actions').where({ id: f.id }).first());
});

router.post('/:id/follow-ups/:fid/reopen', guardAsset(FOLLOW_UP_ACCESS), async (req, res) => {
  if (!checksFollowUps(req.user)) throw forbidden('The Inspector or the Kebele Administrator checks follow-ups.');
  const { note } = parse(z.object({ note: reqStr(500, 'What is still missing') }), req.body);
  const f = await openFollowUp(req);
  if (f.status !== 'REPORTED') throw conflict('Only a follow-up reported done can be sent back.');
  const asset = req.asset;
  await db('follow_up_actions').where({ id: f.id }).update({ status: 'OPEN', resolution: null, reported_by: null, reported_at: null });
  await logAudit(null, req.user, { action: 'FOLLOW_UP_REOPEN', entity: 'follow_up', entityId: f.id, assetId: asset.id, summary: `${asset.asset_code}: follow-up sent back - ${note}` });
  await notifyUser(f.reported_by, {
    type: 'FOLLOW_UP_REOPENED', title: `${asset.asset_code}: follow-up sent back`, body: `${f.description} - ${note}`,
    assetId: asset.id, link: `/assets/${asset.id}`, dedupeKey: `FU:${f.id}:reopened:${Date.now()}`,
  });
  res.json(await db('follow_up_actions').where({ id: f.id }).first());
});

// ------------------------------------------------------------------ transfer (may need approval)

const transferSchema = z.object({
  to_kifle_ketema_id: optIdRef,
  to_kebele_id: optIdRef,
  to_location_detail: optStr(255),
  to_sector_id: optIdRef,
  to_department_id: optIdRef,
  transfer_date: dateStr,
  reason: reqStr(500, 'A reason'),
  authorized_by: reqNameText(200, 'The authorising person or office'),
  new_holder: optNameText(200, 'New holder'),
});

/**
 * Where a transfer may send the asset: inside the asker's own area. A Kebele Administrator also sends assets on to
 * the other Kebeles of its own Kifle Ketema (the Kifle Ketema Administrator approves): it answers for the whole Kebele.
 */
async function transferReach(user) {
  if (user.role !== ROLES.KEBELE_ADMIN) return user;
  const kifle = await db('kebeles').whereIn('id', user.scope.kebeles).whereNotNull('kifle_ketema_id').distinct().pluck('kifle_ketema_id');
  return { ...user, role: ROLES.KIFLE_ADMIN, scope: { ...user.scope, kifle } };
}

router.post('/:id/transfers', guardAsset('request.create'), async (req, res) => {
  const d = parse(transferSchema, req.body);
  const asset = req.asset;
  if (req.user.role === ROLES.KEBELE_ADMIN && !d.to_kebele_id) throw fail('to_kebele_id', 'Choose a Kebele.');
  const dest = await resolveRefs(await transferReach(req.user), {
    ...asset, kifle_ketema_id: d.to_kifle_ketema_id, kebele_id: d.to_kebele_id,
    sector_id: d.to_sector_id ?? asset.sector_id,
    department_id: d.to_department_id ?? (d.to_sector_id && d.to_sector_id !== asset.sector_id ? null : asset.department_id),
  }, ['kifle_ketema_id', 'kebele_id']).catch((e) => {
    if (e instanceof HttpError && e.details) {
      // report location errors against the transfer form's field names
      const details = {};
      if (e.details.kebele_id) details.to_kebele_id = e.details.kebele_id;
      if (e.details.kifle_ketema_id) details.to_kifle_ketema_id = e.details.kifle_ketema_id;
      if (e.details.department_id) details.to_department_id = e.details.department_id;
      if (e.details.sector_id) details.to_sector_id = e.details.sector_id;
      throw new HttpError(e.status, e.message, Object.keys(details).length ? details : e.details);
    }
    throw e;
  });
  const sameLocation = dest.kifle_ketema_id === asset.kifle_ketema_id && (asset.kebele_id ?? null) === (dest.kebele_id ?? null)
    && (asset.location_detail || '') === (d.to_location_detail || '')
    && dest.sector_id === asset.sector_id && (dest.department_id ?? null) === (asset.department_id ?? null);
  if (sameLocation) throw fail('to_kebele_id', 'The destination is the same as the current location.');

  const payload = { ...d, to_kifle_ketema_id: dest.kifle_ketema_id, to_kebele_id: dest.kebele_id, to_sector_id: dest.sector_id, to_department_id: dest.department_id };
  const names = await Promise.all([
    dest.kebele_id ? db('kebeles').where({ id: dest.kebele_id }).first() : null,
    db('kifle_ketemas').where({ id: dest.kifle_ketema_id }).first(),
  ]);
  const summary = `Move to ${names[0] ? `${names[0].name}, ` : ''}${names[1].name}${d.to_location_detail ? ` (${d.to_location_detail})` : ''} - ${d.reason}`;
  const out = await submitOrExecute(req.user, asset, 'TRANSFER', payload, summary);
  if (out.executed) return res.status(201).json(asset_(req.user)(await assetBase().where('assets.id', asset.id).first()));
  res.status(202).json({ pending: true, request: out.request });
});

// ------------------------------------------------------------------ valuation (financial information)

router.post('/:id/valuations', guardAsset(['financial.edit', 'asset.edit']), async (req, res) => {
  res.status(201).json(await recordValuation(req.user, req.asset, parse(valuationSchema, req.body)));
});

// ------------------------------------------------------------------ documents and photos

const ALLOWED_TYPES = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = ALLOWED_TYPES[ext]?.includes(file.mimetype);
    cb(ok ? null : badRequest('Allowed files: PDF, JPG, PNG, Word, Excel.'), Boolean(ok));
  },
});

const documentSchema = z.object({
  doc_type: oneOf(DOC_TYPES, 'Document type'),
  title: reqStr(200, 'Title'),
  related_type: z.preprocess((v) => v || null, oneOf(DOC_RELATED, 'Related record').nullable()).default(null),
  related_id: optIdRef,
  expires_on: optDate,
});

const DOC_UPLOADERS = ['asset.edit', 'maintenance.record', 'inspection.record', 'verification.record', 'financial.edit'];

router.post('/:id/documents', guardAsset(DOC_UPLOADERS), upload.single('file'), async (req, res) => {
  const discard = () => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  try {
    if (!req.file) throw fail('file', 'Choose a file to upload.');
    await assertFileContent(req.file); // what the file really is, not what its name says
    const d = parse(documentSchema, req.body);
    if (d.related_id && !d.related_type) throw fail('related_type', 'Choose what this document belongs to.');
    const [id] = await db('asset_documents').insert({
      ...d, asset_id: req.asset.id, original_name: req.file.originalname.slice(0, 255), stored_name: req.file.filename,
      mime_type: req.file.mimetype, size_bytes: req.file.size, uploaded_by: req.user.id,
    });
    await logAudit(null, req.user, {
      action: 'DOCUMENT_ADD', entity: 'document', entityId: id, assetId: req.asset.id,
      summary: `${req.asset.asset_code}: ${d.doc_type.toLowerCase()} uploaded - ${d.title}`,
    });
    res.status(201).json({ id, ...d, original_name: req.file.originalname, size_bytes: req.file.size });
  } catch (err) {
    await discard();
    throw err;
  }
});

/** The newest photo of the asset, shown on its page. */
router.get('/:id/photo', async (req, res) => {
  const asset = await getVisibleAsset(req);
  const doc = await db('asset_documents').where({ asset_id: asset.id, doc_type: 'PHOTO' }).orderBy('uploaded_at', 'desc').orderBy('id', 'desc').first();
  const file = doc && path.join(config.uploadDir, path.basename(doc.stored_name));
  if (!file || !fs.existsSync(file)) throw notFound('This asset has no photo.');
  res.set('Cache-Control', 'private, max-age=300');
  res.type(doc.mime_type);
  fs.createReadStream(file).pipe(res);
});

// Files are only reachable through this authenticated, scope-checked route.
router.get('/:id/documents/:did/download', async (req, res) => {
  const asset = await getVisibleAsset(req);
  const doc = await db('asset_documents').where({ id: req.params.did, asset_id: asset.id }).first();
  if (!doc) throw notFound();
  if (FINANCIAL_DOC_TYPES.includes(doc.doc_type) && !canViewFinancial(req.user)) throw notFound();
  const file = path.join(config.uploadDir, path.basename(doc.stored_name));
  if (!fs.existsSync(file)) throw notFound('The file is missing from storage.');
  await logAudit(null, req.user, { action: 'DOCUMENT_DOWNLOAD', entity: 'document', entityId: doc.id, assetId: asset.id, summary: `${asset.asset_code}: downloaded "${doc.title}"` });
  res.type(doc.mime_type).attachment(doc.original_name);
  fs.createReadStream(file).pipe(res);
});

// Correct a document's title, type or expiry date (the file itself is replaced by uploading a new one).
router.patch('/:id/documents/:did', guardAsset('asset.edit'), async (req, res) => {
  const doc = await db('asset_documents').where({ id: req.params.did, asset_id: req.asset.id }).first();
  if (!doc) throw notFound();
  const patch = present(parse(documentSchema.pick({ doc_type: true, title: true, expires_on: true }).partial(), req.body), req.body);
  const changes = diff(doc, { ...doc, ...patch }, Object.keys(patch));
  if (Object.keys(changes).length) {
    await db('asset_documents').where({ id: doc.id }).update(patch);
    await logAudit(null, req.user, {
      action: 'DOCUMENT_UPDATE', entity: 'document', entityId: doc.id, assetId: req.asset.id,
      summary: `${req.asset.asset_code}: document "${doc.title}" corrected (${Object.keys(changes).join(', ')})`, changes,
    });
  }
  res.json(await db('asset_documents').where({ id: doc.id }).first());
});

router.delete('/:id/documents/:did', guardAsset('asset.edit'), async (req, res) => {
  const doc = await db('asset_documents').where({ id: req.params.did, asset_id: req.asset.id }).first();
  if (!doc) throw notFound();
  await db('asset_documents').where({ id: doc.id }).delete();
  await fs.promises.unlink(path.join(config.uploadDir, path.basename(doc.stored_name))).catch(() => {});
  await logAudit(null, req.user, {
    action: 'DOCUMENT_REMOVE', entity: 'document', entityId: doc.id, assetId: req.asset.id,
    summary: `${req.asset.asset_code}: removed document - ${doc.title}`,
  });
  res.json({ ok: true });
});

export default router;
