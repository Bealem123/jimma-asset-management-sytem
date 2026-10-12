import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { dateTime, nowLocal } from '../format.js';
import {
  Alert, Badge, Loading, Modal, PageHeader, SpecForm, Table, Tabs, useAsync,
} from '../components/ui.jsx';
import { t } from '../i18n.jsx';

function Availability() {
  const [window_, setWindow] = useState({ start_at: nowLocal(), end_at: nowLocal() });
  const [applied, setApplied] = useState(null);
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState('');
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(
    () => (applied ? api.get(`/reservations/availability?start_at=${encodeURIComponent(applied.start_at)}&end_at=${encodeURIComponent(applied.end_at)}`) : Promise.resolve(null)),
    [applied],
  );
  return (
    <>
      <p className="muted">{t('Choose a time to see which shared assets (vehicles, equipment, halls) are free and which are reserved.')}</p>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setApplied(window_); }}>
        <div className="field"><label htmlFor="av-from">{t('From')}</label><input id="av-from" type="datetime-local" required value={window_.start_at} onChange={(e) => setWindow({ ...window_, start_at: e.target.value })} /></div>
        <div className="field"><label htmlFor="av-to">{t('Until')}</label><input id="av-to" type="datetime-local" required value={window_.end_at} onChange={(e) => setWindow({ ...window_, end_at: e.target.value })} /></div>
        <button type="submit" className="btn btn-primary">{t('Check availability')}</button>
      </form>
      <Alert kind="success">{flash}</Alert>
      {!applied ? null : loading ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <Table head={['Asset', 'Where', 'In this time', 'Reserved by others', '']} empty={data.length === 0 && 'No reservable assets in your area. An editor marks an asset as reservable in Edit asset.'}>
          {data.map((a) => (
            <tr key={a.id}>
              <td><Link to={`/assets/${a.id}`}>{a.asset_code}</Link> {a.name}</td>
              <td>{a.location_detail || '—'}</td>
              <td>{a.available ? <Badge value="ACTIVE" text="Available" /> : <Badge value="CANCELLED" text="Reserved" />}{a.pending_requests > 0 && <div className="muted small">{t('{n} request(s) waiting', { n: a.pending_requests })}</div>}</td>
              <td className="small">{a.reserved.map((r) => <div key={r.start_at}>{dateTime(r.start_at)} – {dateTime(r.end_at)}</div>)}{a.reserved.length === 0 && '—'}</td>
              <td>{can.reserve(user) && <button type="button" className="btn btn-small btn-primary" onClick={() => setModal(a)}>{t('Reserve')}</button>}</td>
            </tr>
          ))}
        </Table>
      )}
      {modal && (
        <Modal title={`Reserve ${modal.asset_code}`} onClose={() => setModal(null)}>
          <SpecForm
            submitLabel="Request reservation" onCancel={() => setModal(null)} initial={{ ...applied }}
            fields={[
              { name: 'start_at', label: 'From', type: 'datetime-local', required: true },
              { name: 'end_at', label: 'Until', type: 'datetime-local', required: true },
              { name: 'purpose', label: 'Purpose', required: true, wide: true },
            ]}
            onSubmit={async (v) => { await api.post('/reservations', { ...v, asset_id: modal.id }); setModal(null); setFlash('Reservation requested. An approver will decide.'); reload(); }}
          />
        </Modal>
      )}
    </>
  );
}

function List() {
  const [scope, setScope] = useState('open');
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const query = scope === 'mine' ? '?mine=1' : scope === 'open' ? '?status=PENDING' : '';
  const { data, error, loading, reload } = useAsync(() => api.get(`/reservations${query}`), [query]);

  async function act(r, action, body) {
    setErr('');
    try { await api.post(`/reservations/${r.id}/${action}`, body); setFlash(`Reservation ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled'}.`); setRejecting(null); reload(); } catch (e) { setErr(e.message); }
  }
  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}>
        {[['open', 'Waiting for a decision'], ['mine', 'My reservations'], ['all', 'All']].map(([k, text]) => (
          <button key={k} type="button" className={`btn btn-small${scope === k ? ' btn-primary' : ''}`} onClick={() => setScope(k)}>{t(text)}</button>
        ))}
      </div>
      <Alert kind="success">{flash}</Alert>
      <Alert>{err}</Alert>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <Table head={['Asset', 'From', 'Until', 'Requested by', 'Purpose', 'Status', '']} empty={data.length === 0 && 'No reservations.'}>
          {data.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/assets/${r.asset_id}`}>{r.asset_code}</Link><div className="muted small">{r.asset_name}</div></td>
              <td>{dateTime(r.start_at)}</td><td>{dateTime(r.end_at)}</td><td>{r.requester_name}</td><td>{r.purpose}</td>
              <td><Badge value={r.status} />{r.decision_note && <div className="muted small">{r.decision_note}</div>}</td>
              <td className="actions">
                {r.can_decide && <button type="button" className="btn btn-small btn-primary" onClick={() => act(r, 'approve')}>{t('Approve')}</button>}
                {r.can_decide && <button type="button" className="btn btn-small" onClick={() => setRejecting(r)}>{t('Reject')}</button>}
                {r.can_cancel && <button type="button" className="btn btn-small" onClick={() => act(r, 'cancel')}>{t('Cancel')}</button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {rejecting && (
        <Modal title="Reject reservation" onClose={() => setRejecting(null)}>
          <SpecForm
            submitLabel="Reject" danger onCancel={() => setRejecting(null)}
            fields={[{ name: 'comment', label: 'Reason', required: true, wide: true, type: 'textarea' }]}
            onSubmit={async (v) => act(rejecting, 'reject', { comment: v.comment })}
          />
        </Modal>
      )}
    </>
  );
}

export default function Reservations() {
  const [tab, setTab] = useState('list');
  return (
    <>
      <PageHeader title="Reservations" subtitle="Shared vehicles, equipment and halls. The same asset cannot be promised to two people at the same time." />
      <Tabs tabs={[['list', 'Reservations'], ['availability', 'Check availability']]} value={tab} onChange={setTab} label="Reservation views" />
      {tab === 'list' ? <List /> : <Availability />}
    </>
  );
}
