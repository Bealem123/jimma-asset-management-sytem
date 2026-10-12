import { z } from 'zod';
import { db } from '../db.js';
import { HttpError } from '../middleware/errors.js';
import { ACQUISITION_METHODS, CONDITIONS, OWNERSHIP_TYPES } from './constants.js';
import {
  bool, lat, lng, money, oneOf, optDate, optIdRef, optStr, idRef, reqStr,
} from './schemas.js';

export const ASSET_FIELDS = [
  'name', 'description', 'category_id', 'asset_type_id', 'sector_id', 'department_id', 'kifle_ketema_id', 'kebele_id',
  'location_detail', 'latitude', 'longitude', 'ownership_type', 'owner_name', 'responsible_officer', 'responsible_office', 'current_holder',
  'condition', 'acquisition_date', 'acquisition_cost', 'serial_number', 'registration_number', 'function_use', 'is_reservable',
  'useful_life_years', 'salvage_value',
];

const optInt = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1).max(200).nullable()).default(null);

export const assetSchema = z.object({
  name: reqStr(200, 'Asset name'),
  description: optStr(5000),
  category_id: idRef,
  asset_type_id: optIdRef,
  sector_id: idRef,
  department_id: optIdRef,
  kifle_ketema_id: optIdRef,
  kebele_id: optIdRef,
  location_detail: optStr(255),
  latitude: lat,
  longitude: lng,
  ownership_type: oneOf(OWNERSHIP_TYPES, 'Ownership type').default('OWNED'),
  owner_name: reqStr(200, 'Owner').default('Jimma City Administration'),
  responsible_officer: optStr(160),
  responsible_office: optStr(200),
  current_holder: optStr(200),
  condition: oneOf(CONDITIONS, 'Condition').default('GOOD'),
  acquisition_date: optDate,
  acquisition_cost: money,
  serial_number: optStr(120),
  registration_number: optStr(120),
  function_use: optStr(160),
  is_reservable: bool.default(false),
  useful_life_years: optInt,
  salvage_value: money,
  details: z.record(z.string(), z.unknown()).nullish(), // the sector's own fields, checked against lib/sectorFields.js
});

export const acquisitionSchema = z.object({
  method: oneOf(ACQUISITION_METHODS, 'Acquisition method'),
  procurement_ref: optStr(120),
  supplier_name: optStr(200),
  supplier_contact: optStr(200),
  contract_ref: optStr(120),
  invoice_ref: optStr(120),
  acquisition_date: optDate,
  cost: money,
  approval_ref: optStr(160),
  approved_by_name: optStr(200),
  approved_on: optDate,
  notes: optStr(2000),
});

/**
 * Other live assets that share the serial or registration number.
 * Disposed assets are ignored: a serial number can legitimately be reused after disposal.
 */
export async function findDuplicates({ serial_number, registration_number }, excludeId = null) {
  if (!serial_number && !registration_number) return [];
  const q = db('assets').select('id', 'asset_code', 'name', 'serial_number', 'registration_number').whereNot('status', 'DISPOSED')
    .where((b) => {
      if (serial_number) b.orWhere('serial_number', serial_number);
      if (registration_number) b.orWhere('registration_number', registration_number);
    });
  if (excludeId) q.whereNot('id', excludeId);
  return q;
}

export async function assertNoDuplicates(candidate, excludeId = null) {
  const dups = await findDuplicates(candidate, excludeId);
  if (!dups.length) return;
  const field = dups.some((d) => candidate.serial_number && d.serial_number === candidate.serial_number) ? 'serial_number' : 'registration_number';
  const list = dups.map((d) => `${d.asset_code} (${d.name})`).join(', ');
  throw new HttpError(409, 'Possible duplicate asset.', { [field]: `Already used by ${list}. If this is a different asset, correct the number.` });
}
