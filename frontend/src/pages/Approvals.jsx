import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { date, dateTime, label } from '../format.js';
import {
  Alert, Badge, FilterBar, FilterDate, FilterSearch, FilterSelect, Loading, Modal, PageHeader, SpecForm, Table, Tabs, enumOpt, opt,
  useAsync, useFilters,
} from '../components/ui.jsx';
import { t } from '../i18n.jsx';

const QUEUES = [
  { state: 'SUBMITTED', title: 'Registrations to review', hint: 'Registered by the Sector Administrator. Check that the asset really exists at the recorded place, then verify it or send it back.' },
  { state: 'REVIEWED', title: 'Registrations to approve', hint: 'Verified by the Kebele Administrator. The Kifle Ketema Administrator approves or sends it back.' },
  { state: 'APPROVED', title: 'Registrations to activate', hint: 'Approved. Activating puts the asset into operation.' },
];

/** The latest on-site verification of a registration, in one cell: where, QR label, condition found. */
function SiteSummary({ a }) {
  if (!a.site_checked_at) return <span className="badge badge-warn">{t('No site evidence')}</span>;
  const far = Number(a.site_far) === 1;
  return (
    <div className="site-summary">
      {Number(a.site_location_saved) === 1 ? <span className="badge badge-info">{t('Location recorded on site')}</span>
        : <span className={`badge badge-${far ? 'bad' : 'good'}`}>{t('{n} m away', { n: a.site_distance_m })}</span>}
      <span className={`badge badge-${Number(a.site_qr_scanned) === 1 ? 'good' : 'warn'}`}>{Number(a.site_qr_scanned) === 1 ? t('QR scanned') : t('QR not scanned')}</span>
      {a.site_found_condition && a.site_found_condition !== a.condition && <span className="badge badge-warn">{t('Found {c}', { c: label(a.site_found_condition) })}</span>}
    </div>
  );
}

function AssetQueue({ state }) {
  const { user } = useAuth();
  const canVerify = can.review(user);
  const lk = useLookups();
  const queue = QUEUES.find((q) => q.state === state);
  const [f, setF, clear, any] = useFilters(['q', 'sector_id', 'kebele_id']);
  const query = qs({ ...f, approval_state: state, page_size: 100, sort: 'approval_state_at', dir: 'asc' });
  const { data, error, loading } = useAsync(() => api.get(`/assets${query}`), [query]);
  return (
    <>
      <p className="muted">{t(queue.hint)}</p>
      <FilterBar any={any} onClear={clear}>
        <FilterSearch id="aq-q" value={f.q} onChange={(v) => setF('q', v)} placeholder="Name or asset ID" />
        <FilterSelect id="aq-sec" text="Sector" value={f.sector_id} onChange={(v) => setF('sector_id', v)} options={opt(lk.sectors, undefined, { blank: 'All sectors' })} />
        <FilterSelect id="aq-keb" text="Kebele" value={f.kebele_id} onChange={(v) => setF('kebele_id', v)} options={opt(lk.kebeles.filter((k) => k.kifle_ketema_id), undefined, { blank: 'All' })} />
      </FilterBar>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <Table head={['Asset ID', 'Name', 'Sector', 'Location', ...(state === 'SUBMITTED' ? ['Status'] : ['Verified on site']), 'Waiting since', '']}
          empty={data.rows.length === 0 && (any ? t('Nothing matches these filters.') : t('Nothing waiting in “{queue}”.', { queue: t(queue.title) }))}>
          {data.rows.map((a) => (
            <tr key={a.id}>
              <td>{a.asset_code}</td><td>{a.name}</td><td>{a.sector_name}</td>
              <td>{a.kifle_ketema_name}{a.kebele_name ? ` / ${a.kebele_name}` : ''}</td>
              <td>{state === 'SUBMITTED' ? <Badge value={a.status} /> : <SiteSummary a={a} />}</td><td>{date(a.approval_state_at)}</td>
              <td>{state === 'SUBMITTED' && canVerify
                ? <Link className="btn btn-small btn-primary" to={`/assets/${a.id}?action=verify`}>{t('Verify on site')}</Link>
                : <Link className="btn btn-small" to={`/assets/${a.id}`}>{t('Open')}</Link>}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

const KINDS = { TRANSFER: 'Transfer', DISPOSAL: 'Disposal', RETIREMENT: 'Retirement', ASSIGNMENT: 'Assignment', OWNERSHIP_CHANGE: 'Ownership change' };

function Requests() {
  const lk = useLookups();
  const [scope, setScope] = useState('open');
  const [f, setF, clear, any] = useFilters(['q', 'type', 'status', 'from', 'to']);
  const [modal, setModal] = useState(null); // { request, action }
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');
  // "Waiting" already means pending or reviewed: the status filter belongs to the other views
  const query = qs({ ...f, status: scope === 'open' ? '' : f.status, open: scope === 'open' ? 1 : '', mine: scope === 'mine' ? 1 : '' });
  const { data, error, loading, reload } = useAsync(() => api.get(`/requests${query}`), [query]);

  async function act(request, action, comment) {
    setErr('');
    try {
      await api.post(`/requests/${request.id}/${action}`, comment ? { comment } : {});
      setFlash(`${KINDS[request.request_type]} request: ${action === 'review' ? 'reviewed' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'withdrawn'}.`);
      setModal(null);
      reload();
    } catch (e) { setErr(e.message); setModal(null); }
  }

  return (
    <>
      <p className="muted">{t('Transfers, disposals, retirements, assignments and ownership changes wait here.')} {t('The Sector Administrator asks, the Kebele Administrator reviews, and the Kifle Ketema Administrator gives the final approval.')} {t('The person who asked cannot approve their own request (and for two-step requests, the reviewer cannot also give the final approval).')}</p>
      <div className="actions" style={{ marginTop: 16, marginBottom: 12 }}>
        {[['open', 'Waiting'], ['mine', 'My requests'], ['all', 'All recent']].map(([k, text]) => (
          <button key={k} type="button" className={`btn btn-small${scope === k ? ' btn-primary' : ''}`} onClick={() => setScope(k)}>{t(text)}</button>
        ))}
      </div>
      <FilterBar any={any} onClear={clear}>
        <FilterSearch id="rq-q" value={f.q} onChange={(v) => setF('q', v)} placeholder="Asset name or ID" />
        <FilterSelect id="rq-type" text="Request" value={f.type} onChange={(v) => setF('type', v)}
          options={[{ value: '', label: 'All kinds' }, ...Object.entries(KINDS).map(([value, text]) => ({ value, label: text }))]} />
        {scope !== 'open' && <FilterSelect id="rq-sta" text="Status" value={f.status} onChange={(v) => setF('status', v)} options={enumOpt(lk.enums.request_statuses, { blank: 'Any status' })} />}
        <FilterDate id="rq-from" text="Asked from" value={f.from} onChange={(v) => setF('from', v)} />
        <FilterDate id="rq-to" text="Until" value={f.to} onChange={(v) => setF('to', v)} />
      </FilterBar>
      <Alert kind="success">{flash}</Alert>
      <Alert>{err}</Alert>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <Table head={['Asset', 'Request', 'By', 'Status', 'Steps', '']} empty={data.length === 0 && (any ? 'Nothing matches these filters.' : 'No requests here.')}>
          {data.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/assets/${r.asset_id}`}>{r.asset_code}</Link><div className="muted small">{r.asset_name}</div></td>
              <td><strong>{t(KINDS[r.request_type])}</strong><div className="small">{t(r.summary)}</div>{r.decision_note && <div className="muted small">{t('Note: {note}', { note: r.decision_note })}</div>}</td>
              <td>{r.requested_by_name}<div className="muted small">{dateTime(r.requested_at)}</div></td>
              <td>
                <Badge value={r.status} />
                {r.reviewed_by_name && <div className="muted small">{t('Reviewed by {name}', { name: r.reviewed_by_name })}</div>}
                {r.decided_by_name && <div className="muted small">{r.decided_by_name}</div>}
              </td>
              <td className="small">{r.steps === 2 ? t('Kebele review, then Kifle Ketema approval') : t('One approval')}</td>
              <td className="actions">
                {r.can_review && <button type="button" className="btn btn-small btn-primary" onClick={() => act(r, 'review')}>{t('Review')}</button>}
                {r.can_approve && <button type="button" className="btn btn-small btn-primary" onClick={() => act(r, 'approve')}>{t('Approve')}</button>}
                {r.can_reject && <button type="button" className="btn btn-small" onClick={() => setModal({ request: r })}>{t('Reject')}</button>}
                {r.can_cancel && <button type="button" className="btn btn-small" onClick={() => act(r, 'cancel')}>{t('Withdraw')}</button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {modal && (
        <Modal title="Reject request" onClose={() => setModal(null)}>
          <p>{t('{kind} for {code}: {summary}', { kind: t(KINDS[modal.request.request_type]), code: modal.request.asset_code, summary: t(modal.request.summary) })}</p>
          <SpecForm
            submitLabel="Reject" danger onCancel={() => setModal(null)}
            fields={[{ name: 'comment', label: 'Reason (the requester is told)', type: 'textarea', required: true, wide: true, maxLength: 500 }]}
            onSubmit={async (v) => act(modal.request, 'reject', v.comment)}
          />
        </Modal>
      )}
    </>
  );
}

export default function Approvals() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const dash = useAsync(() => api.get('/dashboard'), []);
  const byState = Object.fromEntries((dash.data?.by_approval_state || []).map((x) => [x.key, x.n]));
  const reqCount = dash.data?.totals?.pending_requests;

  const tabs = [
    ...(can.reviewRequests(user) || can.decide(user) || can.request(user) ? [['requests', 'Requests', reqCount]] : []),
    ...QUEUES.filter((q) => (q.state === 'SUBMITTED' ? can.review(user) || can.approve(user) : can.approve(user))).map((q) => [q.state, q.title, byState[q.state]]),
  ];

  const defaultTab = () => {
    const qTab = params.get('tab');
    if (qTab && tabs.some(([k]) => k === qTab)) return qTab;
    if (user?.role === 'KIFLE_ADMIN' && tabs.some(([k]) => k === 'REVIEWED')) return 'REVIEWED';
    if (user?.role === 'KEBELE_ADMIN' && tabs.some(([k]) => k === 'SUBMITTED')) return 'SUBMITTED';
    return tabs[0]?.[0] || 'requests';
  };

  const [tab, setTab] = useState(defaultTab);

  useEffect(() => {
    const qTab = params.get('tab');
    if (qTab && tabs.some(([k]) => k === qTab) && qTab !== tab) {
      setTab(qTab);
    }
  }, [params]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    setParams({ tab: nextTab }, { replace: true }); // each queue starts unfiltered
  };

  return (
    <>
      <PageHeader title="Approvals" subtitle="Nothing important changes on its own authority. Registrations and requests are approved by someone else." />
      <Tabs tabs={tabs} value={tab} onChange={selectTab} label="Approval queues" />
      {tab === 'requests' ? <Requests /> : <AssetQueue key={tab} state={tab} />}
    </>
  );
}
