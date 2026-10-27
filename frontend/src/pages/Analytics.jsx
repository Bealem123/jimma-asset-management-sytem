import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { compactEtb, etb, label, num } from '../format.js';
import { Alert, Badge, Loading, PageHeader, Table, useAsync } from '../components/ui.jsx';
import { Bars, Columns } from '../components/charts.jsx';
import { t } from '../i18n.jsx';

const pct = (v) => `${v}%`;

export default function Analytics() {
  const { data: a, error, loading } = useAsync(() => api.get('/analytics'), []);
  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const money = a.can_see_money;

  return (
    <>
      <PageHeader title="Analytics and decision support" subtitle="What the register says about condition, cost, use and where to act first. Calculated from the records, not guessed." />

      <section aria-labelledby="ind-h">
        <h2 id="ind-h">{t('Decision indicators')}</h2>
        <div className="grid grid-tiles grid-tiles-3 indicator-tiles">
          {a.indicators.map((i) => (
            <div key={i.key} className={`tile tile-${i.status === 'good' ? 'ok' : i.status}`}>
              <div className="value">{i.value}{i.unit}</div>
              <div className="caption">{t(i.label)}</div>
              <div className="note"><Badge value={i.status} text={{ good: 'On track', warn: 'Watch', bad: 'Act' }[i.status]} /> {t(i.hint)}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>{t('Sector comparison: share in poor or critical condition')}</h2>
          <Bars hue={8} rows={a.sector_comparison.filter((s) => s.assets > 0)} nameOf={(s) => `${s.code} · ${t(s.name)}`} getValue={(s) => s.poor_share} format={pct} to={(s) => `/assets?sector_id=${s.id}`} empty="No assets yet." />
        </section>
        <section className="card">
          <h2>{t('Kifle Ketema comparison: share in poor or critical condition')}</h2>
          <Bars hue={8} rows={a.geographic_comparison.kifle_ketema} getValue={(k) => k.poor_share} format={pct} to={(k) => `/assets?kifle_ketema_id=${k.id}`} empty="No assets yet." />
        </section>
        {a.kebele_level && ( // the Mayor's figures stop at Kifle Ketema level
          <section className="card">
            <h2>{t('Kebele comparison: share in poor or critical condition')}</h2>
            <Bars hue={8} rows={a.geographic_comparison.kebele} getValue={(k) => k.poor_share} format={pct} to={(k) => `/assets?kebele_id=${k.id}`} empty="No assets have a Kebele yet." />
          </section>
        )}
        <section className="card">
          <h2>{t('Assets by sector')}</h2>
          <Bars hue={3} rows={a.sector_comparison.filter((s) => s.assets > 0)} nameOf={(s) => `${s.code} · ${t(s.name)}`} getValue={(s) => s.assets} to={(s) => `/assets?sector_id=${s.id}`} />
        </section>
        {money && (
          <section className="card">
            <h2>{t('Maintenance spending by sector')}</h2>
            <Bars hue={2} rows={a.sector_comparison.filter((s) => s.maintenance > 0)} nameOf={(s) => `${s.code} · ${t(s.name)}`} getValue={(s) => s.maintenance} format={compactEtb} empty="No maintenance costs recorded." />
          </section>
        )}
        {money && (
          <section className="card">
            <h2>{t('Asset value')}</h2>
            {a.value_analysis && (
              <dl className="dl">
                <dt>{t('Acquisition cost')}</dt><dd>{a.value_analysis.acquisition_cost == null ? t('Not recorded') : etb(a.value_analysis.acquisition_cost)}</dd>
                <dt>{t('Current valuation')}</dt><dd>{a.value_analysis.current_valuation == null ? t('Not valued') : etb(a.value_analysis.current_valuation)}</dd>
                <dt>{t('Book value (depreciated)')}</dt><dd>{a.value_analysis.book_value == null ? t('Not enough data') : etb(a.value_analysis.book_value)} <span className="muted small">({t('{n} assets with enough data', { n: a.value_analysis.assets_with_depreciation })})</span></dd>
                <dt>{t('Depreciation to date')}</dt><dd>{a.value_analysis.accumulated_depreciation == null ? t('Not enough data') : etb(a.value_analysis.accumulated_depreciation)}</dd>
                <dt>{t('Fully depreciated')}</dt><dd>{t('{n} assets', { n: a.value_analysis.fully_depreciated })}</dd>
              </dl>
            )}
          </section>
        )}
      </div>

      <h2 style={{ marginTop: 24 }}>{t('Trends (last 12 months)')}</h2>
      <div className="grid grid-2">
        <section className="card"><h3>{t('Assets registered')}</h3><Columns hue={1} title="Assets registered per month" rows={a.trends.registrations} labelOf={(r) => r.month} getValue={(r) => r.assets} /></section>
        <section className="card"><h3>{t('Maintenance jobs')}</h3><Columns hue={2} title="Maintenance jobs per month" rows={a.trends.maintenance} labelOf={(r) => r.month} getValue={(r) => r.jobs} /></section>
        {money && <section className="card"><h3>{t('Maintenance cost (ETB)')}</h3><Columns hue={2} title="Maintenance cost per month" rows={a.trends.maintenance} labelOf={(r) => r.month} getValue={(r) => r.cost || 0} format={compactEtb} /></section>}
        <section className="card"><h3>{t('Failed inspections')}</h3><Columns hue={8} title="Failed inspections per month" rows={a.trends.inspections} labelOf={(r) => r.month} getValue={(r) => r.failed} /></section>
        <section className="card"><h3>{t('Condition changes recorded')}</h3><Columns hue={4} title="Condition changes per month" rows={a.trends.condition_changes} labelOf={(r) => r.month} getValue={(r) => r.changes} /></section>
      </div>

      <section style={{ marginTop: 24 }}>
        <h2>{t('Consider replacing or retiring')}</h2>
        <p className="muted small">{t('Assets in poor or critical condition where repairs cost half the purchase price or more, or that have passed their useful life.')}</p>
        <Table head={['Asset', 'Condition', 'Why', ...(money ? ['Repairs so far', 'Purchase price'] : [])]} num={[3, 4]} empty={a.replacement_candidates.length === 0 && 'No asset meets these tests.'}>
          {a.replacement_candidates.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/assets/${r.id}`}>{r.asset_code}</Link> {r.name}</td><td><Badge value={r.condition} /></td><td>{r.reasons.map((x) => t(x)).join('; ')}</td>
              {money && <><td className="num">{etb(r.maintenance_cost)}</td><td className="num">{r.acquisition_cost != null ? etb(r.acquisition_cost) : '—'}</td></>}
            </tr>
          ))}
        </Table>
      </section>

      {money && (
        <section style={{ marginTop: 24 }}>
          <h2>{t('Highest maintenance spending')}</h2>
          <p className="muted small">{t('Assets ranked by what their repairs have cost so far. Repairs at half the purchase price or more are shown in red.')}</p>
          <Table head={['Asset', 'Condition', 'Jobs', 'Maintenance cost', 'Purchase price', 'Repairs as % of price']} num={[2, 3, 4, 5]} empty={a.high_maintenance.length === 0 && 'No maintenance costs recorded yet.'}>
            {a.high_maintenance.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/assets/${r.id}`}>{r.asset_code}</Link> {r.name}</td><td><Badge value={r.condition} /></td><td className="num">{num(r.jobs)}</td>
                <td className="num">{etb(r.maintenance_cost)}</td><td className="num">{r.acquisition_cost != null ? etb(r.acquisition_cost) : t('Not recorded')}</td>
                <td className="num">{r.cost_ratio != null ? <span className={r.cost_ratio >= 50 ? 'text-bad' : undefined}>{r.cost_ratio}%</span> : '—'}</td>
              </tr>
            ))}
          </Table>
          {a.lifecycle_cost.length > 0 && (
            <>
              <h2 style={{ marginTop: 24 }}>{t('Lifecycle cost (purchase + maintenance)')}</h2>
              <Bars hue={2} rows={a.lifecycle_cost} nameOf={(r) => `${r.asset_code} · ${r.name}`} getValue={(r) => r.total_cost} format={compactEtb} to={(r) => `/assets/${r.id}`} />
            </>
          )}
        </section>
      )}

      <div className="grid grid-2" style={{ marginTop: 24 }}>
        <section>
          <h2>{t('Critical assets')}</h2>
          <Table head={['Asset', 'Status']} empty={a.critical_assets.length === 0 && 'None in critical condition.'}>
            {a.critical_assets.map((r) => <tr key={r.id}><td><Link to={`/assets/${r.id}`}>{r.asset_code}</Link> {r.name}</td><td><Badge value={r.status} /></td></tr>)}
          </Table>
        </section>
        <section>
          <h2>{t('Possibly under-used')}</h2>
          <p className="muted small">{t('Active assets with no current use recorded (or only idle). Record their use, reassign, lease or dispose of them.')}</p>
          <Table head={['Asset', 'Condition']} empty={a.underutilized.length === 0 && 'Every active asset has a current use.'}>
            {a.underutilized.map((r) => <tr key={r.id}><td><Link to={`/assets/${r.id}`}>{r.asset_code}</Link> {r.name}</td><td><Badge value={r.condition} /></td></tr>)}
          </Table>
          {a.unreserved_reservable.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>{t('Reservable but not reserved in 90 days')}</h3>
              <ul className="plain-list">{a.unreserved_reservable.map((r) => <li key={r.id}><Link to={`/assets/${r.id}`}>{r.asset_code} · {r.name}</Link></li>)}</ul>
            </>
          )}
        </section>
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>{t('These are rule-based indicators from recorded data. Machine-learning prediction (failure forecasting, automatic classification, sensor monitoring) is a later phase that needs a longer history of inspection and maintenance records first.')}</p>
    </>
  );
}
