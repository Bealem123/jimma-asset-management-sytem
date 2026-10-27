import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { date, label, today } from '../format.js';
import {
  Alert, Badge, FilterBar, FilterSearch, FilterSelect, Loading, PageHeader, Table, enumOpt, useAsync, useFilters,
} from '../components/ui.jsx';
import { t } from '../i18n.jsx';

export default function FollowUps() {
  const [f, setF, clear, any] = useFilters(['q', 'status', 'source_type', 'due']);
  const query = qs(f);
  const { data, error, loading } = useAsync(() => api.get(`/assets/follow-ups/open${query}`), [query]);
  return (
    <>
      <PageHeader title="Follow-up actions" subtitle="Things that must still be done after a failed inspection, a verification problem or a decision. Report them done from the asset page; the Inspector or the Kebele Administrator checks the work and closes them." />
      <FilterBar any={any} onClear={clear}>
        <FilterSearch id="fu-q" value={f.q} onChange={(v) => setF('q', v)} placeholder="Asset, task or person" />
        <FilterSelect id="fu-sta" text="Status" value={f.status} onChange={(v) => setF('status', v)} options={enumOpt(['OPEN', 'REPORTED'], { blank: 'Any status' })} />
        <FilterSelect id="fu-src" text="Source" value={f.source_type} onChange={(v) => setF('source_type', v)} options={enumOpt(['INSPECTION', 'VERIFICATION', 'MANUAL'], { blank: 'All sources' })} />
        <FilterSelect id="fu-due" text="Due" value={f.due} onChange={(v) => setF('due', v)}
          options={[{ value: '', label: 'Any time' }, { value: 'overdue', label: 'Overdue' }, { value: 'week', label: 'Due within 7 days' }, { value: 'none', label: 'No due date' }]} />
      </FilterBar>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <Table head={['Asset', 'What must be done', 'Due', 'Who', 'Source', 'Status']} empty={data.length === 0 && (any ? 'Nothing matches these filters.' : 'No open follow-up actions.')}>
          {data.map((a) => (
            <tr key={a.id}>
              <td><Link to={`/assets/${a.asset_id}`}>{a.asset_code}</Link><div className="muted small">{a.asset_name}</div></td>
              <td>{a.description}</td>
              <td className={a.due_date && a.due_date < today() ? 'text-bad' : undefined}>{a.due_date ? `${date(a.due_date)}${a.due_date < today() ? ` (${t('overdue')})` : ''}` : '—'}</td>
              <td>{a.assigned_to || '—'}</td><td>{label(a.source_type)}</td><td><Badge value={a.status} /></td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
