// Valuations and income, recorded the same way from the asset's page and from the Finance page: one set of rules,
// one place to change them. The routes decide who may record and which asset; these check the figures and save them.
import { z } from 'zod';
import { db } from '../db.js';
import { logAudit } from './audit.js';
import { fail } from './assetGuards.js';
import { notAfterToday } from './calendar.js';
import { REVENUE_TYPES } from './constants.js';
import { dateStr, oneOf, optDate, optIdRef, optNameText, optStr, reqMoney } from './schemas.js';

export const valuationSchema = z.object({ valuation_date: dateStr, value: reqMoney, method: optStr(200), notes: optStr(2000) });

export const revenueSchema = z.object({
  revenue_type: oneOf(REVENUE_TYPES, 'Revenue type'),
  amount: reqMoney,
  received_date: dateStr,
  period_start: optDate,
  period_end: optDate,
  payer: optNameText(200, 'Payer'),
  reference: optStr(120),
  utilization_id: optIdRef, // the use this income comes from, if any
  notes: optStr(2000),
});

/** Record a valuation of `asset`; the most recent one (by date) becomes the asset's current value. */
export async function recordValuation(user, asset, d) {
  if (!notAfterToday(d.valuation_date)) throw fail('valuation_date', 'A valuation cannot be dated in the future.');
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('asset_valuations').insert({
      asset_id: asset.id, valuation_date: d.valuation_date, value: d.value, method: d.method, notes: d.notes, recorded_by: user.id,
    });
    const latest = await trx('asset_valuations').where({ asset_id: asset.id }).orderBy('valuation_date', 'desc').orderBy('id', 'desc').first();
    await trx('assets').where({ id: asset.id }).update({ current_valuation: latest.value, valuation_date: latest.valuation_date, updated_at: db.fn.now() });
    await logAudit(trx, user, {
      action: 'VALUATION_ADD', entity: 'valuation', entityId: newId, assetId: asset.id,
      summary: `${asset.asset_code}: valued at ${d.value} ETB on ${d.valuation_date}`,
    });
    return newId;
  });
  return db('asset_valuations').where({ id }).first();
}

/** Record income received from `asset`. */
export async function recordRevenue(user, asset, d) {
  if (d.period_start && d.period_end && d.period_end < d.period_start) throw fail('period_end', 'The period end cannot be before its start.');
  if (!notAfterToday(d.received_date)) throw fail('received_date', 'Income cannot be received in the future.');
  if (d.utilization_id && !(await db('utilizations').where({ id: d.utilization_id, asset_id: asset.id }).first())) {
    throw fail('utilization_id', 'This use does not belong to the asset.');
  }
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('asset_revenues').insert({
      asset_id: asset.id, revenue_type: d.revenue_type, amount: d.amount, received_date: d.received_date, period_start: d.period_start,
      period_end: d.period_end, payer: d.payer, reference: d.reference, utilization_id: d.utilization_id ?? null, notes: d.notes, recorded_by: user.id,
    });
    await logAudit(trx, user, {
      action: 'REVENUE_ADD', entity: 'revenue', entityId: newId, assetId: asset.id,
      summary: `${asset.asset_code}: ${d.revenue_type.toLowerCase()} income ${d.amount} ETB received ${d.received_date}`,
    });
    return newId;
  });
  return db('asset_revenues').where({ id }).first();
}
