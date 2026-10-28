import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticateApiKey } from '../middleware/auth.js';
import { notFound, parse } from '../middleware/errors.js';
import { assetBase, normalizeAsset } from '../lib/assetQuery.js';
import { STATUSES, CONDITIONS } from '../lib/constants.js';
import { optDate } from '../lib/schemas.js';

// Read-only REST API for other City systems (GIS, finance, procurement, dashboards ...).
// Authenticate with an API key created in System administration: send it in the X-API-Key header.
// Financial figures are never exposed here.
// Only the official register is shared: assets that went through the whole registration chain (verified on site by
// the Kebele, approved and activated by the Kifle Ketema). Drafts and assets still waiting for approval stay inside.

const router = Router();
const registered = () => assetBase().where('assets.approval_state', 'ACTIVE');

const publicAsset = (r) => ({
  asset_id: r.asset_code, name: r.name, category: r.category_name, type: r.asset_type_name, sector: r.sector_name,
  department: r.department_name, kifle_ketema: r.kifle_ketema_name, kebele: r.kebele_name, location: r.location_detail,
  latitude: r.latitude, longitude: r.longitude, status: r.status, condition: r.condition, serial_number: r.serial_number,
  registration_number: r.registration_number, owner: r.owner_name, responsible_office: r.responsible_office,
  responsible_officer: r.responsible_officer, current_holder: r.current_holder, updated_at: r.updated_at,
  // stable identifiers, so another system matches by id and never by a name that may be corrected later
  ids: {
    kifle_ketema: r.kifle_ketema_id, kebele: r.kebele_id, sector: r.sector_id, sector_code: r.sector_code,
    category: r.category_id, type: r.asset_type_id,
  },
  approval_state: r.approval_state,
  archived: Boolean(r.archived_at), archived_at: r.archived_at ?? null,
});

const openapi = {
  openapi: '3.0.3',
  info: { title: 'Jimma City Asset Management - read-only API', version: '1.1.0', description: 'Authenticate with the X-API-Key header. 1.1 adds ids (Kifle Ketema, Kebele, sector, category, type), approval_state and archived to each asset, and include_archived to the list.' },
  servers: [{ url: '/api/integration/v1' }],
  components: { securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
  security: [{ ApiKey: [] }],
  paths: {
    '/assets': { get: { summary: 'List registered (approved and activated) assets, paged', parameters: ['page', 'page_size', 'status', 'condition', 'kifle_ketema', 'kebele', 'sector', 'updated_since', 'include_archived'].map((name) => ({ name, in: 'query', schema: { type: 'string' } })) } },
    '/assets/{code}': { get: { summary: 'One registered asset by Asset ID, e.g. AST-000125 (404 while it is not yet approved)' } },
    '/locations': { get: { summary: 'Kifle Ketemas and Kebeles' } },
    '/sectors': { get: { summary: 'Sectors and their departments' } },
    '/categories': { get: { summary: 'Asset categories and types' } },
  },
};

router.get('/openapi.json', (req, res) => res.json(openapi));

router.use(authenticateApiKey);

router.get('/assets', async (req, res) => {
  const f = parse(z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(500).default(100),
    status: z.preprocess((v) => v || undefined, z.enum(STATUSES).optional()),
    condition: z.preprocess((v) => v || undefined, z.enum(CONDITIONS).optional()),
    kifle_ketema: z.string().max(120).optional(),
    kebele: z.string().max(120).optional(),
    sector: z.string().max(120).optional(),
    updated_since: optDate,
    // a system that keeps references (e.g. Rent) needs to learn that an asset was archived, not just stop seeing it
    include_archived: z.preprocess((v) => v === 'true' || v === '1', z.boolean()).default(false),
  }), req.query);
  const build = () => {
    const q = registered();
    if (!f.include_archived) q.whereNull('assets.archived_at');
    if (f.status) q.where('assets.status', f.status);
    if (f.condition) q.where('assets.condition', f.condition);
    if (f.kifle_ketema) q.where('k.name', f.kifle_ketema);
    if (f.kebele) q.where('b.name', f.kebele);
    if (f.sector) q.where((b) => b.where('s.name', f.sector).orWhere('s.code', f.sector));
    if (f.updated_since) q.where('assets.updated_at', '>=', `${f.updated_since} 00:00:00`);
    return q;
  };
  const { n } = await build().clear('select').count({ n: 'assets.id' }).first();
  const rows = await build().orderBy('assets.asset_code').limit(f.page_size).offset((f.page - 1) * f.page_size);
  res.json({ total: Number(n), page: f.page, page_size: f.page_size, data: rows.map((r) => publicAsset(normalizeAsset(r))) });
});

router.get('/assets/:code', async (req, res) => {
  const row = await registered().where('assets.asset_code', String(req.params.code).toUpperCase()).first();
  if (!row) throw notFound('Asset not found.');
  res.json(publicAsset(normalizeAsset(row)));
});

router.get('/locations', async (req, res) => {
  const [kifle, kebeles] = await Promise.all([db('kifle_ketemas').where({ is_active: 1 }).orderBy('name'), db('kebeles').where({ is_active: 1 }).orderBy('name')]);
  res.json(kifle.map((k) => ({ id: k.id, name: k.name, kebeles: kebeles.filter((b) => b.kifle_ketema_id === k.id).map((b) => ({ id: b.id, name: b.name })) })));
});

router.get('/sectors', async (req, res) => {
  const [sectors, departments] = await Promise.all([db('sectors').where({ is_active: 1 }).orderBy('code'), db('departments').where({ is_active: 1 }).orderBy('name')]);
  res.json(sectors.map((s) => ({ id: s.id, code: s.code, name: s.name, departments: departments.filter((d) => d.sector_id === s.id).map((d) => ({ id: d.id, name: d.name })) })));
});

router.get('/categories', async (req, res) => {
  const [cats, types] = await Promise.all([db('asset_categories').where({ is_active: 1 }).orderBy('name'), db('asset_types').where({ is_active: 1 }).orderBy('name')]);
  res.json(cats.map((c) => ({ id: c.id, name: c.name, types: types.filter((t) => t.category_id === c.id).map((t) => ({ id: t.id, name: t.name })) })));
});

export default router;
