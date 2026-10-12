import { t } from './i18n.jsx';

const CITYWIDE = ['SUPER_ADMIN', 'EXECUTIVE', 'AUDITOR'];

/**
 * The area an account is assigned to, in words: "Rent · Ginjo" for a Sector Administrator (sector, then Kebele),
 * "Ginjo" for a Kebele Administrator, "Jiren" for a Kifle Ketema Administrator, and the Kifle Ketemas of an Inspector
 * or Financial Officer. Empty for the city-wide roles, and while the master lists are still loading.
 * `user` needs `role` and either `scope` ({ kifle, kebeles, sectors }) or the *_ids lists of the Users page.
 */
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
