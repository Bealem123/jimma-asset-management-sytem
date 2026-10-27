// Mirrors the server's permissions only to decide what to SHOW. The server enforces everything.
// The list of permissions comes from the server with the signed-in user (user.permissions), so a
// Super Administrator's changes to a role take effect on the next sign-in or page reload.
const ALL = ['SUPER_ADMIN', 'EXECUTIVE', 'AUDITOR'];
export const has = (u, permission) => Boolean(u?.permissions?.includes(permission));

// Each level creates and manages only the level directly below it (mirrors the server).
const ACCOUNT_LEVELS = {
  SUPER_ADMIN: ['KIFLE_ADMIN', 'user.manage'],
  KIFLE_ADMIN: ['KEBELE_ADMIN', 'user.manage_kebele_admins'],
  KEBELE_ADMIN: ['SECTOR_ADMIN', 'user.manage_sector_admins'],
};
export const managedAccountRole = (u) => {
  const level = ACCOUNT_LEVELS[u?.role];
  return level && has(u, level[1]) ? level[0] : null;
};
// The Super Administrator also creates the roles outside the hierarchy: Mayor / Executive, Internal Auditor,
// Financial Officer and Inspector.
export const OUTSIDE_HIERARCHY = ['EXECUTIVE', 'AUDITOR', 'FINANCIAL_OFFICER', 'INSPECTOR'];
export const managedAccountRoles = (u) => {
  const main = managedAccountRole(u);
  if (!main) return [];
  return u.role === 'SUPER_ADMIN' ? [main, ...OUTSIDE_HIERARCHY] : [main];
};

export const can = {
  edit: (u) => has(u, 'asset.edit'),
  create: (u) => has(u, 'asset.create'),
  review: (u) => has(u, 'asset.review'),
  approve: (u) => has(u, 'asset.approve'),
  reviewRequests: (u) => has(u, 'request.review'), // step 1 of a two-step request: the Kebele Administrator
  decide: (u) => has(u, 'request.decide'), // the final approval: the Kifle Ketema Administrator
  request: (u) => has(u, 'request.create'),
  openApprovals: (u) => ['asset.review', 'asset.approve', 'request.review', 'request.decide', 'request.create'].some((p) => has(u, p)),
  maintain: (u) => has(u, 'maintenance.record'),
  inspect: (u) => has(u, 'inspection.record'),
  overseeInspectors: (u) => has(u, 'inspection.oversee'),
  // the chain of monthly reports (mirrors REPORTS_TO on the server): those who send one, those who receive them, and the Super Administrator
  monthly: (u) => ['SECTOR_ADMIN', 'KEBELE_ADMIN', 'FINANCIAL_OFFICER', 'INSPECTOR', 'KIFLE_ADMIN', 'AUDITOR', 'EXECUTIVE', 'SUPER_ADMIN'].includes(u?.role),
  verify: (u) => has(u, 'verification.record') || has(u, 'verification.manage'),
  // the keepers of assets (the Sector Administrator) follow the stock-taking results of their own assets, and the
  // Internal Auditor those of the whole city, read-only
  viewVerification: (u) => has(u, 'verification.record') || has(u, 'verification.manage') || has(u, 'asset.edit') || u?.role === 'AUDITOR',
  manageVerification: (u) => has(u, 'verification.manage'),
  reserve: (u) => has(u, 'reservation.request'),
  decideReservation: (u) => has(u, 'reservation.decide'),
  financial: (u) => has(u, 'financial.view'),
  editFinancial: (u) => has(u, 'financial.edit'),
  exportAssets: (u) => has(u, 'asset.export'),
  analytics: (u) => has(u, 'analytics.view'),
  importAssets: (u) => has(u, 'import.run'),
  viewAudit: (u) => has(u, 'audit.view'),
  manageMaster: (u) => has(u, 'master.manage'),
  managedAccountRole,
  managedAccountRoles,
  openUsers: (u) => Boolean(managedAccountRole(u)),
  // the Internal Auditor sees every account and its history, read-only
  viewUsers: (u) => Boolean(managedAccountRole(u)) || u?.role === 'AUDITOR',
  manageSystem: (u) => has(u, 'system.manage'),
  citywide: (u) => ALL.includes(u?.role),
};
