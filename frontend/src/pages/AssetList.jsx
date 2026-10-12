import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, download, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { label } from '../format.js';
import { Alert, Badge, Loading, PageHeader, Pagination, enumOpt, opt, useAsync } from '../components/ui.jsx';
import { t } from '../i18n.jsx';

const FILTER_KEYS = [
  'q', 'category_id', 'asset_type_id', 'sector_id', 'kifle_ketema_id', 'kebele_id', 'status', 'condition', 'approval_state',
  'ownership_type', 'revenue', 'serial_number', 'responsible', 'location', 'reservable', 'include_archived',
];
const MORE_KEYS = ['asset_type_id', 'ownership_type', 'serial_number', 'responsible', 'location', 'reservable', 'include_archived'];
const PAGE_SIZE = 25;

function Select({ id, text, value, onChange, options }) {
  return (
    <div className="field">
      <label htmlFor={id}>{t(text)}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
      </select>
    </div>
  );
}

function Text({ id, text, value, onChange, placeholder }) {
  return (
    <div className="field">
      <label htmlFor={id}>{t(text)}</label>
      <input id={id} type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function AssetList() {
  const { user } = useAuth();
  const lk = useLookups();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [exportError, setExportError] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const page = Number(params.get('page') || 1);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const [more, setMore] = useState(() => MORE_KEYS.some((k) => params.get(k)));
  const query = qs({ ...filters, page, page_size: PAGE_SIZE });

  const { data, error, loading } = useAsync(() => api.get(`/assets${query}`), [query]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'kifle_ketema_id') next.delete('kebele_id');
    if (key === 'category_id') next.delete('asset_type_id');
    next.delete('page');
    setParams(next, { replace: true });
  };
  const setPage = (p) => { const next = new URLSearchParams(params); next.set('page', p); setParams(next); };
  const anyFilter = FILTER_KEYS.some((k) => filters[k]);
  const kebeleOptions = lk.kebeles.filter((k) => !filters.kifle_ketema_id || String(k.kifle_ketema_id) === filters.kifle_ketema_id);

  async function exportCsv() {
    setExportError('');
    try { await download(`/assets/export.csv${qs(filters)}`, 'jimma-assets.csv'); } catch (e) { setExportError(e.message); }
  }
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rows = data?.rows || [];
  const allOnPage = rows.length > 0 && rows.every((r) => picked.has(r.id));

  return (
    <>
      <PageHeader title="Assets" subtitle="Everything the City owns or controls that you are allowed to see.">
        <Link to={`/map${qs(Object.fromEntries(['category_id', 'sector_id', 'kifle_ketema_id', 'kebele_id', 'status', 'condition'].map((k) => [k, filters[k]])))}`} className="btn">{t('View on map')}</Link>
        {can.exportAssets(user) && <button type="button" className="btn" onClick={exportCsv}>{t('Export CSV')}</button>}
        {can.importAssets(user) && <Link to="/import" className="btn">{t('Import')}</Link>}
        {can.create(user) && <Link to="/assets/new" className="btn btn-primary">{t('Register asset')}</Link>}
      </PageHeader>
      <Alert>{exportError}</Alert>

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field grow">
          <label htmlFor="f-q">{t('Search')}</label>
          <input id="f-q" type="search" placeholder={t('Name, asset ID, serial number, holder or location')} value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
        </div>
        <Select id="f-cat" text="Category" value={filters.category_id} onChange={(v) => setFilter('category_id', v)} options={opt(lk.categories, undefined, { blank: 'All categories' })} />
        <Select id="f-sec" text="Sector" value={filters.sector_id} onChange={(v) => setFilter('sector_id', v)} options={opt(lk.sectors, undefined, { blank: 'All sectors' })} />
        <Select id="f-kif" text="Kifle Ketema" value={filters.kifle_ketema_id} onChange={(v) => setFilter('kifle_ketema_id', v)} options={opt(lk.kifle, undefined, { blank: 'All' })} />
        <Select id="f-keb" text="Kebele" value={filters.kebele_id} onChange={(v) => setFilter('kebele_id', v)} options={opt(kebeleOptions, undefined, { blank: 'All' })} />
        <Select id="f-sta" text="Status" value={filters.status} onChange={(v) => setFilter('status', v)} options={enumOpt(lk.enums.statuses, { blank: 'Any status' })} />
        <Select id="f-con" text="Condition" value={filters.condition} onChange={(v) => setFilter('condition', v)} options={enumOpt(lk.enums.conditions, { blank: 'Any condition' })} />
        <Select id="f-app" text="Approval" value={filters.approval_state} onChange={(v) => setFilter('approval_state', v)} options={enumOpt(lk.enums.approval_states, { blank: 'Any' })} />
        <Select id="f-rev" text="Revenue" value={filters.revenue} onChange={(v) => setFilter('revenue', v)}
          options={[{ value: '', label: 'Any' }, { value: 'yes', label: 'Generating revenue' }, { value: 'no', label: 'Not generating revenue' }]} />
        <button type="button" className="btn" aria-expanded={more} onClick={() => setMore(!more)}>{more ? t('Fewer filters') : t('More filters')}</button>
        {anyFilter && <button type="button" className="btn" onClick={() => setParams({}, { replace: true })}>{t('Clear filters')}</button>}
      </form>
      {more && (
        <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('More filters')}>
          <Select id="f-typ" text="Type" value={filters.asset_type_id} onChange={(v) => setFilter('asset_type_id', v)}
            options={opt(lk.types.filter((ty) => !filters.category_id || String(ty.category_id) === filters.category_id), undefined, { blank: 'All types' })} />
          <Select id="f-own" text="Ownership" value={filters.ownership_type} onChange={(v) => setFilter('ownership_type', v)} options={enumOpt(lk.enums.ownership_types, { blank: 'Any' })} />
          <Text id="f-ser" text="Serial number" value={filters.serial_number} onChange={(v) => setFilter('serial_number', v)} />
          <Text id="f-res" text="Responsible person / office" value={filters.responsible} onChange={(v) => setFilter('responsible', v)} />
          <Text id="f-loc" text="Specific location" value={filters.location} onChange={(v) => setFilter('location', v)} />
          <Select id="f-rsv" text="Reservable" value={filters.reservable} onChange={(v) => setFilter('reservable', v)} options={[{ value: '', label: 'Any' }, { value: 'yes', label: 'Reservable only' }]} />
          <Select id="f-arc" text="Archived" value={filters.include_archived} onChange={(v) => setFilter('include_archived', v)} options={[{ value: '', label: 'Hide archived' }, { value: 'true', label: 'Include archived' }]} />
        </form>
      )}

      {picked.size > 0 && (
        <div className="alert alert-info actions" role="status">
          <span>{t('{n} selected', { n: picked.size })}</span>
          <button type="button" className="btn btn-small" onClick={() => navigate(`/labels?ids=${[...picked].join(',')}`)}>{t('Print QR labels')}</button>
          <button type="button" className="btn btn-small" onClick={() => setPicked(new Set())}>{t('Clear selection')}</button>
        </div>
      )}

      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <>
          <div className="table-wrap" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label={t('Select all assets on this page')} checked={allOnPage}
                    onChange={() => setPicked((s) => { const n = new Set(s); rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n; })} /></th>
                  <th>{t('Asset ID')}</th><th>{t('Name')}</th><th>{t('Category')}</th><th>{t('Sector')}</th><th>{t('Location')}</th><th>{t('Condition')}</th><th>{t('Status')}</th><th>{t('Approval')}</th><th>{t('Revenue')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td><input type="checkbox" aria-label={`Select ${a.asset_code}`} checked={picked.has(a.id)} onChange={() => toggle(a.id)} /></td>
                    <td><Link to={`/assets/${a.id}`}>{a.asset_code}</Link></td>
                    <td><Link to={`/assets/${a.id}`}>{a.name}</Link>{a.archived_at && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{t('Archived')}</span>}</td>
                    <td>{a.asset_type_name || a.category_name}</td>
                    <td>{a.sector_name}</td>
                    <td>{a.kifle_ketema_name}{a.kebele_name ? ` / ${a.kebele_name}` : ''}</td>
                    <td><Badge value={a.condition} /></td>
                    <td><Badge value={a.status} /></td>
                    <td><Badge value={a.approval_state} /></td>
                    <td>{a.generates_revenue ? t('Yes') : <span className="muted">{t('No')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <div className="empty">
                {anyFilter ? t('No assets match these filters.') : t('No assets to show yet.')}
                {!anyFilter && can.create(user) && <> <Link to="/assets/new">{t('Register the first asset')}</Link>.</>}
              </div>
            )}
          </div>
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          <p className="muted small">{t('Status and condition are different things: an asset can be')}{' '}<em>{label('ACTIVE')}</em>{' '}{t('but in')}{' '}<em>{label('POOR')}</em>{' '}{t('condition.')}</p>
        </>
      )}
    </>
  );
}
