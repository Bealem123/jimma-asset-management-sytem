import { db } from '../db.js';
import { HttpError, conflict, forbidden, notFound } from '../middleware/errors.js';
import { applyScope, has, inScope, scopedAsset } from './permissions.js';

export const fail = (field, message) => new HttpError(400, 'Please correct the highlighted fields.', { [field]: message });

export const assetCode = (id) => `AST-${String(id).padStart(6, '0')}`;

/** Validate the relationships between lookup values; derive the Kifle Ketema from the Kebele. */
export async function resolveRefs(user, merged, changedKeys) {
  const changed = (k) => changedKeys === null || changedKeys.includes(k);
  const out = { ...merged };

  const category = await db('asset_categories').where({ id: merged.category_id }).first();
  if (!category) throw fail('category_id', 'Choose a category.');
  if (changed('category_id') && !category.is_active) throw fail('category_id', 'This category is inactive.');

  // a type is either one from the list or one typed in, never both
  if (merged.asset_type_id) out.asset_type_other = null;
  if (merged.asset_type_id) {
    const type = await db('asset_types').where({ id: merged.asset_type_id }).first();
    if (!type || type.category_id !== merged.category_id) throw fail('asset_type_id', 'This type does not belong to the chosen category.');
    if (changed('asset_type_id') && !type.is_active) throw fail('asset_type_id', 'This type is inactive.');
  }

  const sector = await db('sectors').where({ id: merged.sector_id }).first();
  if (!sector) throw fail('sector_id', 'Choose a sector.');
  if (changed('sector_id') && !sector.is_active) throw fail('sector_id', 'This sector is inactive.');

  if (merged.department_id) {
    const dep = await db('departments').where({ id: merged.department_id }).first();
    if (!dep || dep.sector_id !== merged.sector_id) throw fail('department_id', 'This department does not belong to the chosen sector.');
    if (changed('department_id') && !dep.is_active) throw fail('department_id', 'This department is inactive.');
  }

  if (merged.kebele_id) {
    const kebele = await db('kebeles').where({ id: merged.kebele_id }).first();
    if (!kebele) throw fail('kebele_id', 'Choose a Kebele.');
    if (!kebele.kifle_ketema_id) {
      throw fail('kebele_id', 'This Kebele is not yet linked to a Kifle Ketema. Ask the administrator to complete it in Master data.');
    }
    if (merged.kifle_ketema_id && merged.kifle_ketema_id !== kebele.kifle_ketema_id) {
      throw fail('kebele_id', 'This Kebele does not belong to the chosen Kifle Ketema.');
    }
    if (changed('kebele_id') && !kebele.is_active) throw fail('kebele_id', 'This Kebele is inactive.');
    out.kifle_ketema_id = kebele.kifle_ketema_id;
  } else if (!merged.kifle_ketema_id) {
    throw fail('kifle_ketema_id', 'Choose a Kifle Ketema (or a Kebele).');
  } else {
    const kifle = await db('kifle_ketemas').where({ id: merged.kifle_ketema_id }).first();
    if (!kifle) throw fail('kifle_ketema_id', 'Choose a Kifle Ketema.');
    if (changed('kifle_ketema_id') && !kifle.is_active) throw fail('kifle_ketema_id', 'This Kifle Ketema is inactive.');
  }

  if (!inScope(user, out)) throw forbidden('This location or sector is outside your assigned area.');
  return out;
}

export async function getVisibleAsset(req, id = req.params.id) {
  const asset = await scopedAsset(req.user, id);
  if (!asset) throw notFound('Asset not found.');
  return asset;
}

/** A disposed asset's record is locked. */
export function assertNotDisposed(asset) {
  if (asset.status === 'DISPOSED') throw conflict('This asset has been disposed and its record is locked.');
}

/**
 * Route guard: load the asset (404 if outside the user's area), require a permission, refuse locked records.
 * Usage: router.post('/:id/x', guardAsset('maintenance.record'), handler) -> req.asset
 */
export const guardAsset = (permission, { allowDisposed = false } = {}) => async (req, res, next) => {
  req.asset = await getVisibleAsset(req);
  const needed = [].concat(permission || []); // any one of these is enough
  if (needed.length && !needed.some((p) => has(req.user, p))) throw forbidden('Your role is not allowed to do this.');
  if (!allowDisposed) assertNotDisposed(req.asset);
  next();
};

/** Asset code or numeric id -> visible asset row. */
export async function findVisibleByCodeOrId(user, ref) {
  const q = /^\d+$/.test(String(ref)) ? { 'assets.id': Number(ref) } : { 'assets.asset_code': String(ref).trim().toUpperCase() };
  const asset = await applyScope(db('assets').where(q), user).first();
  if (!asset) throw notFound('Asset not found.');
  return asset;
}
