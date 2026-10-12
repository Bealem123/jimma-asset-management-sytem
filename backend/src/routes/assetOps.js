import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, require_ } from '../middleware/auth.js';
import { HttpError, conflict, parse } from '../middleware/errors.js';
import { applyScope, maskFinancial, permissionCheck } from '../lib/permissions.js';
import { logAudit } from '../lib/audit.js';
import { assetBase, applyFilters, normalizeAsset } from '../lib/assetQuery.js';
import { acquisitionSchema, assertNoDuplicates, assetSchema } from '../lib/assetSchemas.js';
import {
  assetCode, fail, findVisibleByCodeOrId, getVisibleAsset, guardAsset, resolveRefs,
} from '../lib/assetGuards.js';
import { assetByToken, ensureToken } from '../lib/publicAsset.js';
import { submitOrExecute } from '../lib/requests.js';
import {
  DISPOSAL_METHODS, OWNERSHIP_TYPES, REVENUE_TYPES,
} from '../lib/constants.js';
import {
  dateStr, lat, lng, money, oneOf, optDate, optIdRef, optStr, reqMoney, reqStr,
} from '../lib/schemas.js';
import { listSchema } from './assets.js';

const router = Router();
router.use(authenticate);

const asset_ = (user) => (row) => maskFinancial(user, normalizeAsset(row));
const reply = async (req, res, out, assetId) => {
  if (out.executed) return res.status(201).json(asset_(req.user)(await assetBase().where('assets.id', assetId).first()));
  return res.status(202).json({ pending: true, request: out.request });
};

// ------------------------------------------------------------------ map (GIS)

router.get('/map', async (req, res) => {
  const f = parse(listSchema, { ...req.query, page: 1, page_size: 100 });
  const rows = await applyFilters(applyScope(assetBase(), req.user), f)
    .whereNotNull('assets.latitude').whereNotNull('assets.longitude').whereNot('assets.status', 'DISPOSED')
    .limit(5000);
  res.json(rows.map((r) => ({
    id: r.id, asset_code: r.asset_code, name: r.name, latitude: r.latitude, longitude: r.longitude,
    category_name: r.category_name, sector_name: r.sector_name, kifle_ketema_name: r.kifle_ketema_name, kebele_name: r.kebele_name,
    condition: r.condition, status: r.status,
  })));
});

// ------------------------------------------------------------------ QR code / barcode / scanning

// A printed QR code opens the asset's public card (/a/<token>) on any phone camera; the in-app scanner reads it too.
// The address is PUBLIC_URL (the address phones can reach) or, without it, the address this page was opened on.
// The barcode on the label keeps the plain Asset ID, for barcode readers and the in-app scanner.
async function qrPayload(req, asset) {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;
  return `${base.replace(/\/$/, '')}/a/${await ensureToken(asset)}`;
}

router.get('/:id/qr.svg', async (req, res) => {
  const asset = await getVisibleAsset(req);
  const svg = await QRCode.toString(await qrPayload(req, asset), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

router.get('/:id/qr.png', async (req, res) => {
  const asset = await getVisibleAsset(req);
  const png = await QRCode.toBuffer(await qrPayload(req, asset), { margin: 1, width: 400, errorCorrectionLevel: 'M' });
  res.type('image/png').send(png);
});

const scanSchema = z.object({
  code: reqStr(300, 'Code'),
  context: oneOf(['LOOKUP', 'INSPECTION', 'VERIFICATION'], 'Context').default('LOOKUP'),
  latitude: lat,
  longitude: lng,
});

/** Resolve a scanned QR/barcode (an asset code, a public card address, or a URL ending in a code) and record the scan. */
router.post('/scan', async (req, res) => {
  const d = parse(scanSchema, req.body);
  const card = /\/a\/([A-Za-z0-9_-]{16,32})\/?$/.exec(d.code.trim());
  const byToken = card ? await assetByToken(card[1]) : null;
  const match = byToken ? [byToken.asset_code] : /AST-\d{6}/i.exec(d.code);
  if (!match) throw fail('code', 'This is not a Jimma asset code.');
  const asset = await findVisibleByCodeOrId(req.user, match[0]);
  await db('scan_events').insert({ asset_id: asset.id, user_id: req.user.id, context: d.context, latitude: d.latitude, longitude: d.longitude });
  res.json(asset_(req.user)(await assetBase().where('assets.id', asset.id).first()));
});

router.get('/:id/scans', async (req, res) => {
  const asset = await getVisibleAsset(req);
  res.json(await db('scan_events as s').leftJoin('users as u', 'u.id', 's.user_id').where('s.asset_id', asset.id)
    .select('s.*', 'u.full_name as user_name').orderBy('s.id', 'desc').limit(100));
});

// ------------------------------------------------------------------ acquisition / procurement

router.put('/:id/acquisition', guardAsset('asset.edit'), async (req, res) => {
  const d = parse(acquisitionSchema, req.body);
  const asset = req.asset;
  const existing = await db('asset_acquisitions').where({ asset_id: asset.id }).first();
  await db.transaction(async (trx) => {
    if (existing) await trx('asset_acquisitions').where({ id: existing.id }).update({ ...d, updated_at: db.fn.now() });
    else await trx('asset_acquisitions').insert({ ...d, asset_id: asset.id, recorded_by: req.user.id });
    await trx('assets').where({ id: asset.id }).update({
      acquisition_date: d.acquisition_date ?? asset.acquisition_date, acquisition_cost: d.cost ?? asset.acquisition_cost, updated_at: db.fn.now(),
    });
    await logAudit(trx, req.user, {
      action: existing ? 'ACQUISITION_UPDATE' : 'ACQUISITION_ADD', entity: 'acquisition', assetId: asset.id,
      summary: `${asset.asset_code}: acquisition ${existing ? 'updated' : 'recorded'} (${d.method.toLowerCase().replace('_', ' ')}${d.supplier_name ? `, ${d.supplier_name}` : ''})`,
      changes: existing ? Object.fromEntries(Object.keys(d).filter((k) => String(existing[k] ?? '') !== String(d[k] ?? '')).map((k) => [k, { from: existing[k] ?? null, to: d[k] }])) : null,
    });
  });
  res.json(await db('asset_acquisitions').where({ asset_id: asset.id }).first());
});

// ------------------------------------------------------------------ assignment / allocation

const assignmentSchema = z.object({
  sector_id: optIdRef,
  department_id: optIdRef,
  office: optStr(200),
  responsible_officer: optStr(160),
  holder: optStr(200),
  holder_user_id: optIdRef,
  assigned_date: dateStr,
  reason: reqStr(500, 'A reason'),
});

router.post('/:id/assignments', guardAsset('request.create'), async (req, res) => {
  const d = parse(assignmentSchema, req.body);
  const asset = req.asset;
  if (!d.sector_id && !d.department_id && !d.office && !d.responsible_officer && !d.holder) {
    throw fail('holder', 'Choose who or what the asset is assigned to.');
  }
  if (d.holder_user_id) {
    const u = await db('users').where({ id: d.holder_user_id, is_active: true }).first();
    if (!u) throw fail('holder_user_id', 'Unknown or inactive user.');
    d.holder ||= u.full_name;
  }
  // check relationships and that the new responsibility stays inside the requester's area
  await resolveRefs(req.user, {
    ...asset, sector_id: d.sector_id ?? asset.sector_id,
    department_id: d.department_id ?? (d.sector_id && d.sector_id !== asset.sector_id ? null : asset.department_id),
  }, ['sector_id', 'department_id']);
  const who = [d.holder, d.office, d.responsible_officer].filter(Boolean).join(' / ') || 'new sector / department';
  const out = await submitOrExecute(req.user, asset, 'ASSIGNMENT', d, `Assign to ${who} - ${d.reason}`);
  return reply(req, res, out, asset.id);
});

/** Who has what now: current assignments, filterable by department, sector or person. */
router.get('/assignments/current', async (req, res) => {
  const f = parse(z.object({ department_id: optIdRef, sector_id: optIdRef, holder: z.string().trim().max(100).optional() }), req.query);
  const q = applyScope(
    db('asset_assignments as a').join('assets', 'assets.id', 'a.asset_id')
      .leftJoin('sectors as s', 's.id', 'a.sector_id').leftJoin('departments as d', 'd.id', 'a.department_id'),
    req.user,
  ).where('a.status', 'ACTIVE').whereNot('assets.status', 'DISPOSED')
    .select('a.*', 'assets.asset_code', 'assets.name as asset_name', 's.name as sector_name', 'd.name as department_name')
    .orderBy('assets.asset_code');
  if (f.department_id) q.where('a.department_id', f.department_id);
  if (f.sector_id) q.where('a.sector_id', f.sector_id);
  if (f.holder) q.where((b) => b.where('a.holder', 'like', `%${f.holder}%`).orWhere('a.responsible_officer', 'like', `%${f.holder}%`).orWhere('a.office', 'like', `%${f.holder}%`));
  res.json(await q.limit(500));
});

// ------------------------------------------------------------------ ownership change

router.post('/:id/ownership-change', guardAsset('request.create'), async (req, res) => {
  const d = parse(z.object({
    new_owner: reqStr(200, 'New owner'),
    new_type: oneOf(OWNERSHIP_TYPES, 'Ownership type'),
    effective_date: dateStr,
    basis: reqStr(500, 'The legal basis or decision'),
  }), req.body);
  if (d.new_owner === req.asset.owner_name && d.new_type === req.asset.ownership_type) throw fail('new_owner', 'Nothing changes: this is already the owner.');
  const out = await submitOrExecute(req.user, req.asset, 'OWNERSHIP_CHANGE', d, `Owner ${req.asset.owner_name} → ${d.new_owner} - ${d.basis}`);
  return reply(req, res, out, req.asset.id);
});

// ------------------------------------------------------------------ retirement and disposal

const disposalSchema = z.object({
  kind: oneOf(['RETIREMENT', 'DISPOSAL'], 'Kind'),
  reason: reqStr(500, 'A reason'),
  method: z.preprocess((v) => v || null, oneOf(DISPOSAL_METHODS, 'Method').nullable()).default(null),
  disposal_date: dateStr,
  disposal_value: money,
  recipient: optStr(200),
  notes: optStr(2000),
});

router.post('/:id/disposal', guardAsset('request.create'), async (req, res) => {
  const d = parse(disposalSchema, req.body);
  const asset = req.asset;
  if (d.kind === 'DISPOSAL' && !d.method) throw fail('method', 'Choose how the asset is disposed of.');
  if (d.kind === 'RETIREMENT' && asset.status === 'RETIRED') throw conflict('This asset is already retired.');
  const { kind, ...payload } = d;
  const out = await submitOrExecute(req.user, asset, kind, payload, `${kind === 'DISPOSAL' ? 'Dispose' : 'Retire'} - ${d.reason}`);
  return reply(req, res, out, asset.id);
});

// ------------------------------------------------------------------ revenue linked to the asset

router.post('/:id/revenues', guardAsset('financial.edit'), async (req, res) => {
  const d = parse(z.object({
    revenue_type: oneOf(REVENUE_TYPES, 'Revenue type'),
    amount: reqMoney,
    received_date: dateStr,
    period_start: optDate,
    period_end: optDate,
    payer: optStr(200),
    reference: optStr(120),
    utilization_id: optIdRef,
    notes: optStr(2000),
  }), req.body);
  if (d.period_start && d.period_end && d.period_end < d.period_start) throw fail('period_end', 'The period end cannot be before its start.');
  if (d.utilization_id && !(await db('utilizations').where({ id: d.utilization_id, asset_id: req.asset.id }).first())) {
    throw fail('utilization_id', 'This use does not belong to the asset.');
  }
  const [id] = await db('asset_revenues').insert({ ...d, asset_id: req.asset.id, recorded_by: req.user.id });
  await logAudit(null, req.user, {
    action: 'REVENUE_ADD', entity: 'revenue', entityId: id, assetId: req.asset.id,
    summary: `${req.asset.asset_code}: ${d.revenue_type.toLowerCase()} income ${d.amount} ETB received ${d.received_date}`,
  });
  res.status(201).json(await db('asset_revenues').where({ id }).first());
});

// ------------------------------------------------------------------ archive (disposed assets leave the working lists)

router.post('/:id/archive', guardAsset('asset.approve', { allowDisposed: true }), async (req, res) => {
  const asset = req.asset;
  if (asset.status !== 'DISPOSED') throw conflict('Only disposed assets can be archived.');
  if (asset.archived_at) throw conflict('This asset is already archived.');
  await db('assets').where({ id: asset.id }).update({ archived_at: db.fn.now() });
  await logAudit(null, req.user, { action: 'ARCHIVE', entity: 'asset', entityId: asset.id, assetId: asset.id, summary: `${asset.asset_code}: archived` });
  res.json(asset_(req.user)(await assetBase().where('assets.id', asset.id).first()));
});

router.post('/:id/unarchive', guardAsset('asset.approve', { allowDisposed: true }), async (req, res) => {
  const asset = req.asset;
  if (!asset.archived_at) throw conflict('This asset is not archived.');
  await db('assets').where({ id: asset.id }).update({ archived_at: null });
  await logAudit(null, req.user, { action: 'UNARCHIVE', entity: 'asset', entityId: asset.id, assetId: asset.id, summary: `${asset.asset_code}: restored from archive` });
  res.json(asset_(req.user)(await assetBase().where('assets.id', asset.id).first()));
});

// ------------------------------------------------------------------ follow-ups across the register

router.get('/follow-ups/open', async (req, res) => {
  res.json(await applyScope(db('follow_up_actions as f').join('assets', 'assets.id', 'f.asset_id'), req.user)
    .where('f.status', 'OPEN').select('f.*', 'assets.asset_code', 'assets.name as asset_name')
    .orderByRaw('f.due_date IS NULL, f.due_date').limit(500));
});

// ------------------------------------------------------------------ duplicates

router.get('/duplicates/scan', require_(permissionCheck('asset.export')), async (req, res) => {
  const rows = await applyScope(assetBase(), req.user).whereNot('assets.status', 'DISPOSED')
    .where((b) => b.whereNotNull('assets.serial_number').orWhereNotNull('assets.registration_number'));
  const groups = new Map();
  for (const r of rows) {
    for (const [kind, value] of [['serial_number', r.serial_number], ['registration_number', r.registration_number]]) {
      if (!value) continue;
      const key = `${kind}:${value.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { field: kind, value, assets: [] });
      groups.get(key).assets.push({ id: r.id, asset_code: r.asset_code, name: r.name, kebele_name: r.kebele_name, kifle_ketema_name: r.kifle_ketema_name });
    }
  }
  res.json([...groups.values()].filter((g) => g.assets.length > 1));
});

// ------------------------------------------------------------------ bulk import

const IMPORT_COLUMNS = [
  'name', 'category', 'asset_type', 'sector', 'department', 'kifle_ketema', 'kebele', 'location_detail', 'latitude', 'longitude',
  'serial_number', 'registration_number', 'owner_name', 'condition', 'acquisition_date', 'acquisition_cost', 'description',
  'function_use', 'responsible_officer', 'responsible_office', 'current_holder',
];

router.get('/import/template.csv', require_(permissionCheck('import.run')), (req, res) => {
  const example = ['Toyota Hilux pickup', 'Vehicles', 'Pickup', 'TRN', '', 'Jiren', 'Jiren', 'Main garage', '7.6735', '36.8344',
    'SN-12345', 'REG-0001', 'Jimma City Administration', 'GOOD', '2024-03-15', '1850000', '', 'Field work', '', '', ''];
  res.type('text/csv; charset=utf-8').attachment('asset-import-template.csv').send(`${IMPORT_COLUMNS.join(',')}\n${example.join(',')}\n`);
});

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

async function loadLookups() {
  const [categories, types, sectors, departments, kifle, kebeles] = await Promise.all([
    db('asset_categories'), db('asset_types'), db('sectors'), db('departments'), db('kifle_ketemas'), db('kebeles'),
  ]);
  const by = (rows, ...keys) => new Map(rows.flatMap((r) => keys.map((k) => [String(r[k]).toLowerCase(), r])));
  return {
    categories: by(categories, 'name'), types, sectors: by(sectors, 'name', 'code'), departments, kifle: by(kifle, 'name'), kebeles: by(kebeles, 'name'),
  };
}

router.post('/import', require_(permissionCheck('import.run')), csvUpload.single('file'), async (req, res) => {
  if (!req.file) throw fail('file', 'Choose a CSV file.');
  const dryRun = req.query.dry_run === 'true' || req.body?.dry_run === 'true';
  let records;
  try {
    records = parseCsv(req.file.buffer, { columns: (h) => h.map((x) => x.trim().toLowerCase()), bom: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    throw new HttpError(400, `The file could not be read as CSV: ${e.message}`);
  }
  if (!records.length) throw new HttpError(400, 'The file has no rows.');
  if (records.length > 2000) throw new HttpError(400, 'Import at most 2000 assets at a time.');
  const missing = ['name', 'category', 'sector'].filter((c) => !(c in records[0]));
  if (missing.length) throw new HttpError(400, `Missing column(s): ${missing.join(', ')}. Download the template for the expected layout.`);

  const L = await loadLookups();
  const errors = [];
  const ready = [];
  const seen = new Map();
  for (const [i, r] of records.entries()) {
    const row = i + 2; // spreadsheet row number (header is row 1)
    const problems = [];
    const category = L.categories.get((r.category || '').toLowerCase());
    if (!category) problems.push(`Unknown category "${r.category}"`);
    const type = r.asset_type && category ? L.types.find((t) => t.category_id === category.id && t.name.toLowerCase() === r.asset_type.toLowerCase()) : null;
    if (r.asset_type && category && !type) problems.push(`Unknown type "${r.asset_type}" for ${category.name}`);
    const sector = L.sectors.get((r.sector || '').toLowerCase());
    if (!sector) problems.push(`Unknown sector "${r.sector}"`);
    const dep = r.department && sector ? L.departments.find((d) => d.sector_id === sector.id && d.name.toLowerCase() === r.department.toLowerCase()) : null;
    if (r.department && sector && !dep) problems.push(`Unknown department "${r.department}" in ${sector.name}`);
    const kifle = r.kifle_ketema ? L.kifle.get(r.kifle_ketema.toLowerCase()) : null;
    if (r.kifle_ketema && !kifle) problems.push(`Unknown Kifle Ketema "${r.kifle_ketema}"`);
    const kebele = r.kebele ? L.kebeles.get(r.kebele.toLowerCase()) : null;
    if (r.kebele && !kebele) problems.push(`Unknown Kebele "${r.kebele}"`);
    if (!r.kebele && !r.kifle_ketema) problems.push('Give a Kebele or a Kifle Ketema');

    const candidate = {
      name: r.name, description: r.description, category_id: category?.id, asset_type_id: type?.id ?? null, sector_id: sector?.id,
      department_id: dep?.id ?? null, kifle_ketema_id: kifle?.id ?? null, kebele_id: kebele?.id ?? null, location_detail: r.location_detail,
      latitude: r.latitude, longitude: r.longitude, serial_number: r.serial_number, registration_number: r.registration_number,
      owner_name: r.owner_name || undefined, condition: (r.condition || 'GOOD').toUpperCase(), acquisition_date: r.acquisition_date,
      acquisition_cost: r.acquisition_cost, function_use: r.function_use, responsible_officer: r.responsible_officer,
      responsible_office: r.responsible_office, current_holder: r.current_holder,
    };
    const parsed = assetSchema.safeParse(candidate);
    if (!parsed.success) for (const issue of parsed.error.issues) problems.push(`${issue.path.join('.') || 'row'}: ${issue.message}`);
    if (parsed.success && !problems.length) {
      try {
        const resolved = await resolveRefs(req.user, parsed.data, null);
        await assertNoDuplicates(parsed.data);
        for (const [kind, v] of [['serial_number', parsed.data.serial_number], ['registration_number', parsed.data.registration_number]]) {
          if (!v) continue;
          const key = `${kind}:${v.toLowerCase()}`;
          if (seen.has(key)) problems.push(`${kind} "${v}" is repeated in this file (row ${seen.get(key)})`);
          else seen.set(key, row);
        }
        if (!problems.length) ready.push(resolved);
      } catch (e) {
        if (e instanceof HttpError) problems.push(...Object.values(e.details || { _: e.message }));
        else throw e;
      }
    }
    if (problems.length) errors.push({ row, name: r.name || '', problems });
  }

  if (errors.length) return res.status(400).json({ error: `${errors.length} of ${records.length} rows have problems. Nothing was imported.`, imported: 0, rows: records.length, errors: errors.slice(0, 200) });
  if (dryRun) return res.json({ dry_run: true, imported: 0, valid: ready.length, rows: records.length, errors: [] });

  const codes = await db.transaction(async (trx) => {
    const out = [];
    for (const fields of ready) {
      const [id] = await trx('assets').insert({ ...fields, approval_state: 'DRAFT', status: 'REGISTERED', created_by: req.user.id });
      await trx('assets').where({ id }).update({ asset_code: assetCode(id) });
      await logAudit(trx, req.user, { action: 'CREATE', entity: 'asset', entityId: id, assetId: id, summary: `Registered ${assetCode(id)}: ${fields.name} (bulk import)` });
      out.push(assetCode(id));
    }
    await logAudit(trx, req.user, { action: 'IMPORT', entity: 'assets', summary: `Bulk import: ${out.length} assets (${out[0]} to ${out[out.length - 1]})` });
    return out;
  });
  res.status(201).json({ imported: codes.length, rows: records.length, errors: [], first: codes[0], last: codes[codes.length - 1] });
});

export default router;
