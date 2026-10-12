import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { compactEtb, date, dateTime, label, num } from '../format.js';
import {
  Alert, Badge, Loading, PageHeader, Table, useAsync,
} from '../components/ui.jsx';
import { can } from '../permissions.js';
import {
  Bars, Columns, Donut, Ring, StackBar, Tile, monthLabel,
} from '../components/charts.jsx';
import { t } from '../i18n.jsx';
import { AreaTable, WaitNote } from './Performance.jsx';
import ActivityCard from '../components/Activity.jsx';

// One dashboard per level of responsibility. All read the same /dashboard data, which the server already limits
// to the person's own area; each shows only what that level needs to see and the actions that belong to it.
//   Mayor / Executive    -> the city at a glance     (read-only: position, risks, performance of each area)
//   Super Administrator  -> city-wide control        Kifle Ketema Administrator -> oversight and approval
//   Kebele Administrator -> physical verification    Sector Administrator       -> registration and sector management

const status = (d, key) => d.by_status.find((s) => s.key === key)?.n ?? 0;
const condition = (d, key) => d.by_condition.find((s) => s.key === key)?.n ?? 0;
const approval = (d, key) => d.by_approval_state.find((s) => s.key === key)?.n ?? 0;

/** Every item of a master list, with the count it has in the data (zero when none), so empty areas still show. */
const withZeros = (list, rows) => list.map((x) => ({ id: x.id, name: x.name, n: rows.find((r) => r.id === x.id)?.n ?? 0 }));

/** How many assets there were at the end of each of the last 12 months (for the headline sparkline). */
export const growth = (d) => {
  let n = d.totals.assets - (d.trend || []).reduce((s, m) => s + m.registered, 0);
  return (d.trend || []).map((m) => { n += m.registered; return n; });
};

// ---------------------------------------------------------------------------------------------- shared cards

function Shortcuts({ title = 'Go to', items }) {
  return (
    <section className="card">
      <h2>{t(title)}</h2>
      <ul className="plain-list">
        {items.filter(Boolean).map(([to, text, badge, tone]) => (
          <li key={to + text}>
            <Link to={to}>{t(text)}</Link>
            {badge !== undefined && <span className={`badge ${tone ? `badge-${tone}` : 'badge-neutral'}`}>{num(badge)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Money({ d, items }) {
  if (!d.can_see_money) return null;
  return (
    <div className="grid grid-tiles" style={{ marginTop: 16 }} role="list" aria-label={t('Financial summary')}>
      {items.map(([value, caption, note, icon = 'coin']) => <Tile key={caption} icon={icon} hue={caption === 'Current valuation' ? 1 : undefined} value={compactEtb(value)} caption={caption} note={note} />)}
    </div>
  );
}

/** What happened to the assets of this area: outcomes in plain words (the audit log keeps everything else). */
function Recent({ d, title = 'What happened to assets in your area' }) {
  return <ActivityCard items={d.recent_activity} title={title} />;
}

function MaintenanceDue({ d }) {
  return (
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
  );
}

const CONDITION_COLOURS = {
  EXCELLENT: 'var(--cond-excellent)', GOOD: 'var(--cond-good)', FAIR: 'var(--cond-fair)', POOR: 'var(--cond-poor)', CRITICAL: 'var(--cond-critical)',
};

/** Condition of the assets: a donut from excellent (teal) through fair (grey) to critical (red). */
export function ConditionCard({ d, title = 'Condition of the assets' }) {
  return (
    <section className="card">
      <div className="card-head"><h2>{t(title)}</h2></div>
      <Donut
        caption="Assets"
        rows={d.by_condition.map((c) => ({ key: c.key, label: label(c.key), value: c.n, color: CONDITION_COLOURS[c.key] }))}
        to={(r) => `/assets?condition=${r.key}`}
      />
    </section>
  );
}

const PIPELINE = [
  ['DRAFT', 'Draft or sent back', 'var(--pipe-1)'],
  ['SUBMITTED', 'With the Kebele, to verify', 'var(--pipe-2)'],
  ['REVIEWED', 'With the Kifle Ketema, to approve', 'var(--pipe-3)'],
  ['APPROVED', 'Approved, not yet active', 'var(--pipe-4)'],
  ['ACTIVE', 'Active', 'var(--pipe-5)'],
];

/** Where every registration stands in the approval chain, as one stacked bar. */
export function PipelineCard({ d, title = 'Registration pipeline', note = 'Every asset, by where it stands in the approval chain.' }) {
  return (
    <section className="card">
      <div className="card-head"><h2>{t(title)}</h2><p className="muted small">{t(note)}</p></div>
      <StackBar
        rows={PIPELINE.map(([key, text, color]) => ({ key, label: text, value: approval(d, key), color }))}
        to={(r) => `/assets?approval_state=${r.key}`}
      />
    </section>
  );
}

/** Assets registered per month over the last year. */
export function RegistrationTrend({ d, className }) {
  if (!d.trend) return null; // an older server without the monthly trend
  const total = d.trend.reduce((s, m) => s + m.registered, 0);
  return (
    <section className={`card ${className || ''}`}>
      <div className="card-head"><h2>{t('Assets registered')}</h2><p className="muted small">{t('{n} in the last 12 months', { n: num(total) })}</p></div>
      <Columns hue={1} kind="area" title="Assets registered per month" rows={d.trend} labelOf={(r) => monthLabel(r.month)} getValue={(r) => r.registered} />
    </section>
  );
}

/** Maintenance jobs per month over the last year (with the spending, for those who may see money). */
function MaintenanceTrend({ d, className }) {
  if (!d.trend) return null;
  const jobs = d.trend.reduce((s, m) => s + m.maintenance_jobs, 0);
  const cost = d.can_see_money ? d.trend.reduce((s, m) => s + (m.maintenance_cost || 0), 0) : null;
  return (
    <section className={`card ${className || ''}`}>
      <div className="card-head">
        <h2>{t('Maintenance jobs')}</h2>
        <p className="muted small">{cost != null ? t('{n} jobs · {v} in the last 12 months', { n: num(jobs), v: compactEtb(cost) }) : t('{n} jobs in the last 12 months', { n: num(jobs) })}</p>
      </div>
      <Columns hue={2} title="Maintenance jobs per month" rows={d.trend} labelOf={(r) => monthLabel(r.month)} getValue={(r) => r.maintenance_jobs} />
    </section>
  );
}

/** Three health ratios of the register as ring meters. `idle` is known only where performance data was loaded. */
function HealthRings({ d, idle }) {
  const tot = d.totals;
  const good = condition(d, 'EXCELLENT') + condition(d, 'GOOD');
  const toneOf = (part, whole) => { const p = whole ? part / whole : 1; return p < 0.5 ? 'bad' : p < 0.75 ? 'warn' : 'accent'; };
  return (
    <section className="card">
      <div className="card-head"><h2>{t('Health of the register')}</h2></div>
      <div className="rings">
        <Ring hue={1} value={tot.active} total={tot.assets} caption="Approved and active" note={t('{a} of {b}', { a: num(tot.active), b: num(tot.assets) })} tone={toneOf(tot.active, tot.assets)} />
        <Ring hue={6} value={good} total={tot.assets} caption="Good or excellent" note={t('{a} of {b}', { a: num(good), b: num(tot.assets) })} tone={toneOf(good, tot.assets)} />
        {idle != null
          ? <Ring hue={7} value={Math.max(0, tot.active - idle)} total={tot.active} caption="In use" note={t('{n} idle', { n: num(idle) })} tone={toneOf(tot.active - idle, tot.active)} />
          : <Ring hue={7} value={tot.generating_revenue} total={tot.assets} caption="Earning revenue" note={t('{a} of {b}', { a: num(tot.generating_revenue), b: num(tot.assets) })} />}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- Super Administrator

export function SuperDashboard({ d }) {
  const tot = d.totals;
  const waiting = tot.pending_approval + tot.pending_requests;
  const transfers = tot.pending_by_type.TRANSFER || 0;
  const disposals = (tot.pending_by_type.DISPOSAL || 0) + (tot.pending_by_type.RETIREMENT || 0);
  return (
    <>
      <PageHeader title="City-wide control" subtitle="The whole of Jimma City: every Kifle Ketema, Kebele and sector. You oversee, you do not register or change assets." />
      {d.setup?.kifle_ketemas_without_admin > 0 && (
        <Alert kind="info">{t('{n} Kifle Ketema has no administrator yet.', { n: num(d.setup.kifle_ketemas_without_admin) })} <Link to="/users">{t('Create the Kifle Ketema Administrators')}</Link></Alert>
      )}
      {d.setup?.kebeles_without_kifle_ketema > 0 && (
        <Alert kind="info">{t('{n} Kebeles are not linked to a Kifle Ketema yet; no asset can be registered in them.', { n: num(d.setup.kebeles_without_kifle_ketema) })} <Link to="/master">{t('Link them in Master data')}</Link></Alert>
      )}
      {d.setup?.kifle_ketemas_without_inspector > 0 && (
        <Alert kind="info">{t('{n} Kifle Ketema(s) have no Inspector; nobody can record inspections there.', { n: num(d.setup.kifle_ketemas_without_inspector) })} <Link to="/users">{t('Create the Inspectors')}</Link></Alert>
      )}

      <div className="grid grid-tiles" role="list" aria-label={t('Key figures')}>
        <Tile feature icon="assets" spark={growth(d)} value={num(tot.assets)} caption="Total assets" note={t('{n} approved and active', { n: num(tot.active) })} to="/assets" />
        <Tile icon="approvals" value={num(status(d, 'ACTIVE'))} caption="Active" note={t('{n} inactive', { n: num(status(d, 'INACTIVE')) })} to="/assets?status=ACTIVE" />
        <Tile icon="wrench" value={num(status(d, 'UNDER_MAINTENANCE'))} caption="Under maintenance" to="/assets?status=UNDER_MAINTENANCE" />
        <Tile icon="alert" value={num(status(d, 'DAMAGED'))} caption="Damaged" to="/assets?status=DAMAGED" tone={status(d, 'DAMAGED') ? 'warn' : undefined} />
        <Tile icon="search" value={num(status(d, 'LOST'))} caption="Missing / lost" to="/assets?status=LOST" tone={status(d, 'LOST') ? 'bad' : undefined} />
        <Tile icon="audit" value={num(waiting)} caption="Pending approvals" note={t('{a} registrations · {b} requests', { a: num(tot.pending_approval), b: num(tot.pending_requests) })} tone={waiting ? 'warn' : undefined} />
        <Tile icon="import" value={num(transfers)} caption="Pending transfers" />
        <Tile icon="logout" value={num(disposals)} caption="Pending disposals" note="Disposal and retirement requests" />
      </div>
      <Money d={d} items={[[tot.acquisition_cost, 'Acquisition cost', 'All assets in the city'], [tot.current_valuation, 'Current valuation'], [tot.maintenance_cost, 'Maintenance spending', undefined, 'wrench'], [tot.revenue_received, 'Revenue recorded on assets', undefined, 'performance']]} />

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <RegistrationTrend d={d} className="span-2" />
        <ConditionCard d={d} />
        <PipelineCard d={d} />
        <section className="card"><h2>{t('Assets by Kifle Ketema')}</h2><Bars hue={7} rows={d.by_kifle_ketema} to={(r) => `/assets?kifle_ketema_id=${r.id}`} /></section>
        <section className="card"><h2>{t('Assets by sector')}</h2><Bars hue={3} rows={d.by_sector} to={(r) => `/assets?sector_id=${r.id}`} /></section>
        <section className="card"><h2>{t('Assets by Kebele')}</h2><Bars hue={5} rows={d.by_kebele} to={(r) => (r.id ? `/assets?kebele_id=${r.id}` : null)} /></section>
        <MaintenanceTrend d={d} />
        <Shortcuts title="Governance" items={[
          ['/users', 'Kifle Ketema Administrators'],
          ['/master', 'Kifle Ketemas, Kebeles and sectors'],
          ['/map', 'City-wide map'],
          ['/audit', 'Audit log'],
          ['/system', 'System settings, backups and security'],
        ]} />
      </div>
      <Recent d={d} title="What happened to assets across the city" />
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Mayor / Executive

export function ExecutiveDashboard({ d }) {
  const perf = useAsync(() => api.get('/dashboard/performance'), []);
  const tot = d.totals;
  const areas = perf.data?.kifle_ketemas || [];
  const idle = perf.data ? areas.reduce((s, k) => s + k.idle, 0) : null;
  const waits = areas.map((k) => k.oldest_wait_days).filter((x) => x != null);
  const oldest = waits.length ? Math.max(...waits) : null;
  const waiting = tot.pending_approval + tot.pending_requests;
  const disposals = (tot.pending_by_type.DISPOSAL || 0) + (tot.pending_by_type.RETIREMENT || 0);
  return (
    <>
      <PageHeader title="Jimma City at a glance" subtitle="For leadership: where the city's assets stand, where they are wasted or at risk, and which area is falling behind. You see everything; you change nothing." />

      <h2>{t("The city's position")}</h2>
      <div className="grid grid-tiles grid-tiles-5" role="list" aria-label={t("The city's position")}>
        <Tile feature spark={growth(d)} value={num(tot.assets)} caption="Total assets" note={t('{n} approved and active', { n: num(tot.active) })} to="/assets" />
        {d.can_see_money && <Tile icon="coin" hue={1} value={compactEtb(tot.current_valuation)} caption="Current valuation" note={t('Bought for {v}', { v: compactEtb(tot.acquisition_cost) })} />}
        <Tile icon="pause" value={idle != null ? num(idle) : '…'} caption="Idle assets" note="Active but not in use: reassign, rent out or dispose" to="/analytics" tone={idle ? 'warn' : undefined} />
        <Tile icon="performance" value={num(tot.generating_revenue)} caption="Earning revenue" note={d.can_see_money && tot.revenue_received ? t('{v} recorded so far', { v: compactEtb(tot.revenue_received) }) : undefined} />
        {d.can_see_money && <Tile icon="wrench" value={compactEtb(tot.maintenance_cost)} caption="Maintenance spending" />}
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <HealthRings d={d} idle={idle} />
        <ConditionCard d={d} />
        <PipelineCard d={d} title="Where registrations stand" />
      </div>

      <h2 style={{ marginTop: 24 }}>{t('Needs leadership attention')}</h2>
      <div className="grid grid-tiles grid-tiles-5" role="list" aria-label={t('Needs leadership attention')}>
        <Tile icon="search" value={num(status(d, 'LOST'))} caption="Missing / lost" to="/assets?status=LOST" tone={status(d, 'LOST') ? 'bad' : undefined} />
        <Tile icon="alert" value={num(condition(d, 'CRITICAL'))} caption="Critical condition" note="Repair, replace or retire" to="/assets?condition=CRITICAL" tone={condition(d, 'CRITICAL') ? 'bad' : undefined} />
        <Tile icon="verification" value={num(tot.open_discrepancies)} caption="Verification discrepancies" note="Not found where the register says" tone={tot.open_discrepancies ? 'bad' : undefined} />
        <Tile icon="logout" value={num(disposals)} caption="Pending disposals" note="Disposal and retirement requests" tone={disposals ? 'warn' : undefined} />
        <Tile icon="audit" value={num(waiting)} caption="Waiting for approval" note={oldest != null ? t('Oldest has waited {n} days', { n: num(oldest) }) : undefined} tone={oldest >= 14 ? 'bad' : waiting ? 'warn' : undefined} />
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>{t('How each Kifle Ketema is doing')}</h2>
          <Link to="/performance">{t('Performance by area')}</Link>
        </div>
        {perf.error ? <Alert>{perf.error}</Alert> : !perf.data ? <Loading /> : <AreaTable rows={areas} kind="kifle" money={perf.data.can_see_money} />}
        <WaitNote />
      </section>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <RegistrationTrend d={d} className="span-2" />
        <section className="card"><h2>{t('Assets by Kifle Ketema')}</h2><Bars hue={7} rows={d.by_kifle_ketema} to={(r) => `/assets?kifle_ketema_id=${r.id}`} /></section>
        <section className="card"><h2>{t('Assets by sector')}</h2><Bars hue={3} rows={d.by_sector} to={(r) => `/assets?sector_id=${r.id}`} /></section>
        <section className="card"><h2>{t('Assets by category')}</h2><Bars hue={4} rows={d.by_category} to={(r) => `/assets?category_id=${r.id}`} /></section>
        <Shortcuts title="For meetings and decisions" items={[
          ['/analytics', 'Analytics: idle assets, replacement candidates, costs'],
          ['/performance', 'Performance of each Kifle Ketema'],
          ['/map', 'City-wide map'],
        ]} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Kifle Ketema Administrator

export function KifleDashboard({ d }) {
  const { user } = useAuth();
  const lk = useLookups();
  const tot = d.totals;
  const mine = lk.kifle.filter((k) => user.scope.kifle.includes(k.id)).map((k) => t(k.name)).join(', ');
  const myKebeles = lk.kebeles.filter((k) => user.scope.kifle.includes(k.kifle_ketema_id));
  const toApprove = approval(d, 'REVIEWED');
  return (
    <>
      <PageHeader title={`${mine || t('Your Kifle Ketema')}: oversight and approval`} subtitle="Your Kifle Ketema only: its Kebeles, the sector administrators working in them, and everything waiting for your approval." />
      {myKebeles.length === 0 && <Alert kind="info">{t('No Kebele is linked to your Kifle Ketema yet. The Super Administrator links them in Master data.')}</Alert>}
      <div className="grid grid-tiles" role="list" aria-label={t('Key figures')}>
        <Tile feature icon="assets" spark={growth(d)} value={num(tot.assets)} caption="Total assets" note={t('{n} approved and active', { n: num(tot.active) })} to="/assets" />
        <Tile icon="approvals" value={num(toApprove)} caption="Waiting for your approval" note="Verified by the Kebele Administrator" to="/approvals" tone={toApprove ? 'warn' : undefined} />
        <Tile icon="reports" value={num(tot.pending_requests)} caption="Requests to decide" note="Transfers, disposals, ownership changes" to="/approvals" tone={tot.pending_requests ? 'warn' : undefined} />
        <Tile icon="audit" value={num(approval(d, 'SUBMITTED'))} caption="Awaiting Kebele verification" note="Registered, not yet checked physically" />
        <Tile icon="verification" value={num(tot.open_discrepancies)} caption="Verification discrepancies" to="/verification" tone={tot.open_discrepancies ? 'bad' : undefined} />
        <Tile icon="wrench" value={num(tot.maintenance_overdue + tot.maintenance_due_soon)} caption="Maintenance due" note={t('{n} overdue', { n: num(tot.maintenance_overdue) })} tone={tot.maintenance_overdue ? 'bad' : undefined} />
        <Tile icon="alert" value={num(status(d, 'DAMAGED'))} caption="Damaged" to="/assets?status=DAMAGED" tone={status(d, 'DAMAGED') ? 'warn' : undefined} />
        <Tile icon="search" value={num(status(d, 'LOST'))} caption="Missing / lost" to="/assets?status=LOST" tone={status(d, 'LOST') ? 'bad' : undefined} />
      </div>
      <Money d={d} items={[[tot.acquisition_cost, 'Acquisition cost'], [tot.current_valuation, 'Current valuation'], [tot.maintenance_cost, 'Maintenance spending', undefined, 'wrench']]} />

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <PipelineCard d={d} note="Registrations in your Kifle Ketema, by where they stand." />
        <ConditionCard d={d} />
        <HealthRings d={d} />
        <RegistrationTrend d={d} className="span-2" />
        <section className="card">
          <h2>{t('Kebeles in your Kifle Ketema')}</h2>
          <Bars hue={5} rows={withZeros(myKebeles, d.by_kebele)} to={(r) => `/assets?kebele_id=${r.id}`} empty="No Kebeles linked yet." />
        </section>
        <section className="card"><h2>{t('Assets by sector')}</h2><Bars hue={3} rows={d.by_sector} to={(r) => `/assets?sector_id=${r.id}`} /></section>
        <Shortcuts items={[
          ['/approvals', 'Approvals', toApprove + tot.pending_requests, toApprove + tot.pending_requests ? 'warn' : undefined],
          ['/users', 'Kebele Administrators and sector administrators'],
          ['/performance', 'Performance of your Kebeles'],
          ['/map', 'Kifle Ketema map'],
        ]} />
        <MaintenanceDue d={d} />
      </div>
      {can.overseeInspectors(user) && <InspectorsCard />}
      <Recent d={d} />
    </>
  );
}

/** The Inspectors of the Kifle Ketema: what each has done lately, what is overdue, and where nobody inspects. */
function InspectorsCard() {
  const { data, error } = useAsync(() => api.get('/dashboard/inspectors'), []);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2>{t('Inspectors in your Kifle Ketema')}</h2>
        <Link to="/users">{t('Their accounts')}</Link>
      </div>
      {error ? <Alert>{error}</Alert> : !data ? <Loading /> : (
        <>
          {data.uncovered.length > 0 && (
            <Alert kind="info">{t('No Inspector covers {names} yet, so nobody can record inspections there. Ask the Super Administrator to create one.', { names: data.uncovered.map((k) => t(k.name)).join(', ') })}</Alert>
          )}
          <p className={data.overdue ? 'small' : 'muted small'}>
            <strong>{t('{n} inspection(s) overdue', { n: num(data.overdue) })}</strong>
            {' · '}{t('{n} due within {days} days', { n: num(data.due_soon), days: data.due_window_days })}
          </p>
          <Table head={['Inspector', 'Inspections, last 30 days', 'Failed', 'Last inspection', 'Last sign-in', 'Status']} empty={data.inspectors.length === 0 && 'No Inspector works in your Kifle Ketema yet.'}>
            {data.inspectors.map((u) => (
              <tr key={u.id}>
                <td><Link to={`/users/${u.id}/history`}>{u.full_name}</Link><div className="muted small">{u.username}</div></td>
                <td>{num(u.inspections_recent)}</td>
                <td>{u.failed_recent ? <span className="badge badge-warn">{num(u.failed_recent)}</span> : '0'}</td>
                <td>{u.last_inspection ? date(u.last_inspection) : <span className="muted">{t('None yet')}</span>}</td>
                <td>{dateTime(u.last_login_at)}</td>
                <td>{u.is_active ? <Badge value="ACTIVE" text="Active" /> : <Badge value="DRAFT" text="Inactive" />}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- Kebele Administrator

export function KebeleDashboard({ d }) {
  const { user } = useAuth();
  const lk = useLookups();
  const tot = d.totals;
  const mine = lk.kebeles.filter((k) => user.scope.kebeles.includes(k.id)).map((k) => t(k.name)).join(', ');
  const toVerify = approval(d, 'SUBMITTED');
  return (
    <>
      <PageHeader title={`${mine || t('Your Kebele')}: physical verification`} subtitle="Your Kebele only. Check that each registered asset really exists where it says, and report anything missing, damaged or wrongly recorded." />
      <div className="grid grid-tiles" role="list" aria-label={t('Key figures')}>
        <Tile feature icon="assets" spark={growth(d)} value={num(tot.assets)} caption="Total assets" to="/assets" />
        <Tile icon="verification" value={num(toVerify)} caption="Waiting for your verification" note="Registered by the sector administrators" to="/approvals" tone={toVerify ? 'warn' : undefined} />
        <Tile icon="map" value={num(tot.open_discrepancies)} caption="Verification discrepancies" note="Found elsewhere, missing or duplicated" to="/verification" tone={tot.open_discrepancies ? 'bad' : undefined} />
        <Tile icon="search" value={num(status(d, 'LOST'))} caption="Missing / lost" to="/assets?status=LOST" tone={status(d, 'LOST') ? 'bad' : undefined} />
        <Tile icon="alert" value={num(status(d, 'DAMAGED'))} caption="Damaged" to="/assets?status=DAMAGED" tone={status(d, 'DAMAGED') ? 'warn' : undefined} />
        <Tile icon="alert" value={num(condition(d, 'CRITICAL'))} caption="Critical condition" to="/assets?condition=CRITICAL" tone={condition(d, 'CRITICAL') ? 'bad' : undefined} />
        <Tile icon="wrench" value={num(tot.maintenance_overdue + tot.maintenance_due_soon)} caption="Maintenance due" note={t('{n} overdue', { n: num(tot.maintenance_overdue) })} tone={tot.maintenance_overdue ? 'bad' : undefined} />
        <Tile icon="followups" value={num(tot.open_follow_ups)} caption="Open follow-up actions" to="/follow-ups" />
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <ConditionCard d={d} />
        <PipelineCard d={d} note="Registrations in your Kebele, by where they stand." />
        <HealthRings d={d} />
        <MaintenanceTrend d={d} className="span-2" />
        <section className="card"><h2>{t('Assets by status')}</h2><Bars hue={6} rows={d.by_status.filter((s) => s.n > 0)} nameOf={(r) => label(r.key)} to={(r) => `/assets?status=${r.key}`} /></section>
        <section className="card">
          <h2>{t('The 13 sector areas of your Kebele')}</h2>
          <Bars hue={3} rows={withZeros(lk.sectors, d.by_sector)} to={(r) => `/assets?sector_id=${r.id}`} />
        </section>
        <Shortcuts items={[
          ['/approvals', 'Verify newly registered assets', toVerify, toVerify ? 'warn' : undefined],
          ['/verification', 'Physical verification', tot.open_discrepancies, tot.open_discrepancies ? 'bad' : undefined],
          ['/scan', 'Scan a QR code'],
          ['/users', 'Sector administrators'],
          ['/map', 'Kebele map'],
        ]} />
        <MaintenanceDue d={d} />
      </div>
      <Recent d={d} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Sector Administrator

export function SectorDashboard({ d }) {
  const { user } = useAuth();
  const lk = useLookups();
  const tot = d.totals;
  const sector = lk.sectors.filter((s) => user.scope.sectors.includes(s.id)).map((s) => t(s.name)).join(', ');
  const kebele = lk.kebeles.filter((k) => user.scope.kebeles.includes(k.id)).map((k) => t(k.name)).join(', ');
  const awaiting = approval(d, 'SUBMITTED') + approval(d, 'REVIEWED');
  const rejected = approval(d, 'DRAFT');
  return (
    <>
      <PageHeader title={`${sector || t('Your sector')}${kebele ? ` · ${kebele}` : ''}`} subtitle="Your sector inside your Kebele only. Register assets, keep their records up to date, and follow them through verification and approval.">
        <Link to="/assets/new" className="btn btn-primary">{t('Register asset')}</Link>
      </PageHeader>
      <div className="grid grid-tiles" role="list" aria-label={t('Key figures')}>
        <Tile feature icon="assets" spark={growth(d)} value={num(tot.assets)} caption="Total sector assets" to="/assets" />
        <Tile icon="register" value={num(rejected)} caption="Drafts and returned" note="Finish and submit, or correct what was sent back" to="/assets?approval_state=DRAFT" tone={rejected ? 'warn' : undefined} />
        <Tile icon="audit" value={num(awaiting)} caption="Awaiting verification and approval" note={t('{a} with the Kebele · {b} with the Kifle Ketema', { a: num(approval(d, 'SUBMITTED')), b: num(approval(d, 'REVIEWED')) })} />
        <Tile icon="approvals" value={num(tot.active)} caption="Active" note="Approved and in operation" to="/assets?approval_state=ACTIVE" />
        <Tile icon="wrench" value={num(status(d, 'UNDER_MAINTENANCE'))} caption="Under maintenance" note={t('{n} open jobs', { n: num(tot.open_maintenance_jobs) })} to="/assets?status=UNDER_MAINTENANCE" />
        <Tile icon="alert" value={num(status(d, 'DAMAGED'))} caption="Damaged" to="/assets?status=DAMAGED" tone={status(d, 'DAMAGED') ? 'warn' : undefined} />
        <Tile icon="search" value={num(status(d, 'LOST'))} caption="Missing / lost" to="/assets?status=LOST" tone={status(d, 'LOST') ? 'bad' : undefined} />
        <Tile icon="verification" value={num(tot.inspection_due)} caption="Due for inspection" note={t('within {n} days', { n: d.maintenance_due_window_days })} tone={tot.inspection_due ? 'warn' : undefined} />
      </div>
      <Money d={d} items={[[tot.acquisition_cost, 'Acquisition cost'], [tot.current_valuation, 'Current valuation'], [tot.maintenance_cost, 'Maintenance spending', undefined, 'wrench']]} />

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <PipelineCard d={d} title="Your registrations" note="Where each of your assets stands in the approval chain." />
        <ConditionCard d={d} />
        <section className="card"><h2>{t('Assets by status')}</h2><Bars hue={6} rows={d.by_status.filter((s) => s.n > 0)} nameOf={(r) => label(r.key)} to={(r) => `/assets?status=${r.key}`} /></section>
        <MaintenanceTrend d={d} className="span-2" />
        <Shortcuts items={[
          ['/assets/new', 'Register a new asset'],
          ['/assets', 'Sector asset list'],
          ['/approvals', 'Requests: transfer, disposal, retirement'],
          ['/follow-ups', 'Open follow-up actions', tot.open_follow_ups],
        ]} />
        <MaintenanceDue d={d} />
      </div>
      <Recent d={d} title="What happened to your assets" />
    </>
  );
}
