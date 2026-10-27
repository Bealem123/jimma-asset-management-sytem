import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, download, fetchObjectUrl } from '../api.js';
import { sendOrQueue } from '../offline.js';
import { useLookups } from '../lookups.jsx';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { bytes, date, dateTime, etb, label, nowLocal, today } from '../format.js';
import {
  Alert, Badge, ConfirmDialog, Loading, Modal, PageHeader, Row, SpecForm, Table, Tabs, Empty, enumOpt, opt, useAsync,
} from '../components/ui.jsx';
import AuthImage from '../components/AuthImage.jsx';
import NavIcon from '../components/NavIcon.jsx';
import SiteCheck, { SiteEvidence } from '../components/SiteCheck.jsx';
import { t } from '../i18n.jsx';

const WORKFLOW_LABELS = {
  submit: 'Submit for review', review: 'Verify on site', approve: 'Approve', activate: 'Activate', reject: 'Send back to draft',
};
const STEPS = ['DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'ACTIVE'];
const REQUEST_TITLES = {
  TRANSFER: 'Transfer', DISPOSAL: 'Disposal', RETIREMENT: 'Retirement', ASSIGNMENT: 'Assignment', OWNERSHIP_CHANGE: 'Ownership change',
};
const place = (kifle, kebele, detail) => (
  <>{kifle}{kebele ? ` / ${kebele}` : ''}{detail && <div className="muted small">{detail}</div>}</>
);

// files a browser can show in a tab; the rest (Word, Excel) are downloaded
const VIEWABLE = /^(application\/pdf|image\/)/;

export default function AssetDetail() {
  const { id } = useParams();
  const lk = useLookups();
  const { user: me } = useAuth();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api.get(`/assets/${id}`), [id]);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState('');
  const [actionError, setActionError] = useState('');

  // arrive from the scanner ready to inspect
  useEffect(() => {
    if (data && search.get('action') === 'verify' && data.permissions.workflow.includes('review')) {
      setModal('sitecheck');
      setSearch({}, { replace: true });
    }
    if (data && search.get('action') === 'inspect' && data.permissions.can_inspect) {
      setTab('maintenance');
      setModal('inspection');
      setSearch({}, { replace: true });
    }
  }, [data, search, setSearch]);

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const {
    asset: a, utilizations, maintenance, inspections, transfers, documents, valuations, history, permissions: perm,
    acquisition, assignments, ownership_history: ownership, disposals, follow_ups: followUps, revenues, reservations, requests, depreciation: dep,
    site_checks: siteChecks = [], site_check_max_distance_m: maxDistance = 50, site_check_max_accuracy_m: maxAccuracy = 50,
  } = data;
  const path = `/assets/${id}`;
  const close = () => setModal(null);
  const done = (message) => async () => { close(); setFlash(message); setActionError(''); reload(); };
  const m = (kind) => modal === kind;
  const money = perm.can_view_financial;
  const openRequests = requests.filter((r) => ['PENDING', 'REVIEWED'].includes(r.status));
  const photos = documents.filter((d) => d.doc_type === 'PHOTO');
  // what the asset's sector records about it, in the order of the sector's form
  const sectorRows = (lk.enums.sector_fields?.[a.sector_code] || [])
    .filter((f) => a.details?.[f.key] != null && a.details[f.key] !== '')
    .map((f) => {
      const v = a.details[f.key];
      const text = f.type === 'number' ? `${Number(v).toLocaleString('en-US')}${f.unit ? ` ${f.unit}` : ''}`
        : f.type === 'date' ? date(v) : f.type === 'select' ? t(v) : v;
      return [f, text];
    });

  const tabs = [
    ['overview', 'Overview'], ['use', 'Use & revenue'], ['maintenance', 'Maintenance & inspections'], ['transfers', 'Location & transfers'],
    ['responsibility', 'Responsibility'], ['acquisition', 'Acquisition'], ['documents', 'Documents & photos'],
    ...(money ? [['financial', 'Financial']] : []),
    ['requests', `Requests & reservations${openRequests.length ? ` (${openRequests.length})` : ''}`], ['history', 'History'],
  ];

  async function workflow(action) {
    setActionError('');
    setFlash('');
    try {
      await api.post(`${path}/workflow`, { action });
      setFlash(t('{what}: done.', { what: t(WORKFLOW_LABELS[action]) }));
      reload();
    } catch (e) { setActionError(Object.values(e.details || {})[0] || e.message); } // say what is missing, e.g. the photo
  }
  async function act(fn, message) {
    setActionError('');
    try { await fn(); setFlash(message); reload(); } catch (e) { setActionError(e.message); }
  }
  /** Open a PDF or photo in a new tab. The tab opens at the click (so it is not blocked), the file follows. */
  async function viewDocument(d) {
    setActionError('');
    const tab = window.open('', '_blank');
    try {
      const url = await fetchObjectUrl(`${path}/documents/${d.id}/download`);
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch (e) {
      tab?.close();
      setActionError(e.message);
    }
  }
  /** Save a request: either done at once (201) or waiting for an approver (202). */
  const requestDone = (okMessage) => async (res) => {
    close();
    setFlash(res?.pending ? 'Sent for approval. The asset will change when an approver approves it.' : okMessage);
    setActionError('');
    reload();
  };

  const currentStep = STEPS.indexOf(a.approval_state);
  const activeSectors = lk.activeOnly(lk.sectors);
  const kebeleKifle = (kid) => lk.kebeles.find((k) => String(k.id) === String(kid))?.kifle_ketema_id;
  const usable = lk.enums.statuses.filter((s) => s !== a.status && !['DISPOSED', 'RETIRED'].includes(s));
  const currentAssignment = assignments.find((x) => x.status === 'ACTIVE');
  const myUnlinked = lk.kebeles.filter((k) => !k.kifle_ketema_id);
  const linked = (rows) => rows.filter((k) => k.kifle_ketema_id);
  // Where this person may move the asset: only places inside their own area (the server applies the same rule).
  // A Sector Administrator works in one sector inside one Kebele. A Kebele Administrator sends assets on to any
  // Kebele of its own Kifle Ketema; the Kifle Ketema Administrator approves.
  const scope = me.scope || { kifle: [], kebeles: [], sectors: [] };
  const everywhere = can.citywide(me);
  const kebeleAdmin = !everywhere && me.role === 'KEBELE_ADMIN';
  const kebeleBound = kebeleAdmin || (!everywhere && me.role === 'SECTOR_ADMIN' && scope.kebeles.length > 0);
  const sectorBound = !everywhere && me.role === 'SECTOR_ADMIN';
  const homeKifle = lk.kebeles.filter((k) => scope.kebeles.includes(k.id)).map((k) => k.kifle_ketema_id);
  const toKebeles = linked(lk.activeOnly(lk.kebeles)).filter((k) => everywhere
    || (kebeleAdmin ? homeKifle.includes(k.kifle_ketema_id)
      : kebeleBound ? scope.kebeles.includes(k.id) : me.role === 'KIFLE_ADMIN' ? scope.kifle.includes(k.kifle_ketema_id) : true));
  const toKifle = lk.activeOnly(lk.kifle).filter((k) => everywhere
    || (kebeleBound ? toKebeles.some((b) => b.kifle_ketema_id === k.id) : me.role === 'KIFLE_ADMIN' ? scope.kifle.includes(k.id) : true));
  const only = (rows) => (rows.length === 1 ? String(rows[0].id) : '');

  return (
    <>
      <PageHeader title={a.name} subtitle={`${a.asset_code} · ${a.asset_type_name || a.category_name} · ${a.kifle_ketema_name}${a.kebele_name ? ` / ${a.kebele_name}` : ''}`}>
        {perm.can_edit && <Link className="btn" to={`${path}/edit`}>{t('Edit')}</Link>}
        {perm.can_edit && <button type="button" className="btn" onClick={() => setModal('status')}>{t('Change status')}</button>}
        {perm.can_request && <button type="button" className="btn" onClick={() => setModal('transfer')}>{t('Transfer')}</button>}
        {perm.can_request && <button type="button" className="btn" onClick={() => setModal('assign')}>{t('Assign')}</button>}
        {perm.can_request && <button type="button" className="btn" onClick={() => setModal('ownership')}>{t('Change owner')}</button>}
        {perm.can_request && <button type="button" className="btn" onClick={() => setModal('dispose')}>{t('Retire / dispose')}</button>}
        {!!perm.can_reserve && <button type="button" className="btn" onClick={() => setModal('reserve')}>{t('Reserve')}</button>}
        <Link className="btn" to={`/labels?ids=${a.id}`}>{t('QR label')}</Link>
      </PageHeader>

      <Alert kind="success">{flash}</Alert>
      <Alert>{actionError}</Alert>
      {a.approval_state === 'DRAFT' && perm.workflow.includes('submit') && (
        <Alert kind="warn">
          {t('This asset is still a draft. The Kebele Administrator cannot see it until you press Submit for review.')}
          {!photos.length && <>{' '}<strong>{t('Add a photo of the asset first')}</strong>{' '}<button type="button" className="linklike" onClick={() => setModal('document')}>{t('Upload a photo')}</button></>}
        </Alert>
      )}
      {perm.locked && <Alert kind="warn">{t('This asset was disposed on {date}. Its record is locked and kept for the history.', { date: date(a.disposed_at) })}{a.archived_at ? ` ${t('It is archived.')}` : ''}</Alert>}
      {a.status === 'RETIRED' && !perm.locked && <Alert kind="warn">{t('This asset is retired. It can only be disposed of.')}</Alert>}
      {openRequests.length > 0 && (
        <Alert kind="info">
          {openRequests.map((r) => t('{kind} request waiting ({status})', { kind: t(REQUEST_TITLES[r.request_type] || r.request_type), status: label(r.status) })).join(' · ')}.{' '}
          <button type="button" className="linklike" onClick={() => setTab('requests')}>{t('See requests')}</button>
        </Alert>
      )}

      <section className="card asset-head">
        {photos.length > 0 && (
          <button type="button" className="asset-head-photo" onClick={() => setTab('documents')} title={t('Documents & photos')}>
            <AuthImage key={photos[0].id} path={`${path}/photo?v=${photos[0].id}`} alt={t('Photo of {name}', { name: a.name })} width={96} />
          </button>
        )}
        <div className="asset-head-main">
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <dl className="asset-facts">
            <div><dt>{t('Status')}</dt><dd><Badge value={a.status} /></dd></div>
            <div><dt>{t('Condition')}</dt><dd><Badge value={a.condition} /></dd></div>
            <div><dt>{t('Revenue')}</dt><dd>{a.generates_revenue ? <Badge value="GOOD" text="Generating revenue now" /> : <Badge value="DRAFT" text="No revenue use" />}</dd></div>
            {a.is_reservable ? <div><dt>{t('Reservation')}</dt><dd><Badge value="PENDING" text="Reservable" /></dd></div> : null}
          </dl>
          <div className="actions">
            {perm.workflow.filter((w) => w !== 'reject').map((w) => (
              <button key={w} type="button" className="btn btn-primary" onClick={() => (w === 'review' ? setModal('sitecheck') : workflow(w))}>{t(WORKFLOW_LABELS[w])}</button>
            ))}
            {perm.workflow.includes('reject') && <button type="button" className="btn" onClick={() => setModal('reject')}>{t(WORKFLOW_LABELS.reject)}</button>}
          </div>
        </div>
        <p className="workflow-title">{t('Approval progress')}</p>
        <ol className="workflow" aria-label={t('Approval progress')} style={{ listStyle: 'none', padding: 0 }}>
          {STEPS.map((s, i) => (
            <li key={s} data-step={s} className={`step${i < currentStep ? ' done' : ''}${i === currentStep ? ' current' : ''}`} aria-current={i === currentStep ? 'step' : undefined}>{label(s)}</li>
          ))}
        </ol>
        </div>
      </section>

      <SiteEvidence checks={siteChecks} assetPath={path} maxDistance={maxDistance} recordedCondition={a.condition} />

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Asset sections" />

      {tab === 'overview' && (
        <div className="grid grid-2">
          <section className="card">
            <h2>{t('Identity')}</h2>
            <dl className="dl">
              <Row term="Asset ID">{a.asset_code}</Row>
              <Row term="Category">{a.category_name}</Row>
              <Row term="Type">{a.asset_type_name}</Row>
              <Row term="Function / use">{a.function_use}</Row>
              <Row term="Serial number">{a.serial_number}</Row>
              <Row term="Registration number">{a.registration_number}</Row>
              <Row term="Responsible sector">{a.sector_name}</Row>
              <Row term="Description">{a.description}</Row>
            </dl>
          </section>
          {sectorRows.length > 0 && (
            <section className="card">
              <h2>{t('{sector} details', { sector: t(a.sector_name) })}</h2>
              <dl className="dl">
                {sectorRows.map(([f, v]) => <Row key={f.key} term={f.label}>{v}</Row>)}
              </dl>
            </section>
          )}
          <section className="card">
            <h2>{t('Location')}</h2>
            <dl className="dl">
              <Row term="Kifle Ketema">{a.kifle_ketema_name}</Row>
              <Row term="Kebele">{a.kebele_name}</Row>
              <Row term="Building / facility / place">{a.location_detail}</Row>
              <Row term="GPS coordinates">{a.latitude != null && a.longitude != null ? <>{a.latitude}, {a.longitude} · <Link to={`/map?focus=${a.id}`}>{t('show on map')}</Link></> : t('Not recorded')}</Row>
            </dl>
          </section>
          <section className="card">
            <h2>{t('Ownership and responsibility')}</h2>
            <dl className="dl">
              <Row term="Ownership">{label(a.ownership_type)}</Row>
              <Row term="Legal owner">{a.owner_name}</Row>
              <Row term="Responsible office">{a.responsible_office}</Row>
              <Row term="Responsible officer">{a.responsible_officer}</Row>
              <Row term="Current user / holder">{a.current_holder || t('Not recorded')}</Row>
            </dl>
          </section>
          <section className="card">
            <h2>{t('QR code')}</h2>
            <div className="qr-block">
              <AuthImage path={`${path}/qr.svg`} alt={`QR code for ${a.asset_code}`} width={140} />
              <div>
                <p className="muted small" style={{ marginTop: 0 }}>{t("Print it and fix it to the asset. Any phone camera that scans it opens the asset's public card, with its photos and without money or personal details. In this system's scanner it opens this full record, for inspections and physical verification.")}</p>
                <Link className="btn btn-small" to={`/labels?ids=${a.id}`}>{t('Print label')}</Link>{' '}
                <Link className="btn btn-small" to="/scan">{t('Open scanner')}</Link>{' '}
                {perm.can_edit && <button type="button" className="btn btn-small" onClick={() => setModal('label')}>{t('Replace label')}</button>}
              </div>
            </div>
          </section>
          {money && (
            <section className="card">
              <h2>{t('Money')}</h2>
              <dl className="dl">
                <Row term="Acquired">{a.acquisition_date ? date(a.acquisition_date) : null}</Row>
                <Row term="Acquisition cost">{a.acquisition_cost != null ? etb(a.acquisition_cost) : null}</Row>
                <Row term="Current valuation">{a.current_valuation != null ? `${etb(a.current_valuation)} (${date(a.valuation_date)})` : t('Not valued')}</Row>
                <Row term="Book value (depreciated)">{dep ? etb(dep.book_value) : null}</Row>
                <Row term="Maintenance spending">{etb(a.total_maintenance_cost)}</Row>
                <Row term="Revenue recorded">{a.total_revenue ? etb(a.total_revenue) : null}</Row>
              </dl>
            </section>
          )}
        </div>
      )}

      {tab === 'use' && (
        <section>
          <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <p className="muted" style={{ margin: 0 }}>{t('How the asset is used, and whether that use generates revenue. An asset may have no revenue use at all.')}</p>
            {perm.can_edit && <button type="button" className="btn btn-primary" onClick={() => setModal('use')}>{t('Record use')}</button>}
          </div>
          <Table head={['Use', 'Used by', 'From', 'To', 'Revenue', 'Authorisation', '']} empty={utilizations.length === 0 && 'No use recorded yet.'}>
            {utilizations.map((u) => (
              <tr key={u.id}>
                <td>{label(u.use_type)}{u.purpose && <div className="muted small">{u.purpose}</div>}</td>
                <td>{u.user_party || '—'}</td>
                <td>{date(u.start_date)}</td>
                <td>{u.end_date ? date(u.end_date) : <Badge value="ACTIVE" text="Current" />}</td>
                <td>{u.generates_revenue ? `Yes${u.revenue_sector_name ? ` · ${u.revenue_sector_name}` : ''}` : 'No'}</td>
                <td>{u.authorization_basis || '—'}</td>
                <td>{perm.can_edit && !u.end_date && <button type="button" className="btn btn-small" onClick={() => setModal({ endUse: u })}>{t('End use')}</button>}</td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      {tab === 'maintenance' && (
        <>
          <section>
            <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{t('Maintenance')}</h2>
              {perm.can_maintain && <button type="button" className="btn btn-primary" onClick={() => setModal('maintenance')}>{t('Record maintenance')}</button>}
            </div>
            <Table head={['Date', 'Work', 'Status', 'Cost', 'Provider', 'Next due', '']} empty={maintenance.length === 0 && 'No maintenance recorded.'}>
              {maintenance.map((r) => (
                <tr key={r.id}>
                  <td>{date(r.maintenance_date)}</td>
                  <td>{r.maintenance_type} <span className="muted small">({label(r.kind)})</span>{r.description && <div className="muted small">{r.description}</div>}</td>
                  <td><Badge value={r.status} /></td>
                  <td className="num">{r.cost != null ? etb(r.cost) : '—'}</td>
                  <td>{r.provider || '—'}</td>
                  <td>{date(r.next_maintenance_date)}</td>
                  <td>{perm.can_maintain && ['PLANNED', 'IN_PROGRESS'].includes(r.status) && <button type="button" className="btn btn-small" onClick={() => setModal({ maintJob: r })}>{t('Update')}</button>}</td>
                </tr>
              ))}
            </Table>
          </section>
          <section style={{ marginTop: 24 }}>
            <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{t('Inspections')}</h2>
              {perm.can_inspect && <button type="button" className="btn btn-primary" onClick={() => setModal('inspection')}>{t('Record inspection')}</button>}
            </div>
            <Table head={['Date', 'Inspector', 'Result', 'Condition found', 'Notes', 'Next inspection']} empty={inspections.length === 0 && 'No inspections recorded.'}>
              {inspections.map((r) => (
                <tr key={r.id}>
                  <td>{date(r.inspection_date)}{r.method === 'SCAN' && <div className="muted small">{t('QR scan')}</div>}</td><td>{r.inspector}</td>
                  <td><Badge value={r.result} /></td><td><Badge value={r.condition_found} /></td>
                  <td>{r.notes || '—'}</td><td>{date(r.next_inspection_date)}</td>
                </tr>
              ))}
            </Table>
            <p className="muted small">{t('An inspection updates the asset\'s condition; the earlier condition stays in the History. A failed inspection creates a follow-up action.')}</p>
          </section>
          <section style={{ marginTop: 24 }}>
            <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{t('Follow-up actions')}</h2>
              {(perm.can_edit || perm.can_inspect) && <button type="button" className="btn" onClick={() => setModal('followup')}>{t('Add follow-up')}</button>}
            </div>
            <Table head={['Action', 'Due', 'Status', 'Source', '']} empty={followUps.length === 0 && 'No follow-up actions.'}>
              {followUps.map((f) => (
                <tr key={f.id}>
                  <td>{f.description}{f.resolution && <div className="muted small">{t('Done: {what}', { what: f.resolution })}</div>}</td>
                  <td>{date(f.due_date)}</td><td><Badge value={f.status} /></td><td>{label(f.source_type)}</td>
                  <td className="actions">
                    {/* the keeper reports the work done; the Inspector or the Kebele Administrator checks it (a note of its own it closes itself) */}
                    {f.status === 'OPEN' && (perm.can_check_follow_ups
                      ? <button type="button" className="btn btn-small" onClick={() => setModal({ closeFollowUp: f })}>{t('Mark done')}</button>
                      : perm.can_edit && <button type="button" className="btn btn-small" onClick={() => setModal({ closeFollowUp: f, report: f.source_type !== 'MANUAL' || f.created_by !== me.id })}>{t(f.source_type !== 'MANUAL' || f.created_by !== me.id ? 'Report done' : 'Mark done')}</button>)}
                    {f.status === 'REPORTED' && (perm.can_check_follow_ups ? (
                      <>
                        <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => api.post(`${path}/follow-ups/${f.id}/close`, {}), 'Follow-up checked and closed.')}>{t('Confirm done')}</button>
                        <button type="button" className="btn btn-small" onClick={() => setModal({ reopenFollowUp: f })}>{t('Send back')}</button>
                      </>
                    ) : <span className="muted small">{t('Waiting for a check')}</span>)}
                  </td>
                </tr>
              ))}
            </Table>
          </section>
        </>
      )}

      {tab === 'transfers' && (
        <section>
          <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <p className="muted" style={{ margin: 0 }}>{t('A transfer never overwrites the old location or sector. Both are kept. Transfers normally need approval.')}</p>
            {perm.can_request && <button type="button" className="btn btn-primary" onClick={() => setModal('transfer')}>{t('Request transfer')}</button>}
          </div>
          <Table head={['Date', 'From', 'To', 'Reason', 'Authorised by']} empty={transfers.length === 0 && 'This asset has never been transferred.'}>
            {transfers.map((tx) => (
              <tr key={tx.id}>
                <td>{date(tx.transfer_date)}</td>
                <td>{place(tx.from_kifle_ketema_name, tx.from_kebele_name, tx.from_location_detail)}</td>
                <td>{place(tx.to_kifle_ketema_name, tx.to_kebele_name, tx.to_location_detail)}</td>
                <td>{tx.reason}</td><td>{tx.authorized_by}</td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      {tab === 'responsibility' && (
        <>
          <section className="card">
            <h2>{t('Who is responsible now')}</h2>
            <dl className="dl">
              <Row term="Legal owner">{a.owner_name} <span className="muted small">({label(a.ownership_type)})</span></Row>
              <Row term="Responsible sector">{a.sector_name}</Row>
              <Row term="Responsible office">{a.responsible_office}</Row>
              <Row term="Responsible officer">{a.responsible_officer}</Row>
              <Row term="Current holder / user">{a.current_holder || t('Not recorded')}</Row>
              <Row term="Assigned since">{currentAssignment ? `${date(currentAssignment.assigned_date)} (${currentAssignment.reason})` : null}</Row>
            </dl>
            <p className="muted small">{t('Owner, responsible sector and current holder are three different things: for example, the City owns a vehicle, the Transportation sector is responsible for it, and a driver holds it today.')}</p>
          </section>
          <section style={{ marginTop: 16 }}>
            <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{t('Assignment history')}</h2>
              {perm.can_request && <button type="button" className="btn btn-primary" onClick={() => setModal('assign')}>{t('Assign')}</button>}
            </div>
            <Table head={['From', 'To', 'Sector', 'Office / officer', 'Holder', 'Reason', 'Status']} empty={assignments.length === 0 && 'No assignment recorded yet.'}>
              {assignments.map((x) => (
                <tr key={x.id}>
                  <td>{date(x.assigned_date)}</td><td>{x.ended_date ? date(x.ended_date) : '—'}</td>
                  <td>{x.sector_name}</td>
                  <td>{x.office || '—'}{x.responsible_officer && <div className="muted small">{x.responsible_officer}</div>}</td>
                  <td>{x.holder || '—'}</td><td>{x.reason}</td><td><Badge value={x.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT'} text={label(x.status)} /></td>
                </tr>
              ))}
            </Table>
          </section>
          <section style={{ marginTop: 24 }}>
            <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{t('Ownership changes')}</h2>
              {perm.can_request && <button type="button" className="btn" onClick={() => setModal('ownership')}>{t('Record ownership change')}</button>}
            </div>
            <Table head={['Effective', 'Previous owner', 'New owner', 'Legal basis']} empty={ownership.length === 0 && 'The owner has not changed.'}>
              {ownership.map((o) => (
                <tr key={o.id}>
                  <td>{date(o.effective_date)}</td><td>{o.previous_owner} <span className="muted small">({label(o.previous_type)})</span></td>
                  <td>{o.new_owner} <span className="muted small">({label(o.new_type)})</span></td><td>{o.basis}</td>
                </tr>
              ))}
            </Table>
          </section>
        </>
      )}

      {tab === 'acquisition' && (
        <section>
          <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <p className="muted" style={{ margin: 0 }}>{t('How the City obtained this asset, from whom, and who approved it. Purchase documents, contracts and invoices belong under Documents.')}</p>
            {perm.can_edit && <button type="button" className="btn btn-primary" onClick={() => setModal('acquisition')}>{acquisition ? t('Edit acquisition') : t('Record acquisition')}</button>}
          </div>
          {!acquisition ? <div className="card empty">{t('The acquisition has not been recorded.')}</div> : (
            <div className="card">
              <dl className="dl">
                <Row term="Method">{label(acquisition.method)}</Row>
                <Row term="Date">{acquisition.acquisition_date ? date(acquisition.acquisition_date) : null}</Row>
                <Row term="Cost">{acquisition.cost != null ? etb(acquisition.cost) : null}</Row>
                <Row term="Supplier / vendor / donor">{acquisition.supplier_name}</Row>
                <Row term="Supplier contact">{acquisition.supplier_contact}</Row>
                <Row term="Procurement reference">{acquisition.procurement_ref}</Row>
                <Row term="Contract">{acquisition.contract_ref}</Row>
                <Row term="Invoice">{acquisition.invoice_ref}</Row>
                <Row term="Approval (decision / minute)">{acquisition.approval_ref}</Row>
                <Row term="Approved by">{acquisition.approved_by_name}{acquisition.approved_on ? `, ${date(acquisition.approved_on)}` : ''}</Row>
                <Row term="Notes">{acquisition.notes}</Row>
              </dl>
            </div>
          )}
        </section>
      )}

      {tab === 'documents' && (
        <section>
          <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <p className="muted" style={{ margin: 0 }}>{t('Photos, ownership papers, contracts, inspection evidence and other supporting files (PDF, JPG, PNG, Word, Excel; up to 10 MB). Every upload and download is recorded.')}</p>
            {(perm.can_edit || perm.can_maintain || perm.can_inspect) && <button type="button" className="btn btn-primary" onClick={() => setModal('document')}>{t('Upload file')}</button>}
          </div>
          <Table head={['Title', 'Type', 'Belongs to', 'File', 'Size', 'Uploaded', '']} empty={documents.length === 0 && 'No documents or photos yet.'}>
            {documents.map((d) => (
              <tr key={d.id}>
                <td>{d.title}{d.expires_on && <div className={`small ${d.expires_on < today() ? 'text-bad' : 'muted'}`}>{d.expires_on < today() ? t('Expired') : t('Expires')} {date(d.expires_on)}</div>}</td>
                <td>{label(d.doc_type)}</td><td>{d.related_type ? label(d.related_type) : '—'}</td><td>{d.original_name}</td><td>{bytes(d.size_bytes)}</td>
                <td>{dateTime(d.uploaded_at)}{d.uploaded_by_name && <div className="muted small">{d.uploaded_by_name}</div>}</td>
                <td>
                  {/* a PDF or a photo opens in the browser; every file can be downloaded; its keeper corrects or removes it */}
                  <div className="actions row-actions">
                    {VIEWABLE.test(d.mime_type || '') && (
                      <button type="button" className="btn btn-small btn-icon-only" title={t('View')} aria-label={`${t('View')} ${d.title}`} onClick={() => viewDocument(d)}><NavIcon name="eye" /></button>
                    )}
                    <button type="button" className="btn btn-small btn-icon-only" title={t('Download')} aria-label={`${t('Download')} ${d.title}`}
                      onClick={() => act(() => download(`${path}/documents/${d.id}/download`, d.original_name), 'Download started.')}><NavIcon name="download" /></button>
                    {perm.can_edit && (
                      <button type="button" className="btn btn-small btn-icon-only" title={t('Edit')} aria-label={`${t('Edit')} ${d.title}`} onClick={() => setModal({ editDocument: d })}><NavIcon name="edit" /></button>
                    )}
                    {perm.can_edit && (
                      <button type="button" className="btn btn-small btn-cancel btn-icon-only" title={t('Remove')} aria-label={`${t('Remove')} ${d.title}`} onClick={() => setModal({ removeDocument: d })}><NavIcon name="trash" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      {tab === 'financial' && money && (
        <section>
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <dl className="dl card">
              <dt>{t('Acquisition cost')}</dt><dd>{a.acquisition_cost != null ? etb(a.acquisition_cost) : '—'}</dd>
              <dt>{t('Current valuation')}</dt><dd>{a.current_valuation != null ? `${etb(a.current_valuation)} as of ${date(a.valuation_date)}` : t('Not valued')}</dd>
              <dt>{t('Maintenance spending')}</dt><dd>{etb(a.total_maintenance_cost)}</dd>
              <dt>{t('Revenue recorded')}</dt><dd>{etb(a.total_revenue || 0)}</dd>
            </dl>
            <div className="card">
              <h3>{t('Depreciation')}</h3>
              {dep ? (
                <dl className="dl">
                  <dt>{t('Method')}</dt><dd>{label(dep.method)}</dd>
                  <dt>{t('Per year')}</dt><dd>{etb(dep.annual)}</dd>
                  <dt>{t('Years in service')}</dt><dd>{t('{a} of {b}', { a: dep.years_elapsed, b: a.useful_life_years })}</dd>
                  <dt>{t('Accumulated')}</dt><dd>{etb(dep.accumulated)}</dd>
                  <dt>{t('Book value now')}</dt><dd><strong>{etb(dep.book_value)}</strong>{dep.fully_depreciated && <> <Badge value="POOR" text="Fully depreciated" /></>}</dd>
                </dl>
              ) : <p className="muted">{t('Enter the acquisition date, cost and useful life (Edit asset) to calculate depreciation.')}</p>}
            </div>
          </div>
          <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{t('Valuation history')}</h2>
            {perm.can_edit_financial && <button type="button" className="btn btn-primary" onClick={() => setModal('valuation')}>{t('Add valuation')}</button>}
          </div>
          <Table head={['Date', 'Value', 'Method', 'Notes']} empty={valuations.length === 0 && 'No valuations recorded.'}>
            {valuations.map((v) => (
              <tr key={v.id}><td>{date(v.valuation_date)}</td><td className="num">{etb(v.value)}</td><td>{v.method || '—'}</td><td>{v.notes || '—'}</td></tr>
            ))}
          </Table>
          <div className="actions" style={{ justifyContent: 'space-between', margin: '24px 0 12px' }}>
            <h2 style={{ margin: 0 }}>{t('Rent, lease and other income')}</h2>
            {perm.can_edit_financial && <button type="button" className="btn" onClick={() => setModal('revenue')}>{t('Record income')}</button>}
          </div>
          <Table head={['Received', 'Type', 'Amount', 'Period', 'Payer', 'Reference']} empty={revenues.length === 0 && 'No income recorded against this asset.'}>
            {revenues.map((r) => (
              <tr key={r.id}>
                <td>{date(r.received_date)}</td><td>{label(r.revenue_type)}</td><td className="num">{etb(r.amount)}</td>
                <td>{r.period_start ? `${date(r.period_start)} to ${date(r.period_end)}` : '—'}</td><td>{r.payer || '—'}</td><td>{r.reference || '—'}</td>
              </tr>
            ))}
          </Table>
          {disposals.length > 0 && (
            <>
              <h2 style={{ margin: '24px 0 12px' }}>{t('Retirement and disposal')}</h2>
              <Table head={['Date', 'Kind', 'Method', 'Reason', 'Value', 'Buyer / recipient']}>
                {disposals.map((d) => (
                  <tr key={d.id}>
                    <td>{date(d.disposal_date)}</td><td>{label(d.kind)}</td><td>{label(d.method)}</td><td>{d.reason}</td>
                    <td className="num">{d.disposal_value != null ? etb(d.disposal_value) : '—'}</td><td>{d.recipient || '—'}</td>
                  </tr>
                ))}
              </Table>
            </>
          )}
          <p className="muted small">{t('Billing, receipts and arrears belong to the rent and revenue modules built on this register.')}</p>
        </section>
      )}

      {tab === 'requests' && (
        <>
          <section>
            <h2>{t('Requests')}</h2>
            <p className="muted small">{t('Transfers, disposals, retirements, assignments and ownership changes can need approval from someone other than the person who asked.')}</p>
            <Table head={['Requested', 'Kind', 'What', 'By', 'Status', 'Decision', '']} empty={requests.length === 0 && 'No requests for this asset.'}>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{dateTime(r.requested_at)}</td><td>{t(REQUEST_TITLES[r.request_type] || r.request_type)}</td><td>{t(r.summary)}</td><td>{r.requested_by_name}</td>
                  <td><Badge value={r.status} /></td><td>{r.decision_note || '—'}</td>
                  <td>{['PENDING', 'REVIEWED'].includes(r.status) && <button type="button" className="btn btn-small" onClick={() => act(() => api.post(`/requests/${r.id}/cancel`), 'Request withdrawn.')}>{t('Withdraw')}</button>}</td>
                </tr>
              ))}
            </Table>
          </section>
          <section style={{ marginTop: 24 }}>
            <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{t('Reservations')}</h2>
              {!!perm.can_reserve && <button type="button" className="btn btn-primary" onClick={() => setModal('reserve')}>{t('Reserve')}</button>}
            </div>
            {!a.is_reservable && <p className="muted small">{t('This asset is not marked as reservable. An editor can change that in Edit asset.')}</p>}
            <Table head={['From', 'To', 'By', 'Purpose', 'Status']} empty={reservations.length === 0 && 'No reservations.'}>
              {reservations.map((r) => (
                <tr key={r.id}><td>{dateTime(r.start_at)}</td><td>{dateTime(r.end_at)}</td><td>{r.requester_name}</td><td>{r.purpose}</td><td><Badge value={r.status} /></td></tr>
              ))}
            </Table>
          </section>
        </>
      )}

      {tab === 'history' && (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ margin: 0 }}>{t('Complete history')}</h2>
            <Link className="btn btn-small" to={`/assets/${a.id}/history`}>{t('Open as full page')}</Link>
          </div>
          {history.length === 0 ? <Empty>{t('No history yet.')}</Empty> : (
            <ul className="timeline">
              {history.map((h) => {
                const changes = h.changes ? Object.entries(h.changes).filter(([, v]) => v && typeof v === 'object' && 'from' in v) : [];
                return (
                  <li key={h.id}>
                    <div>{h.summary}</div>
                    {changes.length > 0 && <div className="small muted">{changes.map(([k, v]) => `${label(k.replace(/_id$/, ''))}: ${v.from ?? '—'} → ${v.to ?? '—'}`).join(' · ')}</div>}
                    <div className="when">{dateTime(h.created_at)} · {h.username || t('system')}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------ modals */}

      {m('sitecheck') && (
        <Modal title="Verify on site" onClose={close}>
          <SiteCheck asset={a} maxDistance={maxDistance} maxAccuracy={maxAccuracy} onCancel={close} onDone={done('Verified on site. It now waits for the Kifle Ketema Administrator\'s approval.')} />
        </Modal>
      )}
      {m('reject') && (
        <Modal title="Send back to draft" onClose={close}>
          <p>{t('The submitter will need to correct the asset and submit it again.')}</p>
          <SpecForm
            submitLabel="Send back" danger onCancel={close}
            fields={[{ name: 'comment', label: 'Reason', type: 'textarea', required: true, wide: true, maxLength: 500 }]}
            onSubmit={async (v) => { await api.post(`${path}/workflow`, { action: 'reject', comment: v.comment }); await done('Sent back to draft.')(); }}
          />
        </Modal>
      )}

      {m('label') && (
        <Modal title="Replace label" onClose={close}>
          <p className="muted small">{t('Use this when the label is lost, damaged or stolen. The asset gets a new QR code at once: the old label stops opening the asset and no longer counts when scanned. Then print the new label and fix it to the asset.')}</p>
          <SpecForm
            submitLabel="Replace label" danger onCancel={close}
            fields={[
              { name: 'reason', label: 'Reason', type: 'select', required: true, options: [{ value: '', label: 'Choose…' }, ...enumOpt(lk.enums.label_replace_reasons)] },
              { name: 'note', label: 'Explanation', type: 'textarea', wide: true, maxLength: 500 },
            ]}
            onSubmit={async (v) => { await api.post(`${path}/label/replace`, v); navigate(`/labels?ids=${a.id}`); }}
          />
        </Modal>
      )}

      {m('status') && (
        <Modal title="Change status" onClose={close}>
          <p className="muted small">{t('Status is the asset\'s operational state. Condition is changed by an inspection. Every change needs a reason and is recorded. To retire or dispose of an asset, use')}{' '}<strong>{t('Retire / dispose')}</strong>.</p>
          <SpecForm
            submitLabel="Change status" onCancel={close}
            fields={[
              { name: 'status', label: 'New status', type: 'select', required: true, options: [{ value: '', label: 'Choose…' }, ...enumOpt(usable)] },
              { name: 'reason', label: 'Reason', type: 'textarea', required: true, wide: true, maxLength: 500 },
            ]}
            onSubmit={async (v) => { await api.post(`${path}/status`, v); await done('Status changed.')(); }}
          />
        </Modal>
      )}

      {m('transfer') && (
        <Modal title="Transfer asset" onClose={close} wide>
          <p className="muted small">{t('Currently at {place}. You can only transfer to places inside your own assigned area. Transfers normally wait for an approver.', { place: `${a.kifle_ketema_name}${a.kebele_name ? ` / ${a.kebele_name}` : ''}${a.location_detail ? `, ${a.location_detail}` : ''}` })}</p>
          {sectorBound && kebeleBound && toKebeles.length === 1 && (
            <p className="muted small">{t('You work in {kebele} Kebele, so the asset moves to another building, place or holder there. To move it to another Kebele or sector, ask your Kebele Administrator.', { kebele: t(toKebeles[0].name) })}</p>
          )}
          {kebeleAdmin && (
            <p className="muted small">{t('As Kebele Administrator you can send the asset to any Kebele of your Kifle Ketema, or to another sector. Your request counts as the review and goes straight to the Kifle Ketema Administrator for approval.')}</p>
          )}
          <SpecForm
            submitLabel="Submit transfer" onCancel={close} initial={{ transfer_date: today(), to_kifle_ketema_id: only(toKifle), to_kebele_id: only(toKebeles) }}
            fields={[
              { name: 'to_kifle_ketema_id', label: 'To Kifle Ketema', type: 'select', required: true, fixedWhenSingle: true, options: () => opt(toKifle, undefined, { blank: 'Choose…' }),
                derive: (value, v) => (v.to_kebele_id && String(kebeleKifle(v.to_kebele_id)) !== String(value) ? { to_kebele_id: '' } : {}) },
              { name: 'to_kebele_id', label: 'To Kebele', type: 'select', required: kebeleBound, fixedWhenSingle: true,
                options: (v) => opt(toKebeles.filter((k) => !v.to_kifle_ketema_id || String(k.kifle_ketema_id) === String(v.to_kifle_ketema_id)), undefined, { blank: kebeleBound ? 'Choose…' : 'Not recorded' }),
                derive: (value) => (value ? { to_kifle_ketema_id: String(kebeleKifle(value) ?? '') } : {}) },
              { name: 'to_location_detail', label: 'Specific location / building', wide: true, maxLength: 255 },
              // a Sector Administrator keeps the asset in its own sector
              ...(sectorBound ? [] : [{ name: 'to_sector_id', label: 'New responsible sector (optional)', type: 'select', options: opt(activeSectors, undefined, { blank: 'Unchanged' }) }]),
              { name: 'transfer_date', label: 'Transfer date', type: 'date', required: true },
              { name: 'new_holder', label: 'New holder (optional)', kind: 'name' },
              { name: 'reason', label: 'Reason', required: true, wide: true, maxLength: 500 },
              { name: 'authorized_by', label: 'Authorised by', required: true, wide: true, kind: 'name', help: 'Person or office that approved the transfer. Attach any transfer letter under Documents afterwards.' },
            ]}
            onSubmit={async (v) => requestDone('Transfer recorded.')(await api.post(`${path}/transfers`, v))}
          />
          {!kebeleBound && myUnlinked.length > 0 && <p className="muted small">{t('{n} Kebeles are not yet linked to a Kifle Ketema and are not offered here.', { n: myUnlinked.length })}</p>}
        </Modal>
      )}

      {m('assign') && (
        <Modal title="Assign asset" onClose={close} wide>
          <p className="muted small">{t('Assigning ends the current assignment (it stays in the history) and starts a new one. Leave a field empty to keep what the asset has now.')}</p>
          <SpecForm
            submitLabel="Assign" onCancel={close} initial={{ assigned_date: today() }}
            fields={[
              ...(sectorBound ? [] : [{ name: 'sector_id', label: 'Sector', type: 'select', options: opt(activeSectors, undefined, { blank: 'Unchanged' }) }]),
              { name: 'office', label: 'Office', kind: 'name' },
              { name: 'responsible_officer', label: 'Responsible officer', kind: 'person', maxLength: 160 },
              { name: 'holder', label: 'Employee / user who will hold it', wide: true, kind: 'name' },
              { name: 'assigned_date', label: 'Assignment date', type: 'date', required: true },
              { name: 'reason', label: 'Reason', required: true, wide: true, maxLength: 500 },
            ]}
            onSubmit={async (v) => requestDone('Asset assigned.')(await api.post(`${path}/assignments`, v))}
          />
        </Modal>
      )}

      {m('ownership') && (
        <Modal title="Change of ownership" onClose={close}>
          <p className="muted small">{t('Currently owned by {owner} ({type}). An ownership change needs a legal basis and normally a review and a final approval.', { owner: a.owner_name, type: label(a.ownership_type) })}</p>
          <SpecForm
            submitLabel="Submit" onCancel={close} initial={{ effective_date: today(), new_type: a.ownership_type }}
            fields={[
              { name: 'new_owner', label: 'New owner', required: true, wide: true, kind: 'name' },
              { name: 'new_type', label: 'Ownership', type: 'select', options: enumOpt(lk.enums.ownership_types) },
              { name: 'effective_date', label: 'Effective date', type: 'date', required: true },
              { name: 'basis', label: 'Legal basis / decision', required: true, wide: true, type: 'textarea', maxLength: 500 },
            ]}
            onSubmit={async (v) => requestDone('Ownership changed.')(await api.post(`${path}/ownership-change`, v))}
          />
        </Modal>
      )}

      {m('dispose') && (
        <Modal title="Retire or dispose of asset" onClose={close} wide>
          <p className="muted small"><strong>{t('Retire')}</strong>{' '}{t('takes the asset out of service but keeps it on the register.')}{' '}<strong>{t('Dispose')}</strong>{' '}{t('ends its life (sale, donation, scrapping …) and locks the record permanently. Both need approval.')}</p>
          <SpecForm
            submitLabel="Submit" danger onCancel={close} initial={{ kind: a.status === 'RETIRED' ? 'DISPOSAL' : 'RETIREMENT', disposal_date: today() }}
            fields={[
              { name: 'kind', label: 'What', type: 'select', required: true, options: [{ value: 'RETIREMENT', label: 'Retire (out of service)' }, { value: 'DISPOSAL', label: 'Dispose (end of life)' }] },
              { name: 'disposal_date', label: 'Date', type: 'date', required: true },
              { name: 'reason', label: 'Reason', required: true, wide: true, type: 'textarea', maxLength: 500 },
              { name: 'method', label: 'Disposal method', type: 'select', show: (v) => v.kind === 'DISPOSAL', options: [{ value: '', label: 'Choose…' }, ...enumOpt(lk.enums.disposal_methods)] },
              { name: 'disposal_value', label: 'Value received (ETB)', type: 'number', step: '0.01', min: '0', show: (v) => v.kind === 'DISPOSAL' },
              { name: 'recipient', label: 'Buyer / recipient', wide: true, kind: 'name', show: (v) => v.kind === 'DISPOSAL' },
              { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
            ]}
            onSubmit={async (v) => requestDone('Done.')(await api.post(`${path}/disposal`, v))}
          />
        </Modal>
      )}

      {m('reserve') && (
        <Modal title="Reserve asset" onClose={close}>
          <SpecForm
            submitLabel="Request reservation" onCancel={close} initial={{ start_at: nowLocal(), end_at: nowLocal(60) }}
            fields={[
              { name: 'start_at', label: 'From', type: 'datetime-local', required: true },
              { name: 'end_at', label: 'Until', type: 'datetime-local', required: true, after: 'start_at' },
              { name: 'purpose', label: 'Purpose', required: true, wide: true, maxLength: 500 },
            ]}
            onSubmit={async (v) => { await api.post('/reservations', { ...v, asset_id: a.id }); await done('Reservation requested. An approver will decide.')(); }}
          />
        </Modal>
      )}

      {m('use') && (
        <Modal title="Record use" onClose={close} wide>
          <SpecForm
            submitLabel="Save use" onCancel={close} initial={{ start_date: today() }}
            fields={[
              { name: 'use_type', label: 'Use', type: 'select', required: true, options: [{ value: '', label: 'Choose…' }, ...enumOpt(lk.enums.use_types)] },
              { name: 'user_party', label: 'Used by', kind: 'name', help: 'Office, tenant, lessee, contractor, public…' },
              { name: 'start_date', label: 'From', type: 'date', required: true },
              { name: 'end_date', label: 'To (leave empty if ongoing)', type: 'date', after: 'start_date' },
              { name: 'purpose', label: 'Purpose', wide: true, maxLength: 2000 },
              { name: 'authorization_basis', label: 'Authorisation', wide: true, maxLength: 255, help: 'Contract, council decision or legal basis for this use.' },
              { name: 'generates_revenue', type: 'checkbox', label: 'Revenue', checkLabel: 'This use generates revenue for the City', wide: true },
              { name: 'revenue_sector_id', label: 'Revenue classification (working label)', type: 'select', wide: true, show: (v) => v.generates_revenue,
                options: [{ value: '', label: 'Not decided yet' }, ...opt(activeSectors)],
                help: 'Where the money is classified, for example Rent or Agriculture. Subject to the City’s official classification.' },
            ]}
            onSubmit={async (v) => { await api.post(`${path}/utilizations`, v); await done('Use recorded.')(); }}
          />
        </Modal>
      )}

      {modal?.endUse && (
        <Modal title="End use" onClose={close}>
          <p>{t('{use}{party}, since {date}.', { use: label(modal.endUse.use_type), party: modal.endUse.user_party ? ` ${t('by')} ${modal.endUse.user_party}` : '', date: date(modal.endUse.start_date) })}</p>
          <SpecForm
            submitLabel="End use" onCancel={close} initial={{ end_date: today() }}
            fields={[{ name: 'end_date', label: 'End date', type: 'date', required: true, min: modal.endUse.start_date }]}
            onSubmit={async (v) => { await api.post(`${path}/utilizations/${modal.endUse.id}/end`, v); await done('Use ended.')(); }}
          />
        </Modal>
      )}

      {m('maintenance') && (
        <Modal title="Record maintenance" onClose={close} wide>
          <SpecForm
            submitLabel="Save" onCancel={close} initial={{ maintenance_date: today(), status: 'COMPLETED', kind: 'ROUTINE' }}
            fields={[
              { name: 'maintenance_date', label: 'Date', type: 'date', required: true,
                validate: (v, all) => (all.status !== 'PLANNED' && v > today() ? 'Only planned maintenance can be dated in the future.' : null) },
              { name: 'maintenance_type', label: 'Type of work', required: true, placeholder: 'e.g. Engine service', maxLength: 120 },
              { name: 'kind', label: 'Kind', type: 'select', options: enumOpt(lk.enums.maintenance_kinds) },
              { name: 'status', label: 'Status', type: 'select', options: enumOpt(lk.enums.maintenance_statuses) },
              { name: 'cost', label: 'Cost (ETB)', type: 'number', step: '0.01', min: '0' },
              { name: 'provider', label: 'Service provider', kind: 'name' },
              { name: 'next_maintenance_date', label: 'Next maintenance due', type: 'date', after: 'maintenance_date' },
              { name: 'description', label: 'Description', type: 'textarea', wide: true },
            ]}
            onSubmit={async (v) => { await api.post(`${path}/maintenance`, v); await done('Maintenance recorded. Attach invoices under Documents.')(); }}
          />
        </Modal>
      )}

      {modal?.maintJob && (
        <Modal title={`Update: ${modal.maintJob.maintenance_type}`} onClose={close}>
          <SpecForm
            submitLabel="Save" onCancel={close}
            initial={{ status: modal.maintJob.status, cost: modal.maintJob.cost ?? '', provider: modal.maintJob.provider ?? '', next_maintenance_date: modal.maintJob.next_maintenance_date ?? '' }}
            fields={[
              { name: 'status', label: 'Status', type: 'select', options: enumOpt(lk.enums.maintenance_statuses) },
              { name: 'cost', label: 'Cost (ETB)', type: 'number', step: '0.01', min: '0' },
              { name: 'provider', label: 'Service provider', kind: 'name' },
              { name: 'next_maintenance_date', label: 'Next maintenance due', type: 'date', min: modal.maintJob.maintenance_date },
            ]}
            onSubmit={async (v) => { await api.patch(`${path}/maintenance/${modal.maintJob.id}`, v); await done('Maintenance updated.')(); }}
          />
        </Modal>
      )}

      {m('inspection') && (
        <Modal title="Record inspection" onClose={close} wide>
          <p className="muted small">{t('If you are offline, the result is kept on this device and sent when the connection returns.')}</p>
          <SpecForm
            submitLabel="Save" onCancel={close} initial={{ inspection_date: today(), condition_found: a.condition, result: 'PASSED', method: search.get('scan') ? 'SCAN' : 'MANUAL' }}
            fields={[
              { name: 'inspection_date', label: 'Date', type: 'date', required: true, past: true },
              { name: 'inspector', label: 'Inspector', required: true, kind: 'person', maxLength: 160 },
              { name: 'result', label: 'Result', type: 'select', options: enumOpt(lk.enums.inspection_results) },
              { name: 'condition_found', label: 'Condition found', type: 'select', required: true, options: enumOpt(lk.enums.conditions), help: 'The asset’s condition is updated to this.' },
              { name: 'next_inspection_date', label: 'Next inspection', type: 'date', after: 'inspection_date' },
              { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
              { name: 'follow_up', label: 'What must be done next', wide: true, maxLength: 500, show: (v) => v.result === 'FAILED', help: 'Creates a follow-up action.' },
              { name: 'follow_up_due', label: 'Follow-up due', type: 'date', after: 'inspection_date', show: (v) => v.result === 'FAILED' },
            ]}
            onSubmit={async (v) => {
              const res = await sendOrQueue('POST', `${path}/inspections`, v, `Inspection of ${a.asset_code}`);
              if (res.queued) {
                // nothing changed on the server yet, so there is nothing to reload
                close();
                setFlash(t('Saved on this device. It will be sent when you are back online.'));
                return;
              }
              await done('Inspection recorded. Attach photos or evidence under Documents.')();
            }}
          />
        </Modal>
      )}

      {m('followup') && (
        <Modal title="Add follow-up action" onClose={close}>
          <SpecForm
            submitLabel="Add" onCancel={close}
            fields={[
              { name: 'description', label: 'What must be done', required: true, wide: true, type: 'textarea', maxLength: 500 },
              { name: 'due_date', label: 'Due', type: 'date' },
              { name: 'assigned_to', label: 'Who', kind: 'name', maxLength: 160 },
            ]}
            onSubmit={async (v) => { await api.post(`${path}/follow-ups`, v); await done('Follow-up added.')(); }}
          />
        </Modal>
      )}

      {modal?.closeFollowUp && (
        <Modal title={modal.report ? 'Report follow-up done' : 'Follow-up done'} onClose={close}>
          <p>{modal.closeFollowUp.description}</p>
          {modal.report && <p className="muted small">{t('The Inspector or the Kebele Administrator checks the work, then closes the follow-up or sends it back.')}</p>}
          <SpecForm
            submitLabel={modal.report ? 'Report done' : 'Mark done'} onCancel={close}
            fields={[{ name: 'resolution', label: 'What was done', required: true, wide: true, type: 'textarea', maxLength: 500 }]}
            onSubmit={async (v) => { await api.post(`${path}/follow-ups/${modal.closeFollowUp.id}/close`, v); await done(modal.report ? 'Follow-up reported done. It waits for a check.' : 'Follow-up closed.')(); }}
          />
        </Modal>
      )}
      {modal?.reopenFollowUp && (
        <Modal title="Send the follow-up back" onClose={close}>
          <p>{modal.reopenFollowUp.description}</p>
          <p className="muted small">{t('Reported: {what}', { what: modal.reopenFollowUp.resolution })}</p>
          <SpecForm
            submitLabel="Send back" danger onCancel={close}
            fields={[{ name: 'note', label: 'What is still missing', required: true, wide: true, type: 'textarea', maxLength: 500 }]}
            onSubmit={async (v) => { await api.post(`${path}/follow-ups/${modal.reopenFollowUp.id}/reopen`, v); await done('Follow-up sent back.')(); }}
          />
        </Modal>
      )}

      {m('valuation') && (
        <Modal title="Add valuation" onClose={close}>
          <SpecForm
            submitLabel="Save" onCancel={close} initial={{ valuation_date: today() }}
            fields={[
              { name: 'valuation_date', label: 'Valuation date', type: 'date', required: true, past: true },
              { name: 'value', label: 'Value (ETB)', type: 'number', step: '0.01', min: '0', required: true },
              { name: 'method', label: 'Method', wide: true, placeholder: 'e.g. Annual revaluation' },
              { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
            ]}
            onSubmit={async (v) => { await api.post(`${path}/valuations`, v); await done('Valuation added.')(); }}
          />
        </Modal>
      )}

      {m('revenue') && (
        <Modal title="Record income" onClose={close} wide>
          <SpecForm
            submitLabel="Save" onCancel={close} initial={{ received_date: today(), revenue_type: 'RENT' }}
            fields={[
              { name: 'revenue_type', label: 'Type', type: 'select', options: enumOpt(lk.enums.revenue_types) },
              { name: 'amount', label: 'Amount (ETB)', type: 'number', step: '0.01', min: '0', required: true },
              { name: 'received_date', label: 'Received on', type: 'date', required: true, past: true },
              { name: 'payer', label: 'Paid by', kind: 'name' },
              { name: 'period_start', label: 'Period from', type: 'date' },
              { name: 'period_end', label: 'Period to', type: 'date', after: 'period_start' },
              { name: 'reference', label: 'Receipt / reference', maxLength: 120 },
              { name: 'utilization_id', label: 'For which use (optional)', type: 'select', options: [{ value: '', label: 'Not linked' }, ...utilizations.map((u) => ({ value: String(u.id), label: `${label(u.use_type)}${u.user_party ? ` · ${u.user_party}` : ''}` }))] },
            ]}
            onSubmit={async (v) => { await api.post(`${path}/revenues`, v); await done('Income recorded.')(); }}
          />
        </Modal>
      )}

      {m('acquisition') && (
        <Modal title={acquisition ? 'Edit acquisition' : 'Record acquisition'} onClose={close} wide>
          <SpecForm
            submitLabel="Save" onCancel={close}
            initial={acquisition ? Object.fromEntries(Object.entries(acquisition).map(([k, v]) => [k, v == null ? '' : String(v)])) : { method: 'PURCHASE', acquisition_date: a.acquisition_date ?? '' }}
            fields={[
              { name: 'method', label: 'How was it acquired?', type: 'select', required: true, options: enumOpt(lk.enums.acquisition_methods), wide: true },
              { name: 'supplier_name', label: 'Supplier / vendor / donor', kind: 'name' },
              { name: 'supplier_contact', label: 'Supplier contact', type: 'tel', help: 'A phone number, e.g. +2519…' },
              { name: 'procurement_ref', label: 'Procurement reference', maxLength: 120 },
              { name: 'contract_ref', label: 'Contract reference', maxLength: 120 },
              { name: 'invoice_ref', label: 'Invoice reference', maxLength: 120 },
              { name: 'acquisition_date', label: 'Acquisition date', type: 'date', past: true },
              { name: 'cost', label: 'Cost (ETB)', type: 'number', step: '0.01', min: '0' },
              { name: 'approval_ref', label: 'Approval (decision / minute)', maxLength: 160 },
              { name: 'approved_by_name', label: 'Approved by', kind: 'person' },
              { name: 'approved_on', label: 'Approved on', type: 'date', past: true },
              { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
            ]}
            onSubmit={async (v) => { await api.put(`${path}/acquisition`, v); await done('Acquisition saved.')(); }}
          />
        </Modal>
      )}

      {modal?.editDocument && (
        <Modal title="Edit document" onClose={close}>
          <p className="muted small">{t('Correct the title, type or expiry date. To change the file itself, upload the new one and remove this one.')}</p>
          <SpecForm
            submitLabel="Save" onCancel={close}
            initial={{ title: modal.editDocument.title, doc_type: modal.editDocument.doc_type, expires_on: modal.editDocument.expires_on ? String(modal.editDocument.expires_on).slice(0, 10) : '' }}
            fields={[
              { name: 'title', label: 'Title', required: true, wide: true },
              { name: 'doc_type', label: 'Type', type: 'select', required: true, options: enumOpt(lk.enums.doc_types) },
              { name: 'expires_on', label: 'Expires on (licences, insurance, contracts)', type: 'date' },
            ]}
            onSubmit={async (v) => { await api.patch(`${path}/documents/${modal.editDocument.id}`, v); await done('Document updated.')(); }}
          />
        </Modal>
      )}
      {modal?.removeDocument && (
        <ConfirmDialog
          title="Remove document" danger confirmLabel="Remove"
          message={t('Remove "{title}"? The file is deleted; the record of its upload and removal stays in the history. This cannot be undone.', { title: modal.removeDocument.title })}
          onClose={close}
          onConfirm={async () => { await api.del(`${path}/documents/${modal.removeDocument.id}`); await done('Document removed.')(); }}
        />
      )}
      {m('document') && (
        <Modal title="Upload document or photo" onClose={close} wide>
          <SpecForm
            submitLabel="Upload" onCancel={close} initial={{ doc_type: 'PHOTO', related_type: '' }}
            fields={[
              { name: 'doc_type', label: 'Type', type: 'select', required: true, options: enumOpt(lk.enums.doc_types) },
              { name: 'related_type', label: 'Belongs to (optional)', type: 'select', options: [{ value: '', label: 'The asset in general' }, ...enumOpt(lk.enums.doc_related)] },
              { name: 'title', label: 'Title', required: true, wide: true, placeholder: 'e.g. Front view, Title deed, Insurance certificate' },
              { name: 'expires_on', label: 'Expires on (licences, insurance, contracts)', type: 'date', help: 'You are alerted before it expires.' },
              { name: 'file', label: 'File', type: 'file', required: true, wide: true, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx' },
            ]}
            onSubmit={async (v) => {
              const fd = new FormData();
              fd.append('doc_type', v.doc_type);
              fd.append('title', v.title);
              if (v.related_type) fd.append('related_type', v.related_type);
              if (v.expires_on) fd.append('expires_on', v.expires_on);
              if (v.file) fd.append('file', v.file);
              await api.post(`${path}/documents`, fd);
              await done('File uploaded.')();
            }}
          />
        </Modal>
      )}
    </>
  );
}
