import { config } from '../config.js';
import { canApprove, canEdit, canReview } from './permissions.js';

// DRAFT -> SUBMITTED -> REVIEWED -> APPROVED -> ACTIVE   (reject sends it back to DRAFT)
// Sector Administrator submits; Kebele Administrator reviews (physical verification);
// Kifle Ketema Administrator approves and activates.
export const TRANSITIONS = {
  submit: { from: ['DRAFT'], to: 'SUBMITTED', who: canEdit },
  review: { from: ['SUBMITTED'], to: 'REVIEWED', who: canReview },
  approve: { from: ['REVIEWED'], to: 'APPROVED', who: canApprove },
  activate: { from: ['APPROVED'], to: 'ACTIVE', who: canApprove },
  reject: { from: ['SUBMITTED', 'REVIEWED', 'APPROVED'], to: 'DRAFT', who: (u) => canReview(u) || canApprove(u), needsComment: true },
};

/**
 * Returns null if the user may perform `action` on `asset`, otherwise a message.
 * Separation of duties: whoever submitted an asset cannot review, approve or activate it,
 * and the approver must be a different person from the reviewer.
 */
export function checkTransition(user, asset, action) {
  const t = TRANSITIONS[action];
  if (!t) return 'Unknown workflow action.';
  if (asset.status === 'DISPOSED') return 'A disposed asset cannot change approval state.';
  if (!t.who(user)) return 'Your role is not allowed to perform this step.';
  if (!t.from.includes(asset.approval_state)) {
    return `Cannot ${action} an asset that is ${asset.approval_state}.`;
  }
  if (config.separationOfDuties && ['review', 'approve', 'activate'].includes(action)) {
    if (asset.submitted_by === user.id) return 'Separation of duties: the person who submitted an asset cannot review or approve it.';
    if (action === 'approve' && asset.reviewed_by === user.id) return 'Separation of duties: the reviewer cannot also approve it.';
  }
  return null;
}
