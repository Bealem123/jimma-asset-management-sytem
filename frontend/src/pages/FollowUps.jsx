import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { date, label, today } from '../format.js';
import { Alert, Loading, PageHeader, Table, useAsync } from '../components/ui.jsx';

export default function FollowUps() {
  const { data, error, loading } = useAsync(() => api.get('/assets/follow-ups/open'), []);
  return (
    <>
      <PageHeader title="Follow-up actions" subtitle="Things that must still be done after a failed inspection, a verification problem or a decision. Close them from the asset page." />
      {loading ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <Table head={['Asset', 'What must be done', 'Due', 'Who', 'Source']} empty={data.length === 0 && 'No open follow-up actions.'}>
          {data.map((f) => (
            <tr key={f.id}>
              <td><Link to={`/assets/${f.asset_id}`}>{f.asset_code}</Link><div className="muted small">{f.asset_name}</div></td>
              <td>{f.description}</td>
              <td className={f.due_date && f.due_date < today() ? 'text-bad' : undefined}>{f.due_date ? `${date(f.due_date)}${f.due_date < today() ? ' (overdue)' : ''}` : '—'}</td>
              <td>{f.assigned_to || '—'}</td><td>{label(f.source_type)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
