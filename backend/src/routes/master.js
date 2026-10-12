import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, require_ } from '../middleware/auth.js';
import { HttpError, notFound, parse } from '../middleware/errors.js';
import { canManageMaster } from '../lib/permissions.js';
import { logAudit, diff } from '../lib/audit.js';
import { idRef, optIdRef, reqStr, optStr, bool, present } from '../lib/schemas.js';

const router = Router();
router.use(authenticate);

const flags = { is_validated: bool.optional(), is_active: bool.optional() };

// One entry per master-data table. `parents` are foreign keys that must reference an existing row.
const RESOURCES = {
  'kifle-ketemas': {
    table: 'kifle_ketemas', label: 'Kifle Ketema',
    schema: z.object({ name: reqStr(120, 'Name'), ...flags }),
    order: ['name'],
  },
  kebeles: {
    table: 'kebeles', label: 'Kebele',
    // A Kebele can be listed before the City confirms which Kifle Ketema it belongs to (kifle_ketema_id stays empty).
    schema: z.object({ name: reqStr(120, 'Name'), kifle_ketema_id: optIdRef, ...flags }),
    parents: { kifle_ketema_id: 'kifle_ketemas' },
    uniqueName: true,
    select: ['kebeles.*', 'kifle_ketemas.name as kifle_ketema_name'],
    join: ['kifle_ketemas', 'kifle_ketemas.id', 'kebeles.kifle_ketema_id'],
    leftJoin: true,
    order: ['kifle_ketemas.name', 'kebeles.name'],
  },
  sectors: {
    table: 'sectors', label: 'Sector',
    schema: z.object({ code: reqStr(20, 'Code'), name: reqStr(120, 'Name'), description: optStr(2000), ...flags }),
    order: ['code'],
  },
  departments: {
    table: 'departments', label: 'Department',
    schema: z.object({ name: reqStr(160, 'Name'), sector_id: idRef, is_active: bool.optional() }),
    parents: { sector_id: 'sectors' },
    select: ['departments.*', 'sectors.name as sector_name'],
    join: ['sectors', 'sectors.id', 'departments.sector_id'],
    order: ['sectors.code', 'departments.name'],
  },
  'asset-categories': {
    table: 'asset_categories', label: 'Asset category',
    schema: z.object({ name: reqStr(120, 'Name'), description: optStr(2000), ...flags }),
    order: ['name'],
  },
  'asset-types': {
    table: 'asset_types', label: 'Asset type',
    schema: z.object({ name: reqStr(120, 'Name'), category_id: idRef, is_active: bool.optional() }),
    parents: { category_id: 'asset_categories' },
    select: ['asset_types.*', 'asset_categories.name as category_name'],
    join: ['asset_categories', 'asset_categories.id', 'asset_types.category_id'],
    order: ['asset_categories.name', 'asset_types.name'],
  },
};

// MySQL stores booleans as 0/1; the API returns real booleans.
const boolify = (row) => {
  for (const k of ['is_validated', 'is_active']) if (k in row) row[k] = Boolean(row[k]);
  return row;
};

function listQuery(r) {
  const q = db(r.table).select(r.select || [`${r.table}.*`]);
  if (r.join) (r.leftJoin ? q.leftJoin(...r.join) : q.join(...r.join));
  r.order.forEach((o) => q.orderBy(o));
  return q;
}

async function checkParents(r, data) {
  for (const [col, table] of Object.entries(r.parents || {})) {
    if (data[col] === undefined || data[col] === null) continue;
    if (!(await db(table).where({ id: data[col] }).first())) {
      throw new HttpError(400, 'Please correct the highlighted fields.', { [col]: 'Does not exist.' });
    }
  }
}

// Kebele names must be unique across the City even while their Kifle Ketema is not yet known.
async function checkUniqueName(r, data, exceptId = null) {
  if (!r.uniqueName || !data.name) return;
  const q = db(r.table).whereRaw('LOWER(name) = ?', [data.name.toLowerCase()]);
  if (exceptId) q.whereNot('id', exceptId);
  if (await q.first()) throw new HttpError(400, 'Please correct the highlighted fields.', { name: 'A Kebele with this name already exists.' });
}

// Everything a form needs, in one call.
router.get('/lookups', async (req, res) => {
  const out = {};
  for (const [key, r] of Object.entries(RESOURCES)) out[key] = (await listQuery(r)).map(boolify);
  res.json(out);
});

router.get('/:resource', async (req, res) => {
  const r = RESOURCES[req.params.resource];
  if (!r) throw notFound();
  res.json((await listQuery(r)).map(boolify));
});

router.post('/:resource', require_(canManageMaster), async (req, res) => {
  const r = RESOURCES[req.params.resource];
  if (!r) throw notFound();
  const data = parse(r.schema, req.body);
  await checkParents(r, data);
  await checkUniqueName(r, data);
  const [id] = await db(r.table).insert(data);
  await logAudit(null, req.user, { action: 'CREATE', entity: r.table, entityId: id, summary: `Created ${r.label}: ${data.name || data.code}`, changes: data });
  res.status(201).json(boolify(await db(r.table).where({ id }).first()));
});

router.patch('/:resource/:id', require_(canManageMaster), async (req, res) => {
  const r = RESOURCES[req.params.resource];
  if (!r) throw notFound();
  const before = await db(r.table).where({ id: req.params.id }).first();
  if (!before) throw notFound();
  const data = present(parse(r.schema.partial(), req.body), req.body);
  await checkParents(r, data);
  await checkUniqueName(r, data, before.id);
  const movesKebele = r.table === 'kebeles' && 'kifle_ketema_id' in data && data.kifle_ketema_id !== before.kifle_ketema_id;
  if (movesKebele && !data.kifle_ketema_id) {
    const { n } = await db('assets').where({ kebele_id: before.id }).count({ n: 'id' }).first();
    if (Number(n) > 0) throw new HttpError(400, 'Please correct the highlighted fields.', { kifle_ketema_id: `This Kebele already has ${n} assets. Move it to another Kifle Ketema instead of leaving it empty.` });
  }
  await db.transaction(async (trx) => {
    if (Object.keys(data).length) await trx(r.table).where({ id: before.id }).update(data);
    // The Kifle Ketema of an asset follows its Kebele, so the Kifle Ketema administrators see the right assets.
    if (movesKebele && data.kifle_ketema_id) await trx('assets').where({ kebele_id: before.id }).update({ kifle_ketema_id: data.kifle_ketema_id });
  });
  const after = await db(r.table).where({ id: before.id }).first();
  const changes = diff(before, after, Object.keys(data));
  if (Object.keys(changes).length) {
    await logAudit(null, req.user, { action: 'UPDATE', entity: r.table, entityId: before.id, summary: `Updated ${r.label}: ${after.name || after.code}`, changes });
  }
  res.json(boolify(after));
});

export default router;
