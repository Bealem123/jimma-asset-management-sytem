import { db } from '../db.js';
import { config } from '../config.js';
import { HttpError, conflict, forbidden, notFound } from '../middleware/errors.js';
import { DEFAULT_WORKFLOWS } from './constants.js';
import { logAudit } from './audit.js';
import { has, scopedAsset } from './permissions.js';
import { resolveRefs } from './assetGuards.js';
import { notify, notifyAsset } from './notify.js';

// A pseudo-user with city-wide reach, used only to re-validate a request the approver is allowed to execute.
const SYSTEM = { role: 'SUPER_ADMIN', scope: { kifle: [], kebeles: [], sectors: [] } };

// ------------------------------------------------------------------ workflow policy

export async function getWorkflow(type) {
  const row = await db('workflow_configs').where({ request_type: type }).first();
  if (row) return { requires_approval: Boolean(row.requires_approval), steps: row.steps };
  return DEFAULT_WORKFLOWS[type];
}

export async function listWorkflows() {
  const rows = await db('workflow_configs');
  return Object.keys(DEFAULT_WORKFLOWS).map((type) => {
    const r = rows.find((x) => x.request_type === type);
    return { request_type: type, ...(r ? { requires_approval: Boolean(r.requires_approval), steps: r.steps } : DEFAULT_WORKFLOWS[type]) };
  });
}

// ------------------------------------------------------------------ the things a request can do

/** Move an asset to a new location / responsible department. Keeps both ends. */
export async function performTransfer(trx, user, asset, d, { requestId = null, approvedBy = null } = {}) {
  const dest = await resolveRefs(SYSTEM, {
    ...asset,
    kifle_ketema_id: d.to_kifle_ketema_id, kebele_id: d.to_kebele_id,
    sector_id: d.to_sector_id ?? asset.sector_id,
    department_id: d.to_department_id !== undefined && d.to_department_id !== null ? d.to_department_id : (d.to_sector_id ? null : asset.department_id),
  }, ['kifle_ketema_id', 'kebele_id']);

  const [tid] = await trx('asset_transfers').insert({
    asset_id: asset.id,
    from_kifle_ketema_id: asset.kifle_ketema_id, from_kebele_id: asset.kebele_id, from_location_detail: asset.location_detail,
    from_department_id: asset.department_id,
    to_kifle_ketema_id: dest.kifle_ketema_id, to_kebele_id: dest.kebele_id, to_location_detail: d.to_location_detail,
    to_department_id: dest.department_id,
    transfer_date: d.transfer_date, reason: d.reason, authorized_by: d.authorized_by, recorded_by: user.id,
    request_id: requestId, approved_by: approvedBy,
  });
  await trx('assets').where({ id: asset.id }).update({
    kifle_ketema_id: dest.kifle_ketema_id, kebele_id: dest.kebele_id, location_detail: d.to_location_detail,
    sector_id: dest.sector_id, department_id: dest.department_id,
    ...(d.new_holder ? { current_holder: d.new_holder } : {}), updated_at: db.fn.now(),
  });
  await logAudit(trx, user, {
    action: 'TRANSFER', entity: 'transfer', entityId: tid, assetId: asset.id,
    summary: `${asset.asset_code}: transferred on ${d.transfer_date} (${d.reason})`,
    changes: {
      kifle_ketema_id: { from: asset.kifle_ketema_id, to: dest.kifle_ketema_id },
      kebele_id: { from: asset.kebele_id, to: dest.kebele_id },
      location_detail: { from: asset.location_detail, to: d.to_location_detail },
      department_id: { from: asset.department_id, to: dest.department_id },
      sector_id: { from: asset.sector_id, to: dest.sector_id },
    },
  });
  return { transferId: tid, after: { ...asset, ...dest } };
}

/** End the current assignment (history keeps it) and start a new one. Also updates the asset's responsibility fields. */
export async function performAssignment(trx, user, asset, d, { requestId = null } = {}) {
  const merged = {
    ...asset,
    sector_id: d.sector_id ?? asset.sector_id,
    department_id: d.department_id !== undefined && d.department_id !== null ? d.department_id : (d.sector_id && d.sector_id !== asset.sector_id ? null : asset.department_id),
  };
  const resolved = await resolveRefs(SYSTEM, merged, ['sector_id', 'department_id']);
  const next = {
    sector_id: resolved.sector_id, department_id: resolved.department_id,
    responsible_office: d.office ?? asset.responsible_office,
    responsible_officer: d.responsible_officer ?? asset.responsible_officer,
    current_holder: d.holder ?? asset.current_holder,
  };
  await trx('asset_assignments').where({ asset_id: asset.id, status: 'ACTIVE' }).update({ status: 'ENDED', ended_date: d.assigned_date });
  const [id] = await trx('asset_assignments').insert({
    asset_id: asset.id, sector_id: next.sector_id, department_id: next.department_id, office: next.responsible_office,
    responsible_officer: next.responsible_officer, holder: next.current_holder, holder_user_id: d.holder_user_id ?? null,
    assigned_date: d.assigned_date, reason: d.reason, status: 'ACTIVE', request_id: requestId, recorded_by: user.id,
  });
  await trx('assets').where({ id: asset.id }).update({ ...next, updated_at: db.fn.now() });
  const changes = {};
  for (const k of Object.keys(next)) if (String(asset[k] ?? '') !== String(next[k] ?? '')) changes[k] = { from: asset[k] ?? null, to: next[k] ?? null };
  await logAudit(trx, user, {
    action: 'ASSIGN', entity: 'assignment', entityId: id, assetId: asset.id,
    summary: `${asset.asset_code}: assigned${next.current_holder ? ` to ${next.current_holder}` : ''} (${d.reason})`, changes,
  });
  return id;
}

/** Retire or dispose of an asset. Disposal locks the record. */
export async function performDisposal(trx, user, asset, d, { requestId = null, approvedBy = null, kind }) {
  const status = kind === 'DISPOSAL' ? 'DISPOSED' : 'RETIRED';
  if (asset.status === 'DISPOSED') throw conflict('This asset has already been disposed.');
  if (kind === 'RETIREMENT' && asset.status === 'RETIRED') throw conflict('This asset is already retired.');
  const [id] = await trx('asset_disposals').insert({
    asset_id: asset.id, kind, reason: d.reason, method: d.method ?? null, disposal_date: d.disposal_date,
    disposal_value: d.disposal_value ?? null, recipient: d.recipient ?? null, notes: d.notes ?? null,
    request_id: requestId, approved_by: approvedBy, recorded_by: user.id,
  });
  await trx('assets').where({ id: asset.id }).update({
    status, updated_at: db.fn.now(), ...(status === 'DISPOSED' ? { disposed_at: db.fn.now() } : {}),
  });
  // anything still waiting on this asset is now moot
  await trx('approval_requests').where({ asset_id: asset.id }).whereIn('status', ['PENDING', 'REVIEWED'])
    .whereNot('id', requestId ?? 0).update({ status: 'CANCELLED', decision_note: `Asset ${status.toLowerCase()}` });
  await trx('asset_reservations').where({ asset_id: asset.id }).whereIn('status', ['PENDING', 'APPROVED']).update({ status: 'CANCELLED', decision_note: `Asset ${status.toLowerCase()}` });
  await logAudit(trx, user, {
    action: kind === 'DISPOSAL' ? 'DISPOSE' : 'RETIRE', entity: 'disposal', entityId: id, assetId: asset.id,
    summary: `${asset.asset_code}: status ${asset.status} → ${status} (${d.reason})`,
    changes: { status: { from: asset.status, to: status }, reason: d.reason, method: d.method ?? null, disposal_value: d.disposal_value ?? null },
  });
  return id;
}

export async function performOwnershipChange(trx, user, asset, d, { requestId = null } = {}) {
  const [id] = await trx('asset_ownership_history').insert({
    asset_id: asset.id, previous_owner: asset.owner_name, new_owner: d.new_owner,
    previous_type: asset.ownership_type, new_type: d.new_type, effective_date: d.effective_date, basis: d.basis,
    request_id: requestId, recorded_by: user.id,
  });
  await trx('assets').where({ id: asset.id }).update({ owner_name: d.new_owner, ownership_type: d.new_type, updated_at: db.fn.now() });
  await logAudit(trx, user, {
    action: 'OWNERSHIP_CHANGE', entity: 'ownership', entityId: id, assetId: asset.id,
    summary: `${asset.asset_code}: owner ${asset.owner_name} → ${d.new_owner} (${d.basis})`,
    changes: { owner_name: { from: asset.owner_name, to: d.new_owner }, ownership_type: { from: asset.ownership_type, to: d.new_type } },
  });
  return id;
}

const EXECUTORS = {
  TRANSFER: (trx, user, asset, p, ctx) => performTransfer(trx, user, asset, p, ctx),
  ASSIGNMENT: (trx, user, asset, p, ctx) => performAssignment(trx, user, asset, p, ctx),
  DISPOSAL: (trx, user, asset, p, ctx) => performDisposal(trx, user, asset, p, { ...ctx, kind: 'DISPOSAL' }),
  RETIREMENT: (trx, user, asset, p, ctx) => performDisposal(trx, user, asset, p, { ...ctx, kind: 'RETIREMENT' }),
  OWNERSHIP_CHANGE: (trx, user, asset, p, ctx) => performOwnershipChange(trx, user, asset, p, ctx),
};

const AFTER_EXECUTE = {
  async TRANSFER(user, asset, after) {
    const moved = { ...asset, kifle_ketema_id: after.after.kifle_ketema_id, kebele_id: after.after.kebele_id, sector_id: after.after.sector_id };
    await notifyAsset(moved, 'asset.edit', {
      exceptUserId: user.id, type: 'ASSET_TRANSFERRED', title: `${asset.asset_code} was transferred`, body: asset.name,
      dedupeKey: `TRANSFER:${after.transferId}`,
    });
  },
  async DISPOSAL(user, asset) {
    await notifyAsset(asset, 'request.decide', {
      exceptUserId: user.id, type: 'DISPOSAL_DECISION', title: `${asset.asset_code} was disposed`, body: asset.name,
    });
  },
  async RETIREMENT(user, asset) {
    await notifyAsset(asset, 'request.decide', {
      exceptUserId: user.id, type: 'DISPOSAL_DECISION', title: `${asset.asset_code} was retired`, body: asset.name,
    });
  },
};

// ------------------------------------------------------------------ creating requests

/**
 * Do it now if this kind of request needs no approval; otherwise record it for an approver.
 * A two-step request waits for the Kebele Administrator's review, then the Kifle Ketema Administrator's approval.
 * When a reviewer (the Kebele Administrator) asks, the asking is its review: the request goes straight to the approver.
 * Returns { executed: true, result } or { executed: false, request }.
 */
export async function submitOrExecute(user, asset, type, payload, summary) {
  const wf = await getWorkflow(type);
  if (!wf.requires_approval) {
    const result = await db.transaction((trx) => EXECUTORS[type](trx, user, asset, payload, {}));
    await AFTER_EXECUTE[type]?.(user, asset, result);
    return { executed: true, result };
  }
  const clash = await db('approval_requests').where({ asset_id: asset.id, request_type: type }).whereIn('status', ['PENDING', 'REVIEWED']).first();
  if (clash) throw conflict(`There is already a ${type.toLowerCase().replace('_', ' ')} request waiting for approval for this asset.`);
  const twoStep = wf.steps >= 2;
  const reviewedByAsker = twoStep && has(user, 'request.review');
  const request = await db.transaction(async (trx) => {
    const [id] = await trx('approval_requests').insert({
      request_type: type, asset_id: asset.id, payload: JSON.stringify(payload), summary: summary.slice(0, 500), requested_by: user.id,
      ...(reviewedByAsker ? { status: 'REVIEWED', reviewed_by: user.id, reviewed_at: db.fn.now() } : {}),
    });
    await logAudit(trx, user, {
      action: 'REQUEST_CREATE', entity: 'request', entityId: id, assetId: asset.id, summary: `${asset.asset_code}: ${type.toLowerCase().replace('_', ' ')} requested${reviewedByAsker ? ' and reviewed' : ''} - ${summary}`,
    });
    return trx('approval_requests').where({ id }).first();
  });
  const reviewFirst = twoStep && !reviewedByAsker;
  await notifyAsset(asset, reviewFirst ? 'request.review' : 'request.decide', {
    exceptUserId: user.id, type: 'APPROVAL_PENDING',
    title: `${asset.asset_code}: ${type.toLowerCase().replace('_', ' ')} request waiting${reviewFirst ? ' for review' : ''}`,
    body: summary, link: '/approvals?tab=requests', dedupeKey: `REQ:${request.id}:new`,
  });
  return { executed: false, request };
}

// ------------------------------------------------------------------ deciding requests

const parsePayload = (row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
export const presentRequest = (row) => ({ ...row, payload: parsePayload(row) });

// Who acts on a request: the Kebele Administrator reviews it (request.review), the Kifle Ketema Administrator
// gives the final approval (request.decide). Either may reject it while it is at their step.
async function loadForDecision(user, id, may) {
  if (!may(user)) throw forbidden('Your role cannot decide this request.');
  const request = await db('approval_requests').where({ id }).first();
  if (!request) throw notFound('Request not found.');
  const asset = await scopedAsset(user, request.asset_id);
  if (!asset) throw notFound('Request not found.'); // outside the approver's area
  return { request, asset };
}

function assertOpen(request) {
  if (!['PENDING', 'REVIEWED'].includes(request.status)) throw conflict(`This request is already ${request.status.toLowerCase()}.`);
}

function assertNotOwnRequest(user, request) {
  if (config.separationOfDuties && request.requested_by === user.id) {
    throw conflict('Separation of duties: you cannot review or approve a request you made yourself.');
  }
}

const canReviewRequests = (user) => has(user, 'request.review');
const canDecideRequests = (user) => has(user, 'request.decide');

/** True while the request waits at the review step (two-step requests only). */
const atReview = (wf, request) => wf.steps >= 2 && request.status === 'PENDING';

export async function reviewRequest(user, id, note) {
  const { request, asset } = await loadForDecision(user, id, canReviewRequests);
  assertOpen(request);
  assertNotOwnRequest(user, request);
  const wf = await getWorkflow(request.request_type);
  if (wf.steps < 2) throw conflict('This kind of request needs a single approval, not a separate review.');
  if (request.status !== 'PENDING') throw conflict('This request has already been reviewed.');
  await db.transaction(async (trx) => {
    await trx('approval_requests').where({ id }).update({ status: 'REVIEWED', reviewed_by: user.id, reviewed_at: db.fn.now(), decision_note: note ?? null });
    await logAudit(trx, user, { action: 'REQUEST_REVIEW', entity: 'request', entityId: id, assetId: asset.id, summary: `${asset.asset_code}: ${request.request_type.toLowerCase()} request reviewed${note ? ` (${note})` : ''}` });
  });
  await notifyAsset(asset, 'request.decide', {
    exceptUserId: user.id, type: 'APPROVAL_PENDING', title: `${asset.asset_code}: request ready for final approval`, body: request.summary, link: '/approvals?tab=requests', dedupeKey: `REQ:${id}:reviewed`,
  });
  return presentRequest(await db('approval_requests').where({ id }).first());
}

export async function approveRequest(user, id, note) {
  const { request, asset } = await loadForDecision(user, id, canDecideRequests);
  assertOpen(request);
  assertNotOwnRequest(user, request);
  const wf = await getWorkflow(request.request_type);
  if (wf.steps >= 2) {
    if (request.status !== 'REVIEWED') throw conflict('This request must be reviewed by the Kebele Administrator first.');
    if (config.separationOfDuties && request.reviewed_by === user.id) throw conflict('Separation of duties: the reviewer cannot also give the final approval.');
  }
  const payload = parsePayload(request);
  let result;
  await db.transaction(async (trx) => {
    result = await EXECUTORS[request.request_type](trx, user, asset, payload, { requestId: id, approvedBy: user.id });
    await trx('approval_requests').where({ id }).update({ status: 'APPROVED', decided_by: user.id, decided_at: db.fn.now(), decision_note: note ?? request.decision_note });
    await logAudit(trx, user, { action: 'REQUEST_APPROVE', entity: 'request', entityId: id, assetId: asset.id, summary: `${asset.asset_code}: ${request.request_type.toLowerCase().replace('_', ' ')} request approved${note ? ` (${note})` : ''}` });
  });
  await AFTER_EXECUTE[request.request_type]?.(user, asset, result);
  await notify({
    type: 'REQUEST_DECIDED', userIds: [request.requested_by], assetId: asset.id, link: `/assets/${asset.id}`,
    title: `Your ${request.request_type.toLowerCase().replace('_', ' ')} request for ${asset.asset_code} was approved`, body: request.summary,
    dedupeKey: `REQ:${id}:decided`,
  });
  return presentRequest(await db('approval_requests').where({ id }).first());
}

export async function rejectRequest(user, id, note) {
  if (!note) throw new HttpError(400, 'Please give a reason.', { comment: 'Please give a reason.' });
  const { request, asset } = await loadForDecision(user, id, (u) => canDecideRequests(u) || canReviewRequests(u));
  assertOpen(request);
  if (!canDecideRequests(user) && !atReview(await getWorkflow(request.request_type), request)) {
    throw conflict('This request has already been reviewed. Only the final approver can reject it now.');
  }
  assertNotOwnRequest(user, request);
  await db.transaction(async (trx) => {
    await trx('approval_requests').where({ id }).update({ status: 'REJECTED', decided_by: user.id, decided_at: db.fn.now(), decision_note: note });
    await logAudit(trx, user, { action: 'REQUEST_REJECT', entity: 'request', entityId: id, assetId: asset.id, summary: `${asset.asset_code}: ${request.request_type.toLowerCase().replace('_', ' ')} request rejected (${note})` });
  });
  await notify({
    type: 'REQUEST_REJECTED', userIds: [request.requested_by], assetId: asset.id, link: `/assets/${asset.id}`,
    title: `Your ${request.request_type.toLowerCase().replace('_', ' ')} request for ${asset.asset_code} was rejected`, body: note,
    dedupeKey: `REQ:${id}:rejected`,
  });
  return presentRequest(await db('approval_requests').where({ id }).first());
}

export async function cancelRequest(user, id) {
  const request = await db('approval_requests').where({ id }).first();
  if (!request) throw notFound('Request not found.');
  const asset = await scopedAsset(user, request.asset_id);
  if (!asset) throw notFound('Request not found.');
  if (request.requested_by !== user.id) throw forbidden('Only the person who made a request can withdraw it.');
  assertOpen(request);
  await db.transaction(async (trx) => {
    await trx('approval_requests').where({ id }).update({ status: 'CANCELLED', decided_at: db.fn.now(), decision_note: 'Withdrawn by the requester' });
    await logAudit(trx, user, { action: 'REQUEST_CANCEL', entity: 'request', entityId: id, assetId: asset.id, summary: `${asset.asset_code}: ${request.request_type.toLowerCase().replace('_', ' ')} request withdrawn` });
  });
  return presentRequest(await db('approval_requests').where({ id }).first());
}

