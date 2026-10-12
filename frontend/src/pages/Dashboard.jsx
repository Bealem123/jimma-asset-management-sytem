import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { compactEtb, date, etb, label, num } from '../format.js';
import { can } from '../permissions.js';
import { Alert, Loading, PageHeader, useAsync } from '../components/ui.jsx';
import { Bars, Tile } from '../components/charts.jsx';
import { t } from '../i18n.jsx';
import ActivityCard from '../components/Activity.jsx';
import {
  ConditionCard, ExecutiveDashboard, KebeleDashboard, KifleDashboard, PipelineCard, RegistrationTrend, SectorDashboard, SuperDashboard, growth,
} from './dashboards.jsx';

// Each level of the hierarchy, and the Mayor, has its own dashboard; every other role gets the general overview below.
const DASHBOARDS = {
  EXECUTIVE: ExecutiveDashboard, SUPER_ADMIN: SuperDashboard, KIFLE_ADMIN: KifleDashboard, KEBELE_ADMIN: KebeleDashboard, SECTOR_ADMIN: SectorDashboard,
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: d, error, loading } = useAsync(() => api.get('/dashboard'), []);
  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const ForRole = DASHBOARDS[user.role];
  if (ForRole) return <ForRole d={d} />;
  const tot = d.totals;
  const status = (key) => d.by_status.find((s) => s.key === key)?.n ?? 0;
  const condition = (key) => d.by_condition.find((s) => s.key === key)?.n ?? 0;

  return (
    <>
      <PageHeader
        title="City asset overview"
        subtitle={can.citywide(user) ? 'All assets owned or controlled by Jimma City.' : 'Assets in your assigned area.'}
      />
      {tot.assets === 0 && (can.create(user)
        ? <Alert kind="info">{t('No assets are registered in your area yet. Use')}{' '}<strong>{t('Assets → Register asset')}</strong>{' '}{t('to add the first one.')}</Alert>
        : <Alert kind="info">{t('No assets are registered in your area yet.')}</Alert>)}

      <div className="grid grid-tiles" role="list" aria-label={t('Key figures')}>
        <Tile feature icon="assets" spark={growth(d)} value={num(tot.assets)} caption="Total assets" note={t('{n} approved and active', { n: num(tot.active) })} to="/assets" />
        <Tile icon="approvals" value={num(status('ACTIVE'))} caption="Active" note={t('{n} inactive', { n: num(status('INACTIVE')) })} to="/assets?status=ACTIVE" />
        <Tile icon="wrench" value={num(status('UNDER_MAINTENANCE'))} caption="Under maintenance" note={t('{n} open jobs', { n: num(tot.open_maintenance_jobs) })} to="/assets?status=UNDER_MAINTENANCE" />
        <Tile icon="alert" value={num(status('DAMAGED'))} caption="Damaged" to="/assets?status=DAMAGED" tone={status('DAMAGED') ? 'warn' : undefined} />
        <Tile icon="alert" value={num(condition('CRITICAL'))} caption="Critical condition" note="Inspect, repair or retire" to="/assets?condition=CRITICAL" tone={condition('CRITICAL') ? 'bad' : undefined} />
        <Tile icon="search" value={num(status('LOST'))} caption="Lost" to="/assets?status=LOST" tone={status('LOST') ? 'bad' : undefined} />
        <Tile icon="import" value={num(status('TRANSFERRED'))} caption="Transferred" to="/assets?status=TRANSFERRED" />
        <Tile icon="logout" value={num(status('DISPOSED'))} caption="Disposed" note={t('{n} retired', { n: num(status('RETIRED')) })} to="/assets?status=DISPOSED&include_archived=true" />
        <Tile icon="audit" value={num(tot.pending_requests + tot.pending_approval)} caption="Pending approvals" note={t('{a} registrations · {b} requests', { a: num(tot.pending_approval), b: num(tot.pending_requests) })} to="/approvals" tone={tot.pending_requests + tot.pending_approval ? 'warn' : undefined} />
        <Tile icon="verification" value={num(tot.open_discrepancies)} caption="Verification discrepancies" note="Found elsewhere, missing or duplicated" to="/verification" tone={tot.open_discrepancies ? 'bad' : undefined} />
        <Tile icon="wrench" value={num(tot.maintenance_overdue)} caption="Maintenance overdue" note={t('{n} due in {d} days', { n: num(tot.maintenance_due_soon), d: d.maintenance_due_window_days })} tone={tot.maintenance_overdue ? 'bad' : undefined} />
        <Tile icon="performance" value={num(tot.generating_revenue)} caption="Generating revenue now" note={t('{n} generate none (public service, own use, idle)', { n: num(tot.not_generating_revenue) })} to="/assets?revenue=yes" />
      </div>

      {d.can_see_money && (
        <div className="grid grid-tiles" style={{ marginTop: 16 }} role="list" aria-label={t('Financial summary')}>
          <Tile icon="coin" value={compactEtb(tot.acquisition_cost)} caption="Acquisition cost" note="All assets in your area" />
          <Tile icon="coin" hue={1} value={compactEtb(tot.current_valuation)} caption="Current valuation" />
          <Tile icon="wrench" value={compactEtb(tot.maintenance_cost)} caption="Maintenance spending" note="All recorded, excluding cancelled" />
          <Tile icon="performance" value={compactEtb(tot.revenue_received)} caption="Revenue recorded on assets" note="Rent, lease and other income" />
        </div>
      )}

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <RegistrationTrend d={d} className="span-2" />
        <ConditionCard d={d} />
        <PipelineCard d={d} />
        <section className="card">
          <h2>{t('Assets by sector')}</h2>
          <Bars hue={3} rows={d.by_sector} to={(r) => `/assets?sector_id=${r.id}`} />
        </section>
        <section className="card">
          <h2>{t('Assets by Kifle Ketema')}</h2>
          <Bars hue={7} rows={d.by_kifle_ketema} to={(r) => `/assets?kifle_ketema_id=${r.id}`} />
        </section>
        <section className="card">
          <h2>{t('Assets by Kebele')}</h2>
          <Bars hue={5} rows={d.by_kebele} to={(r) => (r.id ? `/assets?kebele_id=${r.id}` : null)} />
        </section>
        <section className="card">
          <h2>{t('Assets by category')}</h2>
          <Bars hue={4} rows={d.by_category} to={(r) => `/assets?category_id=${r.id}`} />
        </section>
        <section className="card">
          <h2>{t('Assets by status')}</h2>
          <Bars hue={6} rows={d.by_status.filter((s) => s.n > 0)} nameOf={(r) => label(r.key)} to={(r) => `/assets?status=${r.key}`} />
        </section>
        <section className="card">
          <h2>{t('Maintenance due in {n} days', { n: d.maintenance_due_window_days })}</h2>
          {d.maintenance_due.length === 0 ? <p className="muted">{t('Nothing due or overdue.')}</p> : (
            <ul className="plain-list">
              {d.maintenance_due.map((m) => (
                <li key={m.asset_id}>
                  <Link to={`/assets/${m.asset_id}`}>{m.asset_code} · {m.name}</Link>
                  <span className={m.overdue ? 'badge badge-bad' : 'badge badge-warn'}>{m.overdue ? t('Overdue') : t('Due')} {date(m.next_maintenance_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>{t('Waiting for you')}</h2>
          <ul className="plain-list">
            {can.review(user) || can.approve(user) || can.decide(user) ? <li><Link to="/approvals">{t('Approvals')}</Link><span className="badge badge-neutral">{num(tot.pending_approval + tot.pending_requests)}</span></li> : null}
            {can.decideReservation(user) ? <li><Link to="/reservations">{t('Reservations to decide')}</Link><span className="badge badge-neutral">{num(tot.pending_reservations)}</span></li> : null}
            {can.verify(user) ? <li><Link to="/verification">{t('Verification discrepancies')}</Link><span className="badge badge-neutral">{num(tot.open_discrepancies)}</span></li> : null}
            <li><Link to="/follow-ups">{t('Open follow-up actions')}</Link><span className="badge badge-neutral">{num(tot.open_follow_ups)}</span></li>
          </ul>
        </section>
      </div>

      <ActivityCard items={d.recent_activity} title={can.citywide(user) ? 'What happened to assets across the city' : 'What happened to assets in your area'} />
      {d.can_see_money && <p className="muted small">{t('Total acquisition cost {amount}.', { amount: etb(tot.acquisition_cost) })}</p>}
    </>
  );
}
