import { t } from './i18n.jsx';

const CITYWIDE = ['SUPER_ADMIN', 'EXECUTIVE', 'AUDITOR'];

/**
 * The area an account is assigned to, in words: "Rent · Ginjo" for a Sector Administrator (sector, then Kebele),
 * "Ginjo" for a Kebele Administrator, "Jiren" for a Kifle Ketema Administrator, and the Kifle Ketemas of an Inspector
 * or Financial Officer. Empty for the city-wide roles, and while the master lists are still loading.
 * `user` needs `role` and either `scope` ({ kifle, kebeles, sectors }) or the *_ids lists of the Users page.
 */
/**
 * The Kifle Ketemas and Kebeles (lists of master rows) a user may choose as an area, with the server's rules
 * (allowedAreas): a Kebele or Sector Administrator its own Kebele(s) and their Kifle Ketema, a Kifle Ketema
 * Administrator its Kifle Ketema(s) and all their Kebeles, other roles both; the city-wide roles everything.
 * Only Kebeles linked to a Kifle Ketema are offered: an unlinked one holds no assets.
 */
export function choosableAreas(user, lk) {
  const linked = lk.kebeles.filter((k) => k.kifle_ketema_id);
  if (!user || CITYWIDE.includes(user.role)) return { kifle: lk.kifle, kebeles: linked };
  const { kifle = [], kebeles = [] } = user.scope || {};
  let kebeleIds;
  let kifleIds;
  if (['KEBELE_ADMIN', 'SECTOR_ADMIN'].includes(user.role)) {
    kebeleIds = kebeles;
    kifleIds = linked.filter((k) => kebeles.includes(k.id)).map((k) => k.kifle_ketema_id);
  } else if (user.role === 'KIFLE_ADMIN') {
    kifleIds = kifle;
    kebeleIds = linked.filter((k) => kifle.includes(k.kifle_ketema_id)).map((k) => k.id);
  } else {
    kifleIds = [...kifle, ...linked.filter((k) => kebeles.includes(k.id)).map((k) => k.kifle_ketema_id)];
    kebeleIds = [...kebeles, ...linked.filter((k) => kifle.includes(k.kifle_ketema_id)).map((k) => k.id)];
  }
  return { kifle: lk.kifle.filter((k) => kifleIds.includes(k.id)), kebeles: linked.filter((k) => kebeleIds.includes(k.id)) };
}

export function areaOf(user, lk) {
  if (!user || CITYWIDE.includes(user.role) || !lk?.ready) return '';
  const ids = {
    kifle: user.scope?.kifle ?? user.kifle_ketema_ids ?? [],
    kebeles: user.scope?.kebeles ?? user.kebele_ids ?? [],
    sectors: user.scope?.sectors ?? user.sector_ids ?? [],
  };
  const names = (list, chosen) => {
    const found = list.filter((x) => chosen.map(Number).includes(x.id)).map((x) => t(x.name));
    return found.length > 3 ? `${found.slice(0, 3).join(', ')} +${found.length - 3}` : found.join(', ');
  };
  const parts = [names(lk.sectors, ids.sectors), names(lk.kebeles, ids.kebeles), names(lk.kifle, ids.kifle)].filter(Boolean);
  return parts.join(' · ');
}
