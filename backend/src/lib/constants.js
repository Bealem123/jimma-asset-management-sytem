export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  EXECUTIVE: 'EXECUTIVE', // Mayor and other executives: read-only, city-wide
  KIFLE_ADMIN: 'KIFLE_ADMIN',
  KEBELE_ADMIN: 'KEBELE_ADMIN',
  SECTOR_ADMIN: 'SECTOR_ADMIN',
  AUDITOR: 'AUDITOR', // read-only, city-wide, plus audit log
  FINANCIAL_OFFICER: 'FINANCIAL_OFFICER',
  INSPECTOR: 'INSPECTOR',
};

export const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Administrator',
  EXECUTIVE: 'Mayor / Executive',
  KIFLE_ADMIN: 'Kifle Ketema Administrator',
  KEBELE_ADMIN: 'Kebele Administrator',
  SECTOR_ADMIN: 'Sector Administrator',
  AUDITOR: 'Internal Auditor',
  FINANCIAL_OFFICER: 'Financial Officer',
  INSPECTOR: 'Inspector',
};

// The eight roles of the City, in display order: the five of the hierarchy, top to bottom, then the three
// specialist roles the Super Administrator creates beside it.
export const SYSTEM_ROLES = [
  ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.KIFLE_ADMIN, ROLES.KEBELE_ADMIN, ROLES.SECTOR_ADMIN,
  ROLES.AUDITOR, ROLES.FINANCIAL_OFFICER, ROLES.INSPECTOR,
];

// Roles that see the whole City regardless of assignments. Everyone else sees only their assigned areas.
export const ALL_SCOPE_ROLES = [ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.AUDITOR];

// ---------------------------------------------------------------------------------------------
// Permissions. The matrix below is the DEFAULT; a Super Administrator can change it per role
// (stored in role_permissions). The Super Administrator role itself always keeps everything.
// ---------------------------------------------------------------------------------------------
export const PERMISSIONS = {
  'asset.create': 'Register assets and submit them for approval',
  'asset.edit': 'Edit asset records, utilization, documents',
  'asset.review': 'Verify that a submitted asset physically exists at the recorded place, or send it back',
  'asset.approve': 'Approve and activate asset registrations, or send them back',
  'request.create': 'Raise transfer, disposal, retirement, assignment and ownership requests',
  'request.review': 'Review those requests first (the first of two steps), or send them back',
  'request.decide': 'Give those requests the final approval, or reject them',
  'maintenance.record': 'Record maintenance',
  'inspection.record': 'Record inspections',
  'inspection.oversee': 'Follow the Inspectors of your area: their accounts, their inspections and overdue inspections',
  'verification.record': 'Record physical verification results',
  'verification.manage': 'Open verification campaigns and approve corrections',
  'reservation.request': 'Request a reservation',
  'reservation.decide': 'Approve or reject reservations',
  'financial.view': 'See acquisition cost, valuation, depreciation and revenue',
  'financial.edit': 'Record valuations and revenue',
  'asset.export': 'Download asset lists (Excel / CSV) and look for duplicate records',
  'analytics.view': 'See analytics and decision support',
  'import.run': 'Bulk import assets',
  'audit.view': 'Read the audit log',
  'master.manage': 'Manage master data (Kifle Ketemas, Kebeles, sectors, categories ...)',
  'user.manage': 'Create and manage the Kifle Ketema Administrator accounts',
  'user.manage_kebele_admins': 'Create and manage the Kebele Administrator accounts of your own Kifle Ketema',
  'user.manage_sector_admins': 'Create and manage the Sector Administrator accounts of your own Kebele',
  'system.manage': 'Workflows, permissions, notification rules, settings, backups, API keys',
};

const ALL_PERMS = Object.keys(PERMISSIONS);
const without = (...drop) => ALL_PERMS.filter((p) => !drop.includes(p));

// The Super Administrator runs the platform and creates the Kifle Ketema Administrators; asset work belongs to the levels below.
const ASSET_WORK = [
  'asset.create', 'asset.edit', 'asset.review', 'asset.approve', 'request.create', 'request.review', 'request.decide', 'maintenance.record', 'inspection.record',
  'verification.record', 'verification.manage', 'reservation.request', 'reservation.decide', 'financial.edit', 'import.run',
];

const OPERATIONAL = [
  'asset.create', 'asset.edit', 'request.create', 'maintenance.record', 'inspection.record', 'verification.record',
  'reservation.request', 'financial.view', 'asset.export',
];

// Each level does its own work only.
//  Sector Administrator: registers, keeps records, requests transfers/maintenance/disposal, records inspections and maintenance.
//  Kebele Administrator: verifies newly registered assets and reviews the requests of its Kebele; runs physical verification.
//  Kifle Ketema Administrator: oversees and approves (registrations, transfers, disposals, verification corrections); records nothing.
const KEBELE_WORK = ['asset.edit', 'request.create', 'verification.record', 'reservation.request', 'financial.view', 'asset.export'];
const KIFLE_WORK = ['financial.view', 'asset.export'];

export const DEFAULT_ROLE_PERMISSIONS = {
  // Runs the platform: accounts, master data, settings and the audit log. It neither sees money (costs, valuations and
  // revenue belong to the Financial Officers) nor analyses performance (the Mayor / Executive and the Internal Auditor do).
  SUPER_ADMIN: without(...ASSET_WORK, 'financial.view', 'analytics.view', 'user.manage_kebele_admins', 'user.manage_sector_admins'),
  // Registration chain: the Sector Administrator registers -> the Kebele Administrator verifies the asset physically
  // -> the Kifle Ketema Administrator approves and activates it.
  // The Sector Administrator owns its assets, so it neither inspects them nor checks in a stock-taking that they are
  // where the register says: the Inspector and the Kebele Administrator do, and the Kifle Ketema Administrator follows
  // the Inspectors of its Kifle Ketema. The Sector Administrator sees the results for its own assets.
  SECTOR_ADMIN: [
    ...OPERATIONAL.filter((p) => !['inspection.record', 'verification.record'].includes(p)), 'reservation.decide', 'analytics.view',
  ],
  KIFLE_ADMIN: [
    ...KIFLE_WORK, 'asset.approve', 'request.decide', 'verification.manage', 'analytics.view',
    'user.manage_kebele_admins', 'inspection.oversee',
  ],
  KEBELE_ADMIN: [
    ...KEBELE_WORK, 'asset.review', 'request.review', 'verification.manage', 'reservation.decide', 'analytics.view',
    'user.manage_sector_admins',
  ],
  // inspects and checks in a stock-taking; booking the City's halls and vehicles is not its work
  INSPECTOR: ['inspection.record', 'verification.record', 'asset.export'],
  FINANCIAL_OFFICER: ['financial.view', 'financial.edit', 'asset.export', 'analytics.view'],
  EXECUTIVE: ['financial.view', 'asset.export', 'analytics.view'],
  AUDITOR: ['financial.view', 'asset.export', 'analytics.view', 'audit.view'],
};

// maintenance (and inspections) count as due this many days ahead: on the dashboards and in the asset list filter
export const DUE_WINDOW_DAYS = 30;
export const CONDITIONS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL'];
export const STATUSES = [
  'PLANNED', 'REGISTERED', 'ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'DAMAGED',
  'LOST', 'TRANSFERRED', 'LEASED', 'RENTED', 'RETIRED', 'DISPOSED',
];
export const APPROVAL_STATES = ['DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'ACTIVE'];
export const OWNERSHIP_TYPES = ['OWNED', 'CONTROLLED', 'ADMINISTERED_ON_BEHALF'];
export const USE_TYPES = [
  'GOVERNMENT_USE', 'PUBLIC_SERVICE', 'RENTAL', 'LEASE', 'PRODUCTION', 'TRANSPORT', 'EQUIPMENT_HIRE', 'IDLE', 'OTHER',
];
export const MAINTENANCE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
export const MAINTENANCE_KINDS = ['ROUTINE', 'PREVENTIVE', 'CORRECTIVE', 'REPAIR', 'OVERHAUL'];
export const DOC_TYPES = [
  'PHOTO', 'OWNERSHIP', 'PURCHASE', 'INVOICE', 'REGISTRATION', 'CONTRACT', 'MAINTENANCE', 'INSPECTION', 'TRANSFER',
  'DISPOSAL', 'VERIFICATION', 'OTHER',
];
export const DOC_RELATED = ['ACQUISITION', 'MAINTENANCE', 'INSPECTION', 'TRANSFER', 'DISPOSAL', 'VERIFICATION'];
export const ACQUISITION_METHODS = ['PURCHASE', 'GOVERNMENT_ALLOCATION', 'DONATION', 'TRANSFER', 'CONSTRUCTION', 'OTHER'];
export const DISPOSAL_METHODS = ['SALE', 'DONATION', 'SCRAP', 'DESTRUCTION', 'TRANSFER_OUT', 'OTHER'];
export const LABEL_REPLACE_REASONS = ['LOST', 'DAMAGED', 'STOLEN', 'OTHER']; // why an asset's printed QR label was replaced
export const REVENUE_TYPES = ['RENT', 'LEASE', 'FEE', 'SALE', 'OTHER'];
export const INSPECTION_RESULTS = ['PASSED', 'FAILED'];
export const REQUEST_TYPES = ['TRANSFER', 'DISPOSAL', 'RETIREMENT', 'ASSIGNMENT', 'OWNERSHIP_CHANGE'];
export const REQUEST_STATUSES = ['PENDING', 'REVIEWED', 'APPROVED', 'REJECTED', 'CANCELLED'];
export const RESERVATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
export const VERIFICATION_RESULTS = ['FOUND', 'MISSING', 'WRONG_LOCATION', 'DUPLICATE'];
export const DISCREPANCY_STATUSES = ['NONE', 'OPEN', 'INVESTIGATING', 'CORRECTED', 'DISMISSED'];

export const NOTIFICATION_TYPES = {
  MAINTENANCE_DUE: { label: 'Maintenance due soon', lead: 14 },
  MAINTENANCE_OVERDUE: { label: 'Maintenance overdue' },
  INSPECTION_DUE: { label: 'Inspection due', lead: 14 },
  DOCUMENT_EXPIRING: { label: 'Document expiring', lead: 30 },
  LEASE_EXPIRING: { label: 'Lease or rental ending', lead: 30 },
  APPROVAL_PENDING: { label: 'Approval waiting for you' },
  REQUEST_REJECTED: { label: 'Request rejected' },
  REQUEST_DECIDED: { label: 'Request approved' },
  CRITICAL_CONDITION: { label: 'Asset in critical condition' },
  ASSET_MISSING: { label: 'Asset missing' },
  VERIFICATION_DISCREPANCY: { label: 'Verification discrepancy' },
  ASSET_TRANSFERRED: { label: 'Asset transferred' },
  DISPOSAL_DECISION: { label: 'Disposal decision' },
  RESERVATION_DECISION: { label: 'Reservation decision' },
  FOLLOW_UP_REPORTED: { label: 'Follow-up reported done, to check' },
  FOLLOW_UP_REOPENED: { label: 'Follow-up sent back' },
  MONTHLY_REPORT_DUE: { label: 'Monthly report due', lead: 3 },
  MONTHLY_REPORT_LATE: { label: 'Monthly report late' },
  MONTHLY_REPORT_SUBMITTED: { label: 'Monthly report received' },
  MONTHLY_REPORT_RETURNED: { label: 'Monthly report returned' },
  MONTHLY_REPORT_ACCEPTED: { label: 'Monthly report accepted' },
};

/**
 * Default approval policy. Super Administrators can change it in System administration.
 * Requests follow the registration chain: the Sector Administrator asks, the Kebele Administrator reviews (step 1),
 * the Kifle Ketema Administrator gives the final approval (step 2).
 */
export const DEFAULT_WORKFLOWS = {
  TRANSFER: { requires_approval: true, steps: 2 },
  DISPOSAL: { requires_approval: true, steps: 2 },
  RETIREMENT: { requires_approval: true, steps: 2 },
  ASSIGNMENT: { requires_approval: false, steps: 1 },
  OWNERSHIP_CHANGE: { requires_approval: true, steps: 2 },
};
