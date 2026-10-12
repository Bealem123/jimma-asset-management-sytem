import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { dateTime, label } from '../format.js';
import { Alert, Loading, PageHeader, Pagination, useAsync } from '../components/ui.jsx';
import { t } from '../i18n.jsx';

const PAGE_SIZE = 50;
const ENTITIES = ['asset', 'utilization', 'maintenance', 'inspection', 'transfer', 'valuation', 'document', 'user', 'assets', 'report', 'kebeles', 'sectors', 'departments', 'asset_categories', 'asset_types', 'kifle_ketemas'];

export default function Audit() {
  const [f, setF] = useState({ q: '', entity: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const query = qs({ ...f, page, page_size: PAGE_SIZE });
  const { data, error, loading } = useAsync(() => api.get(`/audit${query}`), [query]);
  const set = (k, v) => { setF({ ...f, [k]: v }); setPage(1); };

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every sign-in, change, approval, transfer and export. Entries cannot be edited or deleted." />
      <div className="filters" role="search">
        <div className="field grow"><label htmlFor="a-q">{t('Search')}</label><input id="a-q" type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder={t('Words in the description')} /></div>
        <div className="field"><label htmlFor="a-e">{t('Record type')}</label>
          <select id="a-e" value={f.entity} onChange={(e) => set('entity', e.target.value)}>
            <option value="">{t('All')}</option>{ENTITIES.map((e) => <option key={e} value={e}>{label(e)}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="a-f">{t('From')}</label><input id="a-f" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></div>
        <div className="field"><label htmlFor="a-t">{t('To')}</label><input id="a-t" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></div>
      </div>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <>
          <div className="table-wrap" aria-busy={loading}>
            <table>
              <thead><tr><th>{t('When')}</th><th>{t('User')}</th><th>{t('Action')}</th><th>{t('What happened')}</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateTime(r.created_at)}</td>
                    <td>{r.username || '—'}</td>
                    <td><span className="badge badge-neutral">{label(r.action)}</span></td>
                    <td>{r.asset_id ? <Link to={`/assets/${r.asset_id}`}>{t(r.summary)}</Link> : t(r.summary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <div className="empty">{t('No entries match.')}</div>}
          </div>
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
