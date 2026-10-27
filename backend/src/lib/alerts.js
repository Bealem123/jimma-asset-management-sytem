import { db } from '../db.js';
import { accessResolver, getRule, notify } from './notify.js';
import { hasAllScope } from './permissions.js';
import { remindMonthlyReports } from './monthlyReports.js';
import { inspectionsDue } from './inspections.js';

const iso = (d) => d.toISOString().slice(0, 10);
const plusDays = (days, from = new Date()) => iso(new Date(from.getTime() + days * 86400000));

/**
 * Look for things that need attention and raise notifications. Safe to run as often as you like:
 * every alert carries a dedupe key, so nobody is told the same thing twice.
 * Returns how many notifications were created, per alert type.
 */
export async function runAlertScan(now = new Date()) {
  const today = iso(now);
  const who = await accessResolver();
  const created = {};
  // `areaOnly`: only the people responsible for the asset's area, not the city-wide roles (who would get every alert in the City)
  const raise = async (type, asset, permission, message, { areaOnly = false } = {}) => {
    const users = who(asset, permission).filter((u) => !areaOnly || !hasAllScope(u));
    const n = await notify({ type, userIds: users.map((u) => u.id), assetId: asset.id, link: `/assets/${asset.id}`, ...message });
    created[type] = (created[type] || 0) + n;
  };

  const live = (q) => q.whereNot('assets.status', 'DISPOSED').whereNull('assets.archived_at');
  const assetCols = ['assets.id', 'assets.asset_code', 'assets.name', 'assets.kifle_ketema_id', 'assets.kebele_id', 'assets.sector_id'];

  // maintenance: latest record per asset that names a next date
  const maintRule = await getRule('MAINTENANCE_DUE');
  const overdueRule = await getRule('MAINTENANCE_OVERDUE');
  if (maintRule.enabled || overdueRule.enabled) {
    const rows = await live(db('maintenance_records as m').join('assets', 'assets.id', 'm.asset_id'))
      .whereNotNull('m.next_maintenance_date').whereNot('m.status', 'CANCELLED')
      .select('m.id as record_id', 'm.asset_id', 'm.maintenance_date', 'm.maintenance_type', 'm.next_maintenance_date', ...assetCols);
    const latest = new Map();
    for (const r of rows) {
      const cur = latest.get(r.asset_id);
      if (!cur || r.maintenance_date > cur.maintenance_date || (r.maintenance_date === cur.maintenance_date && r.record_id > cur.record_id)) latest.set(r.asset_id, r);
    }
    const horizon = plusDays(maintRule.lead_days ?? 14, now);
    for (const r of latest.values()) {
      if (r.next_maintenance_date < today) {
        await raise('MAINTENANCE_OVERDUE', r, 'maintenance.record', {
          title: `${r.asset_code}: maintenance overdue since ${r.next_maintenance_date}`, body: r.name, dedupeKey: `MAINT:${r.record_id}:${r.next_maintenance_date}:OVERDUE`,
        });
      } else if (r.next_maintenance_date <= horizon) {
        await raise('MAINTENANCE_DUE', r, 'maintenance.record', {
          title: `${r.asset_code}: maintenance due ${r.next_maintenance_date}`, body: r.name, dedupeKey: `MAINT:${r.record_id}:${r.next_maintenance_date}:DUE`,
        });
      }
    }
  }

  // inspections: the next date of the latest inspection, or the first inspection of an asset in use never inspected
  const inspRule = await getRule('INSPECTION_DUE');
  if (inspRule.enabled) {
    const horizon = plusDays(inspRule.lead_days ?? 14, now);
    for (const r of await inspectionsDue((q) => q, assetCols)) {
      if (r.due <= horizon) {
        const key = `INSP:${r.record_id ?? `FIRST-${r.asset_id}`}:${r.due}`;
        await raise('INSPECTION_DUE', r, 'inspection.record', {
          title: `${r.asset_code}: inspection ${r.due < today ? 'overdue since' : 'due'} ${r.due}`, body: r.name, dedupeKey: key,
        });
        // an overdue inspection is also reported to whoever follows the Inspectors of that area (the Kifle Ketema Administrator)
        if (r.due < today) {
          await raise('INSPECTION_DUE', r, 'inspection.oversee', {
            title: `${r.asset_code}: inspection overdue since ${r.due}`, body: r.name, dedupeKey: `${key}:OVERDUE`,
          }, { areaOnly: true });
        }
      }
    }
  }

  // documents that expire (licences, insurance, contracts ...)
  const docRule = await getRule('DOCUMENT_EXPIRING');
  if (docRule.enabled) {
    const rows = await live(db('asset_documents as d').join('assets', 'assets.id', 'd.asset_id'))
      .whereNotNull('d.expires_on').where('d.expires_on', '<=', plusDays(docRule.lead_days ?? 30, now))
      .select('d.id as doc_id', 'd.title', 'd.expires_on', ...assetCols);
    for (const r of rows) {
      await raise('DOCUMENT_EXPIRING', r, 'asset.edit', {
        title: `${r.asset_code}: "${r.title}" ${r.expires_on < today ? 'expired' : 'expires'} ${r.expires_on}`, body: r.name, dedupeKey: `DOC:${r.doc_id}:${r.expires_on}`,
      });
    }
  }

  // leases and rentals that are about to end
  const leaseRule = await getRule('LEASE_EXPIRING');
  if (leaseRule.enabled) {
    const rows = await live(db('utilizations as u').join('assets', 'assets.id', 'u.asset_id'))
      .whereIn('u.use_type', ['LEASE', 'RENTAL']).whereNotNull('u.end_date')
      .where('u.end_date', '>=', today).where('u.end_date', '<=', plusDays(leaseRule.lead_days ?? 30, now))
      .select('u.id as use_id', 'u.use_type', 'u.user_party', 'u.end_date', ...assetCols);
    for (const r of rows) {
      await raise('LEASE_EXPIRING', r, 'asset.edit', {
        title: `${r.asset_code}: ${r.use_type.toLowerCase()} to ${r.user_party || 'tenant'} ends ${r.end_date}`, body: r.name, dedupeKey: `LEASE:${r.use_id}:${r.end_date}`,
      });
    }
  }

  // monthly reports that are due soon or late
  for (const [type, n] of Object.entries(await remindMonthlyReports(now))) created[type] = (created[type] || 0) + n;
  return created;
}
