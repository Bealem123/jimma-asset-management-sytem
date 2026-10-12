import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download, qs } from '../api.js';
import { sendOrQueue } from '../offline.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { date, dateTime, label } from '../format.js';
import {
  Alert, Badge, Loading, Modal, PageHeader, Pagination, SpecForm, Table, enumOpt, opt, useAsync,
} from '../components/ui.jsx';
import QrScanner from '../components/QrScanner.jsx';
import { Tile } from '../components/charts.jsx';
import { t } from '../i18n.jsx';

function Progress({ s }) {
  return (
    <div title={t('{a} of {b} checked', { a: s.verified, b: s.total })} className="progress" role="img" aria-label={t('{n}% checked', { n: s.progress })}>
      <span style={{ width: `${s.progress}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ list of campaigns

/** Newly registered assets waiting for this Kebele Administrator's on-site check: listed here, nothing to search for. */
function NewRegistrations() {
  const { data, error, loading } = useAsync(() => api.get('/assets?approval_state=SUBMITTED&page_size=100&sort=updated_at&dir=asc'), []);
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2>{t('New registrations to verify on site')}</h2>
        <p className="muted small">{t('Registered and submitted by the Sector Administrators. Go to each asset and verify it there.')}</p>
      </div>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : data.rows.length === 0
        ? <p className="muted">{t('Nothing waiting. A new registration appears here as soon as a Sector Administrator submits it.')}</p>
        : (
          <Table head={['Asset ID', 'Name', 'Sector', 'Where', 'Submitted', '']}>
            {data.rows.map((a) => (
              <tr key={a.id}>
                <td>{a.asset_code}</td>
                <td><Link to={`/assets/${a.id}`}>{a.name}</Link></td>
                <td>{a.sector_name}</td>
                <td>{a.kebele_name}{a.location_detail && <div className="muted small">{a.location_detail}</div>}</td>
                <td>{date(a.updated_at)}</td>
                <td><Link className="btn btn-small btn-primary" to={`/assets/${a.id}?action=verify`}>{t('Verify on site')}</Link></td>
              </tr>
            ))}
          </Table>
        )}
    </section>
  );
}

export default function Verification() {
  const { user } = useAuth();
  const lk = useLookups();
  const { data, error, loading, reload } = useAsync(() => api.get('/verification'), []);
  const [modal, setModal] = useState(false);

  return (
    <>
      <PageHeader title="Physical verification" subtitle="Check on site that assets really exist where the register says: new registrations first, then regular stock-taking of the assets already in use.">
        {can.manageVerification(user) && <button type="button" className="btn btn-primary" onClick={() => setModal(true)}>{t('Start a stock-taking')}</button>}
        <Link className="btn" to="/scan">{t('Scanner')}</Link>
      </PageHeader>
      {can.review(user) && <NewRegistrations />}
      <h2>{t('Stock-taking of assets in use')}</h2>
      <p className="muted small">{t('A stock-taking lists every active asset of an area and checks each one is still where the register says. New registrations are not included until they are approved and active.')}</p>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : (
        <Table head={['Stock-taking', 'Area', 'Progress', 'Found in place', 'Problems', 'Status', '']} empty={data.length === 0 && 'No stock-taking has been started yet.'}>
          {data.map((c) => (
            <tr key={c.id}>
              <td><Link to={`/verification/${c.id}`}>{c.name}</Link><div className="muted small">{dateTime(c.created_at)} · {c.created_by_name}{c.due_date ? ` · due ${date(c.due_date)}` : ''}</div></td>
              <td>{[c.kebele_name, c.kifle_ketema_name, c.sector_name].filter(Boolean).join(' · ') || t('Whole area you can see')}</td>
              <td><Progress s={c.summary} /><span className="small">{c.summary.verified}/{c.summary.total} ({c.summary.progress}%)</span></td>
              <td>{c.summary.found}</td>
              <td>{c.summary.open_discrepancies > 0 ? <Badge value="MISSING" text={`${c.summary.open_discrepancies} open`} /> : c.summary.wrong_location + c.summary.missing + c.summary.duplicate ? t('All resolved') : '—'}</td>
              <td><Badge value={c.status === 'OPEN' ? 'ACTIVE' : 'DISPOSED'} text={label(c.status)} /></td>
              <td><Link className="btn btn-small" to={`/verification/${c.id}`}>{t('Open')}</Link></td>
            </tr>
          ))}
        </Table>
      )}
      {modal && (
        <Modal title="Start a stock-taking" onClose={() => setModal(false)}>
          <p className="muted small">{t('Every active asset in the chosen area is listed as "not yet checked", with the place the register expects. Leave all areas empty to cover everything you can see.')}</p>
          <SpecForm
            submitLabel="Start" onCancel={() => setModal(false)}
            fields={[
              { name: 'name', label: 'Name', required: true, wide: true, placeholder: 'e.g. Jiren yearly check 2026' },
              { name: 'kifle_ketema_id', label: 'Kifle Ketema', type: 'select', options: opt(lk.kifle, undefined, { blank: 'Any' }) },
              { name: 'kebele_id', label: 'Kebele', type: 'select', options: opt(lk.kebeles.filter((k) => k.kifle_ketema_id), undefined, { blank: 'Any' }) },
              { name: 'sector_id', label: 'Sector', type: 'select', options: opt(lk.sectors, undefined, { blank: 'Any' }) },
              { name: 'due_date', label: 'Finish by', type: 'date' },
            ]}
            onSubmit={async (v) => { await api.post('/verification', v); setModal(false); reload(); }}
          />
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ one campaign

const FILTERS = [['', 'All'], ['PENDING', 'Not yet checked'], ['FOUND', 'Found in place'], ['open', 'Open discrepancies'], ['MISSING', 'Missing'], ['WRONG_LOCATION', 'Wrong location']];

function RecordPanel({ campaign, onDone }) {
  const lk = useLookups();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState('');
  const [method, setMethod] = useState('MANUAL');
  const [coords, setCoords] = useState(null);
  const [msg, setMsg] = useState('');
  const [typed, setTyped] = useState('');

  const accept = (text, how) => {
    const found = /AST-\d{6}/i.exec(text);
    if (!found) { setMsg('That is not a Jimma asset code.'); return; }
    setMsg('');
    setCode(found[0].toUpperCase());
    setMethod(how);
    setScanning(false);
    navigator.geolocation?.getCurrentPosition((p) => setCoords({ latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }), () => {}, { timeout: 8000 });
  };

  return (
    <section className="card" aria-labelledby="rec-h">
      <h2 id="rec-h">{t('Record what you found')}</h2>
      {!code ? (
        <>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setScanning(!scanning)}>{scanning ? t('Stop camera') : t('Scan a QR code or barcode')}</button>
            <form className="actions" onSubmit={(e) => { e.preventDefault(); accept(typed, 'MANUAL'); setTyped(''); }}>
              <label className="sr-only" htmlFor="v-code">{t('Asset ID')}</label>
              <input id="v-code" placeholder={t('or type the Asset ID, e.g. AST-000125')} value={typed} onChange={(e) => setTyped(e.target.value)} style={{ width: 280 }} />
              <button type="submit" className="btn">{t('Continue')}</button>
            </form>
          </div>
          {msg && <Alert kind="warn">{msg}</Alert>}
          {scanning && <QrScanner onScan={(t) => accept(t, 'SCAN')} />}
        </>
      ) : (
        <>
          <p><strong>{code}</strong> {method === 'SCAN' && <span className="badge badge-neutral">{t('scanned')}</span>}</p>
          <SpecForm
            key={code}
            submitLabel="Save result" onCancel={() => { setCode(''); setCoords(null); }}
            initial={{ result: 'FOUND' }}
            fields={[
              { name: 'result', label: 'Result', type: 'select', options: [{ value: 'FOUND', label: 'Found' }, { value: 'MISSING', label: 'Not found (missing)' }, { value: 'DUPLICATE', label: 'Duplicate (two records for one asset)' }] },
              { name: 'found_condition', label: 'Condition seen', type: 'select', show: (v) => v.result === 'FOUND', options: enumOpt(lk.enums.conditions, { blank: 'Not checked' }) },
              { name: 'found_kifle_ketema_id', label: 'Found in Kifle Ketema', type: 'select', show: (v) => v.result === 'FOUND', options: opt(lk.kifle, undefined, { blank: 'Where the register says' }) },
              { name: 'found_kebele_id', label: 'Found in Kebele', type: 'select', show: (v) => v.result === 'FOUND',
                options: (v) => opt(lk.kebeles.filter((k) => k.kifle_ketema_id && (!v.found_kifle_ketema_id || String(k.kifle_ketema_id) === String(v.found_kifle_ketema_id))), undefined, { blank: 'Where the register says' }) },
              { name: 'found_location_detail', label: 'Exact place found', wide: true, show: (v) => v.result === 'FOUND' },
              { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
            ]}
            onSubmit={async (v) => {
              const body = { ...v, asset: code, method, ...(coords || {}) };
              if (v.found_kebele_id && !v.found_kifle_ketema_id) delete body.found_kifle_ketema_id;
              const res = await sendOrQueue('POST', `/verification/${campaign.id}/record`, body, `Verification of ${code}`);
              setMsg(res.queued ? `${code}: saved on this device, will be sent when you are online.` : `${code}: ${label(res.result)}${res.discrepancy_status === 'OPEN' ? ' - a discrepancy was raised.' : '.'}`);
              setCode(''); setCoords(null);
              if (!res.queued) onDone();
            }}
          />
          {coords && <p className="muted small">{t('GPS captured: {lat}, {lng}', { lat: coords.latitude, lng: coords.longitude })}</p>}
        </>
      )}
      {!code && msg && <Alert kind="success">{msg}</Alert>}
    </section>
  );
}

export function VerificationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [resolve, setResolve] = useState(null); // { item, action }
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');
  const isDisc = filter === 'open';
  const query = qs({ ...(isDisc ? { discrepancy: 'open' } : { result: filter }), q, page, page_size: 50 });
  const { data, error, loading, reload } = useAsync(() => api.get(`/verification/${id}${query}`), [id, query]);

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const { campaign: c, summary: s, items } = data;
  const open = c.status === 'OPEN';

  async function resolveItem(item, action, note) {
    setErr('');
    try { await api.post(`/verification/items/${item.id}/resolve`, { action, note }); setResolve(null); setFlash('Saved.'); reload(); } catch (e) { setErr(e.message); setResolve(null); }
  }
  async function closeCampaign(markMissing) {
    setErr('');
    try { await api.post(`/verification/${id}/close`, { mark_unverified_missing: markMissing }); setFlash('Campaign closed.'); reload(); } catch (e) { setErr(e.message); }
  }

  return (
    <>
      <PageHeader title={c.name} subtitle={`${label(c.status)}${c.due_date ? ` · finish by ${date(c.due_date)}` : ''}`}>
        <Link className="btn" to="/verification">{t('All campaigns')}</Link>
        <button type="button" className="btn" onClick={() => download(`/verification/${id}/report.csv`, `verification-${id}.csv`).catch((e) => setErr(e.message))}>{t('Download report')}</button>
        {open && data.can_manage && <button type="button" className="btn" onClick={() => { if (window.confirm(t('Close this campaign? Assets not checked stay unchecked.'))) closeCampaign(false); }}>{t('Close')}</button>}
        {open && data.can_manage && s.pending > 0 && <button type="button" className="btn btn-danger" onClick={() => { if (window.confirm(t(`Close and mark the ${s.pending} unchecked assets as missing?`))) closeCampaign(true); }}>{t('Close, unchecked = missing')}</button>}
      </PageHeader>
      <Alert kind="success">{flash}</Alert>
      <Alert>{err}</Alert>

      <div className="grid grid-tiles" role="list" aria-label={t('Verification results')}>
        <Tile value={`${s.progress}%`} caption="Checked" note={`${s.verified} of ${s.total}`} />
        <Tile value={s.found} caption="Found in place" />
        <Tile value={s.wrong_location} caption="Wrong location" tone={s.wrong_location ? 'warn' : undefined} />
        <Tile value={s.missing} caption="Missing" tone={s.missing ? 'bad' : undefined} />
        <Tile value={s.duplicate} caption="Duplicates" />
        <Tile value={s.open_discrepancies} caption="Open discrepancies" note={`${s.corrected} corrected`} tone={s.open_discrepancies ? 'bad' : undefined} />
      </div>

      {open && data.can_record && <div style={{ marginTop: 16 }}><RecordPanel campaign={c} onDone={reload} /></div>}

      <div className="actions" style={{ margin: '16px 0 8px' }}>
        {FILTERS.map(([k, text]) => (
          <button key={k} type="button" className={`btn btn-small${filter === k ? ' btn-primary' : ''}`} onClick={() => { setFilter(k); setPage(1); }}>{t(text)}</button>
        ))}
        <input type="search" aria-label={t('Search by asset ID or name')} placeholder={t('Search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ maxWidth: 220 }} />
      </div>
      <Table head={['Asset', 'The register says', 'Found', 'Result', 'Discrepancy', '']} empty={items.length === 0 && 'Nothing here.'}>
        {items.map((i) => (
          <tr key={i.id}>
            <td><Link to={`/assets/${i.asset_id}`}>{i.asset_code}</Link><div className="muted small">{i.asset_name}</div></td>
            <td>{i.expected_kifle_name}{i.expected_kebele_name ? ` / ${i.expected_kebele_name}` : ''}{i.expected_location_detail && <div className="muted small">{i.expected_location_detail}</div>}</td>
            <td>{i.result === 'PENDING' ? '—' : i.result === 'MISSING' ? t('Not found') : <>{i.found_kifle_name}{i.found_kebele_name ? ` / ${i.found_kebele_name}` : ''}{i.found_location_detail && <div className="muted small">{i.found_location_detail}</div>}</>}
              {i.verified_by_name && <div className="muted small">{i.verified_by_name}{i.method === 'SCAN' ? ` · ${t('scanned')}` : ''}, {dateTime(i.verified_at)}</div>}</td>
            <td><Badge value={i.result} />{i.notes && <div className="muted small">{i.notes}</div>}</td>
            <td>{i.discrepancy_status === 'NONE' ? '—' : <Badge value={i.discrepancy_status} />}{i.resolution_note && <div className="muted small">{i.resolution_note}</div>}</td>
            <td className="actions">
              {data.can_manage && ['OPEN', 'INVESTIGATING'].includes(i.discrepancy_status) && (
                <>
                  {i.discrepancy_status === 'OPEN' && <button type="button" className="btn btn-small" onClick={() => setResolve({ item: i, action: 'INVESTIGATE' })}>{t('Investigate')}</button>}
                  <button type="button" className="btn btn-small btn-primary" onClick={() => setResolve({ item: i, action: 'CORRECT' })}>{t('Correct register')}</button>
                  <button type="button" className="btn btn-small" onClick={() => setResolve({ item: i, action: 'DISMISS' })}>{t('Dismiss')}</button>
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
      {user && <p className="muted small">{t('A correction updates the register to match what was found (the old location stays in the asset\'s history). The officer who recorded a finding cannot approve its correction.')}</p>}

      {resolve && (
        <Modal title={{ INVESTIGATE: 'Investigate', CORRECT: 'Correct the register', DISMISS: 'Dismiss the discrepancy' }[resolve.action]} onClose={() => setResolve(null)}>
          <p>{resolve.item.asset_code}: {label(resolve.item.result)}.{' '}
            {resolve.action === 'CORRECT' && (resolve.item.result === 'WRONG_LOCATION' ? t('The asset will be moved to where it was found.') : resolve.item.result === 'MISSING' ? t('The asset will be marked as Lost.') : t('A follow-up action will be created.'))}
            {resolve.action === 'DISMISS' && t(' Nothing in the register changes.')}</p>
          <SpecForm
            submitLabel="Save" onCancel={() => setResolve(null)}
            fields={[{ name: 'note', label: resolve.action === 'INVESTIGATE' ? 'Note (optional)' : 'Explain the decision', type: 'textarea', required: resolve.action !== 'INVESTIGATE', wide: true }]}
            onSubmit={async (v) => resolveItem(resolve.item, resolve.action, v.note)}
          />
        </Modal>
      )}
    </>
  );
}
