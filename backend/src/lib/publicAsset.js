import crypto from 'node:crypto';
import { db } from '../db.js';
import { assetBase, parseDetails } from './assetQuery.js';
import { fieldsFor } from './sectorFields.js';

// The public asset card: what anyone who scans the QR code on an asset sees, without signing in.
// It says what the asset is, whose it is, where it belongs and what state it is in, with its photos. It never shows
// money, people's names, the exact GPS position, serial / chassis / engine numbers, title deeds, contracts or licences,
// documents other than photos, or the history.

/** The asset's public token (made the first time its QR code is drawn). */
export async function ensureToken(asset) {
  if (asset.public_token) return asset.public_token;
  for (let i = 0; i < 5; i++) {
    const token = crypto.randomBytes(12).toString('base64url'); // 16 characters
    const updated = await db('assets').where({ id: asset.id }).whereNull('public_token').update({ public_token: token }).catch(() => 0);
    if (updated) return token;
    const again = await db('assets').where({ id: asset.id }).first('public_token');
    if (again?.public_token) return again.public_token;
  }
  throw new Error('Could not make a public token.');
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{16,32}$/;

/** The asset behind a token, or null. */
export const assetByToken = (token) => (TOKEN_RE.test(token || '') ? db('assets').where({ public_token: token }).first() : null);

/** Everything the public card shows, for the asset behind `token`; null when there is none. */
export async function publicCard(token) {
  const found = await assetByToken(token);
  if (!found) return null;
  const a = await assetBase().where('assets.id', found.id).first();
  const details = parseDetails(a.details);
  const sectorDetails = fieldsFor(a.sector_code)
    .filter((f) => !f.money && !f.private && details[f.key] != null && details[f.key] !== '')
    .map((f) => ({ label: f.label, type: f.type, unit: f.unit ?? null, value: details[f.key] }));
  const photos = await db('asset_documents').where({ asset_id: a.id, doc_type: 'PHOTO' })
    .orderBy('uploaded_at', 'asc').orderBy('id', 'asc').select('id', 'title', 'uploaded_at');
  return {
    asset: {
      asset_code: a.asset_code, name: a.name, description: a.description, function_use: a.function_use,
      category_name: a.category_name, asset_type_name: a.asset_type_name, sector_name: a.sector_name,
      registration_number: a.registration_number, // a plate number is written on the vehicle itself
      kifle_ketema_name: a.kifle_ketema_name, kebele_name: a.kebele_name, location_detail: a.location_detail,
      ownership_type: a.ownership_type, owner_name: a.owner_name, responsible_office: a.responsible_office,
      condition: a.condition, status: a.status, approval_state: a.approval_state,
      is_reservable: Boolean(a.is_reservable), registered_on: a.created_at, archived: Boolean(a.archived_at),
    },
    sector_details: sectorDetails,
    photos,
  };
}
