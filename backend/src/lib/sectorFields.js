import { HttpError } from '../middleware/errors.js';

// What each of the 13 sectors records about its own assets, on top of the fields every asset has. These are the
// second step of registration ("<sector> details") and are kept with the asset (assets.details).
// Like the sectors themselves, these are WORKING proposals to confirm with each sector office: changing them here
// changes the form; values already saved are kept.
//
// field: { key, label, type: text | number | date | select, options, unit, required, help, money, show: { key, in } }
//   required -> needed before the asset can be sent for verification
//   money    -> hidden from roles that may not see financial figures
//   show     -> asked only when another field of the sector has one of the listed values

const t = (key, label, more = {}) => ({ key, label, type: 'text', ...more });
const n = (key, label, more = {}) => ({ key, label, type: 'number', ...more });
const d = (key, label, more = {}) => ({ key, label, type: 'date', ...more });
const s = (key, label, options, more = {}) => ({ key, label, type: 'select', options, ...more });

const LICENCE = (label = 'Licence / permit number') => t('licence_no', label);

export const SECTOR_FIELDS = {
  AGR: [
    s('agri_use', 'Agricultural use', ['Crops', 'Coffee', 'Livestock', 'Nursery / seedlings', 'Irrigation scheme', 'Mixed farming', 'Not in use'], { required: true }),
    n('area_ha', 'Area', { unit: 'ha', required: true }),
    s('water_source', 'Water source', ['Rain-fed', 'River', 'Borehole / well', 'Irrigation canal', 'Other']),
    t('operator', 'Farmed / operated by', { help: 'The office, cooperative or person working the land.' }),
    t('title_deed_no', 'Title deed / holding certificate number'),
  ],
  LND: [
    t('plot_number', 'Plot / parcel number', { required: true }),
    n('area_m2', 'Area', { unit: 'm²', required: true }),
    s('land_use', 'Planned land use', ['Residential', 'Commercial', 'Industrial', 'Institutional', 'Agricultural', 'Mixed use', 'Green / open space', 'Road reserve'], { required: true }),
    t('title_deed_no', 'Title deed / certificate number'),
    s('lease_status', 'Lease status', ['Not leased', 'Leased', 'Under negotiation', 'In dispute']),
    t('lessee', 'Lessee', { show: { key: 'lease_status', in: ['Leased', 'Under negotiation'] } }),
    d('lease_end', 'Lease ends on', { show: { key: 'lease_status', in: ['Leased'] } }),
    n('lease_rate_etb', 'Annual lease amount', { unit: 'ETB', money: true, show: { key: 'lease_status', in: ['Leased'] } }),
  ],
  INV: [
    t('project_name', 'Investment project', { required: true }),
    t('investor', 'Investor / company'),
    t('licence_no', 'Investment licence number'),
    s('project_stage', 'Project stage', ['Planned', 'Under construction', 'Operational', 'Suspended', 'Terminated'], { required: true }),
    n('land_area_m2', 'Land allocated', { unit: 'm²' }),
    n('jobs', 'Jobs created', { help: 'Permanent jobs, if known.' }),
  ],
  BUS: [
    s('premises_type', 'Type of premises', ['Shop', 'Stall', 'Kiosk', 'Market block', 'Commercial building', 'Warehouse', 'Other'], { required: true }),
    t('unit_no', 'Unit / stall number'),
    n('floor_area_m2', 'Floor area', { unit: 'm²' }),
    t('occupant', 'Business operating in it', { help: 'Trading name of the tenant or user, if any.' }),
    LICENCE('Trade licence number'),
    n('monthly_rent_etb', 'Monthly rent', { unit: 'ETB', money: true }),
  ],
  EXP: [
    s('facility_type', 'Type of facility', ['Warehouse', 'Processing plant', 'Storage yard', 'Packing house', 'Other'], { required: true }),
    s('commodity', 'Main commodity', ['Coffee', 'Fruit and vegetables', 'Spices', 'Livestock products', 'Other']),
    n('capacity_t', 'Storage / processing capacity', { unit: 'tonnes' }),
    t('operator', 'Operated by'),
    LICENCE('Export licence number'),
  ],
  SRV: [
    s('service_type', 'Service provided', ['Administrative office', 'Customer service centre', 'Sanitation / waste', 'Water supply', 'Health', 'Education', 'Other'], { required: true }),
    n('floor_area_m2', 'Floor area', { unit: 'm²' }),
    n('daily_users', 'People served per day', { help: 'An estimate is fine.' }),
    t('opening_hours', 'Opening hours', { help: 'e.g. Mon–Fri 8:30–17:30' }),
  ],
  MFG: [
    s('facility_type', 'Type', ['Factory', 'Workshop', 'Industrial shed', 'Production machine', 'Other'], { required: true }),
    t('product', 'What it produces'),
    t('capacity', 'Production capacity', { help: 'e.g. 500 blocks a day' }),
    n('power_kva', 'Installed power', { unit: 'kVA' }),
    t('operator', 'Operated by'),
    LICENCE(),
  ],
  CON: [
    s('con_kind', 'What is being registered', ['Construction machine', 'Construction site', 'Building under construction', 'Material yard'], { required: true }),
    t('make_model', 'Make and model', { show: { key: 'con_kind', in: ['Construction machine'] } }),
    n('engine_hours', 'Engine hours', { unit: 'h', show: { key: 'con_kind', in: ['Construction machine'] } }),
    t('project_name', 'Project', { show: { key: 'con_kind', in: ['Construction site', 'Building under construction', 'Material yard'] } }),
    t('contractor', 'Contractor', { show: { key: 'con_kind', in: ['Construction site', 'Building under construction'] } }),
    t('permit_no', 'Building / construction permit number', { show: { key: 'con_kind', in: ['Construction site', 'Building under construction'] } }),
    d('completion_date', 'Planned completion', { show: { key: 'con_kind', in: ['Construction site', 'Building under construction'] } }),
  ],
  TOU: [
    s('site_type', 'Type of site', ['Heritage site', 'Museum', 'Park', 'Hotel / lodge', 'Viewpoint', 'Cultural centre', 'Other'], { required: true }),
    s('heritage_status', 'Heritage status', ['Not listed', 'Locally protected', 'Nationally registered']),
    n('visitors_per_day', 'Visitor capacity per day'),
    n('entrance_fee_etb', 'Entrance fee', { unit: 'ETB', money: true }),
    t('managed_by', 'Managed by'),
  ],
  TRN: [
    s('trn_kind', 'What is being registered', ['Vehicle', 'Bus / taxi terminal', 'Parking area', 'Road or bridge', 'Other'], { required: true }),
    t('make_model', 'Make and model', { show: { key: 'trn_kind', in: ['Vehicle'] }, required: true }),
    n('year', 'Year of manufacture', { show: { key: 'trn_kind', in: ['Vehicle'] } }),
    s('fuel', 'Fuel', ['Diesel', 'Petrol', 'Electric', 'Hybrid'], { show: { key: 'trn_kind', in: ['Vehicle'] } }),
    n('seats', 'Seats', { show: { key: 'trn_kind', in: ['Vehicle'] } }),
    t('chassis_no', 'Chassis number', { show: { key: 'trn_kind', in: ['Vehicle'] } }),
    t('engine_no', 'Engine number', { show: { key: 'trn_kind', in: ['Vehicle'] } }),
    n('odometer_km', 'Odometer', { unit: 'km', show: { key: 'trn_kind', in: ['Vehicle'] } }),
    d('insurance_until', 'Insurance valid until', { show: { key: 'trn_kind', in: ['Vehicle'] } }),
    n('parking_spaces', 'Parking spaces / bays', { show: { key: 'trn_kind', in: ['Bus / taxi terminal', 'Parking area'] } }),
    n('length_km', 'Length', { unit: 'km', show: { key: 'trn_kind', in: ['Road or bridge'] } }),
  ],
  GDS: [
    s('item_type', 'Type of item', ['Furniture', 'Office equipment', 'ICT equipment', 'Tools', 'Stock / materials', 'Other'], { required: true }),
    t('brand_model', 'Brand and model'),
    n('quantity', 'Quantity', { help: 'For a batch registered as one asset, e.g. 20 chairs.' }),
    t('unit', 'Unit', { help: 'e.g. pieces, sets, boxes' }),
    t('assigned_office', 'Office using it'),
    d('warranty_until', 'Warranty valid until'),
  ],
  RNT: [
    s('rental_type', 'What is rented out', ['Shop', 'Hall', 'House', 'Office', 'Stall', 'Land plot', 'Other'], { required: true }),
    t('unit_no', 'Unit / plot number'),
    n('floor_area_m2', 'Area', { unit: 'm²' }),
    s('occupancy', 'Occupancy', ['Rented', 'Vacant', 'Under maintenance'], { required: true }),
    t('tenant', 'Tenant', { show: { key: 'occupancy', in: ['Rented'] } }),
    t('contract_no', 'Rental contract number', { show: { key: 'occupancy', in: ['Rented'] } }),
    d('contract_end', 'Contract ends on', { show: { key: 'occupancy', in: ['Rented'] } }),
    n('monthly_rent_etb', 'Monthly rent', { unit: 'ETB', money: true, show: { key: 'occupancy', in: ['Rented'] } }),
  ],
  ASK: [
    t('local_name', 'Local name of the asset or charge', { required: true, help: 'As it is known locally.' }),
    t('payer', 'Who pays / uses it'),
    t('legal_basis', 'Legal basis', { help: 'Proclamation, regulation or council decision, if known.' }),
    t('collection_point', 'Where it is collected or kept'),
  ],
};

/** The fields of a sector (by code), or none. */
export const fieldsFor = (code) => SECTOR_FIELDS[code] || [];

const shown = (field, values) => !field.show || field.show.in.includes(values[field.show.key]);
const empty = (v) => v === undefined || v === null || v === '';
const bad = (key, message) => new HttpError(400, 'Please correct the highlighted fields.', { [`details.${key}`]: message });

/**
 * Check and tidy the sector details of an asset: keep only the fields of its sector that apply, with the right type.
 * `requireAll`: also insist on the required ones (when the asset is sent for verification).
 */
export function cleanDetails(code, raw, { requireAll = false } = {}) {
  const values = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const f of fieldsFor(code)) {
    if (!shown(f, values)) continue;
    let v = values[f.key];
    if (typeof v === 'string') v = v.trim();
    if (empty(v)) {
      if (requireAll && f.required) throw bad(f.key, `${f.label} is needed.`);
      continue;
    }
    if (f.type === 'number') {
      const num = Number(v);
      if (!Number.isFinite(num) || num < 0) throw bad(f.key, 'Enter a number (0 or more).');
      v = num;
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw bad(f.key, 'Enter a date.');
    } else if (f.type === 'select') {
      if (!f.options.includes(v)) throw bad(f.key, 'Choose one of the options.');
    } else {
      v = String(v).slice(0, 200);
    }
    out[f.key] = v;
  }
  return out;
}

/** The money fields of all sectors: hidden from roles that may not see financial figures. */
export const MONEY_DETAIL_KEYS = [...new Set(Object.values(SECTOR_FIELDS).flat().filter((f) => f.money).map((f) => f.key))];
