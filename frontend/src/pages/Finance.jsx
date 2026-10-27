import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { compactEtb, date, dateTime, etb, label, num, today } from '../format.js';
import { isValidCalendarDate, validateNameText } from '../validation.js';
import { can } from '../permissions.js';
import { Alert, Badge, Empty, Loading, Modal, PageHeader, Table, Tabs } from '../components/ui.jsx';
import { Bars, Tile } from '../components/charts.jsx';
import { t } from '../i18n.jsx';

const VALUATION_METHODS = [
  'Market Appraisal',
  'Depreciated Replacement Cost',
  'Historical Cost Indexing',
  'Expert Physical Appraisal',
  'Residual / Salvage Value',
  'Contractual / Lease Base Value',
  'Other',
];

export default function Finance() {
  const { user } = useAuth();
  const lk = useLookups();
  const [params, setParams] = useSearchParams();

  const tab = params.get('tab') || 'valuations';
  const setTab = (t) => {
    params.set('tab', t);
    setParams(params, { replace: true });
  };

  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Tab data states
  const [valuations, setValuations] = useState([]);
  const [revenues, setRevenues] = useState([]);
  const [backlog, setBacklog] = useState([]);
  const [loadingTab, setLoadingTab] = useState(false);
  // the tabs already shown once: switching back keeps their table on screen while it refreshes, instead of a blink
  const [seen, setSeen] = useState(() => new Set());

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [revenueTypeFilter, setRevenueTypeFilter] = useState('');

  // Modals
  const [modal, setModal] = useState(null); // 'valuation' | 'revenue'
  const [preselectedAsset, setPreselectedAsset] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);

  // Check URL params for quick actions
  useEffect(() => {
    const action = params.get('action');
    if (action === 'valuation') {
      setModal('valuation');
      params.delete('action');
      setParams(params, { replace: true });
    } else if (action === 'revenue') {
      setModal('revenue');
      params.delete('action');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  // Load overview
  const loadOverview = async () => {
    try {
      const data = await api.get('/finance/overview');
      setOverview(data);
      setError(null);
    } catch (err) {
      setError(err?.message || 'Failed to load financial overview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  // Load active tab data
  const loadTabData = async () => {
    setLoadingTab(true);
    try {
      if (tab === 'valuations') {
        const query = new URLSearchParams();
        if (searchQuery) query.set('q', searchQuery);
        if (methodFilter) query.set('method', methodFilter);
        const data = await api.get(`/finance/valuations?${query.toString()}`);
        setValuations(data);
      } else if (tab === 'revenues') {
        const query = new URLSearchParams();
        if (searchQuery) query.set('q', searchQuery);
        if (revenueTypeFilter) query.set('revenue_type', revenueTypeFilter);
        const data = await api.get(`/finance/revenues?${query.toString()}`);
        setRevenues(data);
      } else if (tab === 'backlog') {
        const data = await api.get('/finance/backlog');
        setBacklog(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTab(false);
      setSeen((s) => (s.has(tab) ? s : new Set(s).add(tab)));
    }
  };

  useEffect(() => {
    loadTabData();
  }, [tab, searchQuery, methodFilter, revenueTypeFilter]);

  const tot = overview?.totals || {};

  const handleOpenValuation = (asset = null) => {
    setPreselectedAsset(asset);
    setModal('valuation');
  };

  const handleOpenRevenue = (asset = null) => {
    setPreselectedAsset(asset);
    setModal('revenue');
  };

  const handleModalClose = () => {
    setModal(null);
    setPreselectedAsset(null);
  };

  const handleSuccess = (msg) => {
    handleModalClose();
    setActionNotice(msg);
    loadOverview();
    loadTabData();
    setTimeout(() => setActionNotice(null), 5000);
  };

  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <>
      <PageHeader
        title="Financial management"
        subtitle="Valuation registers, municipal revenue tracking, capital assets accounting and revaluation pipeline."
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {can.editFinancial(user) && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleOpenValuation()}
              >
                + {t('Record valuation')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => handleOpenRevenue()}
              >
                + {t('Record revenue')}
              </button>
            </>
          )}
        </div>
      </PageHeader>

      {actionNotice && <Alert kind="success">{actionNotice}</Alert>}

      {/* Financial KPIs */}
      <div className="grid grid-tiles" role="list" aria-label={t('Financial overview key metrics')}>
        <Tile
          feature
          icon="coin"
          value={compactEtb(tot.total_valuation)}
          caption="Total portfolio valuation"
          note={t('{n}% valuation coverage ({v} of {a} assets)', {
            n: tot.valuation_coverage_pct || 0,
            v: num(tot.valued_count || 0),
            a: num(tot.total_assets || 0),
          })}
          onClick={() => setTab('valuations')}
        />
        <Tile
          icon="performance"
          value={compactEtb(tot.total_revenue)}
          caption="Municipal revenue recorded"
          note={t('{n} revenue transaction(s)', { n: num(tot.revenue_count || 0) })}
          onClick={() => setTab('revenues')}
        />
        <Tile
          icon="alert"
          value={num((tot.unvalued_count || 0) + (tot.revaluation_due_count || 0))}
          caption="Valuation backlog"
          note={t('{u} unvalued · {r} revaluation overdue', {
            u: num(tot.unvalued_count || 0),
            r: num(tot.revaluation_due_count || 0),
          })}
          tone={(tot.unvalued_count || 0) + (tot.revaluation_due_count || 0) > 0 ? 'warn' : undefined}
          onClick={() => setTab('backlog')}
        />
        <Tile
          icon="coin"
          value={compactEtb(tot.total_acquisition)}
          caption="Capital acquisition cost"
          note={t('Recorded procurement / capital expenditure')}
          to="/assets"
        />
        <Tile
          icon="wrench"
          hue={0}
          value={compactEtb(tot.total_maintenance)}
          caption="Maintenance expenditure"
          note={t('Active and completed maintenance costs')}
          to="/assets?status=UNDER_MAINTENANCE"
        />
      </div>

      {/* Tabs */}
      <div style={{ marginTop: 24, marginBottom: 16 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            ['valuations', 'Valuations ledger', tot.valued_count],
            ['revenues', 'Municipal revenue', tot.revenue_count],
            ['backlog', 'Valuation backlog', (tot.unvalued_count || 0) + (tot.revaluation_due_count || 0)],
            ['analysis', 'Portfolio analysis'],
          ]}
        />
      </div>

      {/* TAB: Valuations Ledger */}
      {tab === 'valuations' && (
        <section className="card tab-panel" aria-busy={loadingTab}>
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0 }}>{t('Asset valuations ledger')}</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {t('Recorded market appraisals, depreciation reviews, and periodic official asset valuations.')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="search"
                className="input"
                placeholder={t('Search code, asset name, method…')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: 240 }}
              />
              <select
                className="input"
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                style={{ width: 180 }}
              >
                <option value="">{t('All valuation methods')}</option>
                {VALUATION_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {can.editFinancial(user) && (
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  onClick={() => handleOpenValuation()}
                >
                  + {t('Add valuation')}
                </button>
              )}
            </div>
          </div>

          {loadingTab && !seen.has(tab) ? <Loading /> : (
            <Table
              head={['Asset', 'Category & Sector', 'Location', 'Valuation date', 'Valuation (ETB)', 'Method', 'Notes', 'Recorded by', '']}
              empty={valuations.length === 0 && 'No asset valuations recorded in your area matching criteria.'}
            >
              {valuations.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to={`/assets/${v.asset_id}`} style={{ fontWeight: 600 }}>
                      {v.asset_code}
                    </Link>
                    <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{v.asset_name}</div>
                  </td>
                  <td>
                    <div>{v.category_name || '—'}</div>
                    <small className="muted">{v.sector_code ? `${v.sector_code} · ${v.sector_name}` : '—'}</small>
                  </td>
                  <td>
                    <div>{v.kifle_name || '—'}</div>
                    <small className="muted">{v.kebele_name || ''}</small>
                  </td>
                  <td>{date(v.valuation_date)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{etb(v.value)}</td>
                  <td><span className="badge badge-neutral">{v.method || 'Standard'}</span></td>
                  <td style={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.notes || '—'}
                  </td>
                  <td>
                    <div style={{ fontSize: '0.9em' }}>{v.recorder_name || v.recorder_username || '—'}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link to={`/assets/${v.asset_id}`} className="btn btn-small">
                      {t('View')}
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      )}

      {/* TAB: Revenues Ledger */}
      {tab === 'revenues' && (
        <section className="card tab-panel" aria-busy={loadingTab}>
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0 }}>{t('Municipal asset revenue')}</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {t('Rental income, leasing fees, concession dues and disposal sale receipts from city assets.')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="search"
                className="input"
                placeholder={t('Search asset, payer, receipt…')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: 240 }}
              />
              <select
                className="input"
                value={revenueTypeFilter}
                onChange={(e) => setRevenueTypeFilter(e.target.value)}
                style={{ width: 160 }}
              >
                <option value="">{t('All revenue types')}</option>
                {lk.enums.revenue_types?.map((type) => (
                  <option key={type} value={type}>{label(type)}</option>
                ))}
              </select>
              {can.editFinancial(user) && (
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  onClick={() => handleOpenRevenue()}
                >
                  + {t('Record revenue')}
                </button>
              )}
            </div>
          </div>

          {loadingTab && !seen.has(tab) ? <Loading /> : (
            <Table
              head={['Received on', 'Asset', 'Type', 'Amount (ETB)', 'Payer / Tenant', 'Reference', 'Period', 'Recorded by', '']}
              empty={revenues.length === 0 && 'No municipal revenues recorded matching criteria.'}
            >
              {revenues.map((r) => (
                <tr key={r.id}>
                  <td>{date(r.received_date)}</td>
                  <td>
                    <Link to={`/assets/${r.asset_id}`} style={{ fontWeight: 600 }}>
                      {r.asset_code}
                    </Link>
                    <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{r.asset_name}</div>
                  </td>
                  <td>
                    <Badge value={r.revenue_type} text={label(r.revenue_type)} />
                  </td>
                  <td className="num" style={{ fontWeight: 600, color: '#30d158' }}>
                    +{etb(r.amount)}
                  </td>
                  <td>{r.payer || '—'}</td>
                  <td><code>{r.reference || '—'}</code></td>
                  <td>
                    {r.period_start ? `${date(r.period_start)} – ${date(r.period_end)}` : '—'}
                  </td>
                  <td>
                    <div style={{ fontSize: '0.9em' }}>{r.recorder_name || r.recorder_username || '—'}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link to={`/assets/${r.asset_id}`} className="btn btn-small">
                      {t('View')}
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      )}

      {/* TAB: Valuation Backlog */}
      {tab === 'backlog' && (
        <section className="card tab-panel" aria-busy={loadingTab}>
          <div className="card-head" style={{ marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0 }}>{t('Valuation backlog & schedule')}</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {t('Active assets that have no valuation recorded, or have not been re-evaluated in the past 12 months.')}
              </p>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Alert kind="info">
              {t('City financial compliance requires all active municipal assets to hold an official valuation refreshed annually.')}
            </Alert>
          </div>

          {loadingTab && !seen.has(tab) ? <Loading /> : (
            <Table
              head={['Asset', 'Category & Sector', 'Location', 'Acquisition cost', 'Current valuation', 'Valuation date', 'Condition', 'Action']}
              empty={backlog.length === 0 && 'All assets in your area have up-to-date valuations! No backlog.'}
            >
              {backlog.map((a) => {
                const neverValued = a.current_valuation == null || Number(a.current_valuation) === 0;
                return (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/assets/${a.id}`} style={{ fontWeight: 600 }}>
                        {a.asset_code}
                      </Link>
                      <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{a.name}</div>
                    </td>
                    <td>
                      <div>{a.category_name || '—'}</div>
                      <small className="muted">{a.sector_code ? `${a.sector_code} · ${a.sector_name}` : '—'}</small>
                    </td>
                    <td>
                      <div>{a.kifle_name || '—'}</div>
                      <small className="muted">{a.kebele_name || ''}</small>
                    </td>
                    <td className="num">{a.acquisition_cost != null ? etb(a.acquisition_cost) : <span className="muted">—</span>}</td>
                    <td className="num">
                      {neverValued ? (
                        <span className="badge badge-warn">{t('Not valued')}</span>
                      ) : (
                        etb(a.current_valuation)
                      )}
                    </td>
                    <td>
                      {neverValued ? (
                        <span className="muted">{t('Never')}</span>
                      ) : (
                        <div>
                          <span>{date(a.valuation_date)}</span>
                          <div><span className="badge badge-bad" style={{ fontSize: '0.75em' }}>{t('Overdue')}</span></div>
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge value={a.condition} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {can.editFinancial(user) && (
                        <button
                          type="button"
                          className="btn btn-small btn-primary"
                          onClick={() => handleOpenValuation(a)}
                        >
                          + {t('Value asset')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </section>
      )}

      {/* TAB: Portfolio Analysis */}
      {tab === 'analysis' && (
        <div className="grid grid-2 tab-panel" style={{ gap: 16 }}>
          <section className="card">
            <h2>{t('Valuation by sector')}</h2>
            <p className="muted small">{t('Distribution of valued asset worth across city sectors.')}</p>
            <Bars
              hue={3}
              rows={(overview?.by_sector || []).map((s) => ({
                id: s.id,
                name: `${s.code} · ${t(s.name)}`,
                n: s.valuation,
              }))}
              to={(r) => `/assets?sector_id=${r.id}`}
            />
          </section>

          <section className="card">
            <h2>{t('Valuation by category')}</h2>
            <p className="muted small">{t('Distribution of asset worth across municipal asset categories.')}</p>
            <Bars
              hue={4}
              rows={(overview?.by_category || []).map((c) => ({
                id: c.id,
                name: t(c.name),
                n: c.valuation,
              }))}
              to={(r) => `/assets?category_id=${r.id}`}
            />
          </section>

          <section className="card">
            <h2>{t('Municipal revenue by type')}</h2>
            <ul className="plain-list">
              {(overview?.by_revenue_type || []).map((rt) => (
                <li key={rt.type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <Badge value={rt.type} text={label(rt.type)} />
                    <span style={{ marginLeft: 8, fontSize: '0.85em', color: 'var(--color-muted)' }}>
                      ({num(rt.count)} {t('transactions')})
                    </span>
                  </span>
                  <strong style={{ color: '#30d158' }}>{compactEtb(rt.total)}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>{t('Capital cost vs. Current valuation')}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
              <div style={{ padding: 16, background: 'var(--color-surface-subtle, rgba(255,255,255,0.03))', borderRadius: 8 }}>
                <div className="muted small">{t('Total acquisition cost')}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: 4 }}>
                  {compactEtb(tot.total_acquisition)}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {t('Initial capital expenditure')}
                </div>
              </div>
              <div style={{ padding: 16, background: 'var(--color-surface-subtle, rgba(255,255,255,0.03))', borderRadius: 8 }}>
                <div className="muted small">{t('Current market valuation')}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-accent, #208b8b)', marginTop: 4 }}>
                  {compactEtb(tot.total_valuation)}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {t('Current active portfolio value')}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <Link to="/analytics" className="btn btn-small">
                {t('Open full analytics & depreciation models')} →
              </Link>
            </div>
          </section>
        </div>
      )}

      {/* MODALS */}
      {modal === 'valuation' && (
        <ValuationModal
          asset={preselectedAsset}
          onClose={handleModalClose}
          onSuccess={handleSuccess}
        />
      )}

      {modal === 'revenue' && (
        <RevenueModal
          asset={preselectedAsset}
          onClose={handleModalClose}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ Valuation Modal
/** What the server objected to: each field's problem, not only "Please correct the highlighted fields". */
const errorText = (err, fallback) => {
  const details = Object.values(err?.details || {}).filter(Boolean);
  return details.length ? details.map((d) => t(d)).join(' ') : (err?.message || t(fallback));
};
/** A money amount above zero with at most two decimals (birr and cents), or a message saying what is wrong. */
const amountProblem = (raw, what) => {
  const n = Number(raw);
  if (String(raw).trim() === '' || !Number.isFinite(n) || n <= 0) return t(`Please enter a valid positive ${what} amount.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return t('At most two decimals.');
  return null;
};
/** A date that has already come. */
const pastDateProblem = (d, label) => {
  if (!isValidCalendarDate(String(d))) return t('{label}: enter a valid date.', { label: t(label) });
  if (d > today()) return t('{label} cannot be in the future.', { label: t(label) });
  return null;
};

function ValuationModal({ asset, onClose, onSuccess }) {
  const todayStr = today();
  const [selectedAsset, setSelectedAsset] = useState(asset);
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [dateVal, setDateVal] = useState(todayStr);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Market Appraisal');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Search assets when typing
  useEffect(() => {
    if (selectedAsset) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await api.get(`/finance/assets-search?q=${encodeURIComponent(assetSearchQuery)}`);
        setSearchResults(list);
      } catch (e) {
        console.error(e);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [assetSearchQuery, selectedAsset]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAsset) {
      setError(t('Please select an asset.'));
      return;
    }
    const problem = pastDateProblem(dateVal, 'Valuation date') || amountProblem(amount, 'valuation')
      || (notes.trim().length > 2000 ? t('Maximum {n} characters.', { n: 2000 }) : null);
    if (problem) {
      setError(problem);
      return;
    }
    const valNum = Number(amount);
    setSaving(true);
    setError(null);
    try {
      await api.post('/finance/valuations', {
        asset_id: selectedAsset.id,
        valuation_date: dateVal,
        value: valNum,
        method: method || null,
        notes: notes || null,
      });
      onSuccess(t('Valuation of {code} recorded successfully.', { code: selectedAsset.asset_code }));
    } catch (err) {
      setError(errorText(err, 'Failed to record valuation.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={asset ? t('Record valuation for {code}', { code: asset.asset_code }) : t('Record asset valuation')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <Alert kind="error">{error}</Alert>}

        {/* Asset selection if not preset */}
        {!asset && (
          <div style={{ marginBottom: 16 }}>
            <label className="label">
              <strong>{t('Asset')}</strong> *
            </label>
            {selectedAsset ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--color-surface-subtle, rgba(255,255,255,0.05))', borderRadius: 6 }}>
                <div>
                  <strong>{selectedAsset.asset_code}</strong> · {selectedAsset.name}
                  {selectedAsset.category_name && <small className="muted"> ({selectedAsset.category_name})</small>}
                </div>
                <button type="button" className="btn btn-small" onClick={() => setSelectedAsset(null)}>
                  {t('Change')}
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="search"
                  className="input"
                  placeholder={t('Type asset code or name to search…')}
                  value={assetSearchQuery}
                  onChange={(e) => setAssetSearchQuery(e.target.value)}
                  style={{ width: '100%', marginBottom: 6 }}
                />
                {searching ? <Loading /> : searchResults.length > 0 ? (
                  <ul className="plain-list" style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 6, padding: 4 }}>
                    {searchResults.map((a) => (
                      <li key={a.id} style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => setSelectedAsset(a)}>
                        <span><strong>{a.asset_code}</strong> · {a.name}</span>
                        <span className="muted small">{a.category_name || ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">{t('Search for an asset in your jurisdiction.')}</p>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="label"><strong>{t('Valuation date')}</strong> *</label>
            <input
              type="date"
              className="input"
              value={dateVal}
              max={todayStr}
              onChange={(e) => setDateVal(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="label"><strong>{t('Valuation amount (ETB)')}</strong> *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              placeholder="e.g. 450000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label className="label"><strong>{t('Valuation method')}</strong></label>
          <select
            className="input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            style={{ width: '100%' }}
          >
            {VALUATION_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="label"><strong>{t('Notes & justification')}</strong></label>
          <textarea
            className="input"
            rows={3}
            placeholder={t('Enter appraisal details, inspection reference or basis for value adjustment…')}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div className="actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t('Saving…') : t('Save valuation')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ Revenue Modal
function RevenueModal({ asset, onClose, onSuccess }) {
  const todayStr = today();
  const [selectedAsset, setSelectedAsset] = useState(asset);
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [revType, setRevType] = useState('RENT');
  const [amount, setAmount] = useState('');
  const [receivedDate, setReceivedDate] = useState(todayStr);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [payer, setPayer] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Search assets when typing
  useEffect(() => {
    if (selectedAsset) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await api.get(`/finance/assets-search?q=${encodeURIComponent(assetSearchQuery)}`);
        setSearchResults(list);
      } catch (e) {
        console.error(e);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [assetSearchQuery, selectedAsset]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAsset) {
      setError(t('Please select an asset.'));
      return;
    }
    const problem = amountProblem(amount, 'revenue') || pastDateProblem(receivedDate, 'Received date')
      || (payer ? validateNameText(payer, { label: t('Payer / Counterparty') }) : null)
      || (reference.trim().length > 120 ? t('Maximum {n} characters.', { n: 120 }) : null)
      || (periodStart && !isValidCalendarDate(periodStart) ? t('Enter a valid date.') : null)
      || (periodEnd && !isValidCalendarDate(periodEnd) ? t('Enter a valid date.') : null)
      || (periodStart && periodEnd && periodEnd < periodStart ? t('The period end cannot be before its start.') : null)
      || (notes.trim().length > 2000 ? t('Maximum {n} characters.', { n: 2000 }) : null);
    if (problem) {
      setError(t(problem));
      return;
    }
    const amtNum = Number(amount);
    setSaving(true);
    setError(null);
    try {
      await api.post('/finance/revenues', {
        asset_id: selectedAsset.id,
        revenue_type: revType,
        amount: amtNum,
        received_date: receivedDate,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        payer: payer || null,
        reference: reference || null,
        notes: notes || null,
      });
      onSuccess(t('Revenue of {amt} ETB on {code} recorded.', { amt: amtNum, code: selectedAsset.asset_code }));
    } catch (err) {
      setError(errorText(err, 'Failed to record revenue.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={asset ? t('Record income for {code}', { code: asset.asset_code }) : t('Record municipal revenue')} onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        {error && <Alert kind="error">{error}</Alert>}

        {/* Asset selection if not preset */}
        {!asset && (
          <div style={{ marginBottom: 16 }}>
            <label className="label">
              <strong>{t('Asset')}</strong> *
            </label>
            {selectedAsset ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--color-surface-subtle, rgba(255,255,255,0.05))', borderRadius: 6 }}>
                <div>
                  <strong>{selectedAsset.asset_code}</strong> · {selectedAsset.name}
                  {selectedAsset.category_name && <small className="muted"> ({selectedAsset.category_name})</small>}
                </div>
                <button type="button" className="btn btn-small" onClick={() => setSelectedAsset(null)}>
                  {t('Change')}
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="search"
                  className="input"
                  placeholder={t('Type asset code or name to search…')}
                  value={assetSearchQuery}
                  onChange={(e) => setAssetSearchQuery(e.target.value)}
                  style={{ width: '100%', marginBottom: 6 }}
                />
                {searching ? <Loading /> : searchResults.length > 0 ? (
                  <ul className="plain-list" style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 6, padding: 4 }}>
                    {searchResults.map((a) => (
                      <li key={a.id} style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => setSelectedAsset(a)}>
                        <span><strong>{a.asset_code}</strong> · {a.name}</span>
                        <span className="muted small">{a.category_name || ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">{t('Search for an asset in your jurisdiction.')}</p>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="label"><strong>{t('Revenue type')}</strong> *</label>
            <select
              className="input"
              value={revType}
              onChange={(e) => setRevType(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="RENT">{t('Rent')}</option>
              <option value="LEASE">{t('Lease')}</option>
              <option value="FEE">{t('Fee / Concession')}</option>
              <option value="SALE">{t('Sale / Disposal')}</option>
              <option value="OTHER">{t('Other')}</option>
            </select>
          </div>

          <div>
            <label className="label"><strong>{t('Amount received (ETB)')}</strong> *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              placeholder="e.g. 25000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="label"><strong>{t('Received date')}</strong> *</label>
            <input
              type="date"
              className="input"
              value={receivedDate}
              max={todayStr}
              onChange={(e) => setReceivedDate(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="label"><strong>{t('Payer / Counterparty')}</strong></label>
            <input
              type="text"
              className="input"
              placeholder={t('Name of tenant, lessee or organization')}
              maxLength={200}
              value={payer}
              onChange={(e) => setPayer(e.target.value.replace(/[^\p{L}\p{M}\p{N}\s&/.,'’`()-]/gu, ''))}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="label"><strong>{t('Reference / Receipt no.')}</strong></label>
            <input
              type="text"
              className="input"
              placeholder="e.g. RCT-2026-0041"
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="label"><strong>{t('Period from (optional)')}</strong></label>
            <input
              type="date"
              className="input"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="label"><strong>{t('Period to (optional)')}</strong></label>
            <input
              type="date"
              className="input"
              value={periodEnd}
              min={periodStart || undefined}
              onChange={(e) => setPeriodEnd(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="label"><strong>{t('Notes')}</strong></label>
          <textarea
            className="input"
            rows={2}
            placeholder={t('Optional notes regarding this payment receipt…')}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div className="actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t('Saving…') : t('Record income')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
