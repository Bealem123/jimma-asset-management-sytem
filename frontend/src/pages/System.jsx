import { useState } from 'react';
import { api } from '../api.js';
import { bytes, dateTime, label, num } from '../format.js';
import {
  Alert, Badge, Loading, Modal, PageHeader, SpecForm, Table, Tabs, useAsync,
} from '../components/ui.jsx';
import { Tile } from '../components/charts.jsx';
import { t } from '../i18n.jsx';

const REQUEST_NAMES = { TRANSFER: 'Transfer', DISPOSAL: 'Disposal', RETIREMENT: 'Retirement', ASSIGNMENT: 'Assignment', OWNERSHIP_CHANGE: 'Ownership change' };

// ------------------------------------------------------------------ health

function Health() {
  const { data: h, error, loading, reload } = useAsync(() => api.get('/admin/health'), []);
  if (loading && !h) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const hours = (v) => (v == null ? t('never') : v < 48 ? t('{n} h ago', { n: v }) : t('{n} days ago', { n: Math.round(v / 24) }));
  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}>
        <Badge value={h.status} text={h.status === 'OK' ? 'Everything looks healthy' : 'Needs attention'} />
        <button type="button" className="btn btn-small" onClick={reload}>{t('Refresh')}</button>
      </div>
      {h.warnings.map((w) => <Alert key={w} kind="warn">{w}</Alert>)}
      <div className="grid grid-tiles">
        <Tile value={`${h.database.latency_ms} ms`} caption="Database" note={h.database.ok ? 'Connected' : 'Not reachable'} />
        <Tile value={num(h.counts.assets)} caption="Assets" note={`${h.counts.active_users} active users`} />
        <Tile value={num(h.counts.open_requests)} caption="Requests waiting" />
        <Tile value={bytes(h.uploads.bytes)} caption="Uploaded files" note={`${num(h.uploads.files)} files`} />
        <Tile value={hours(h.backups.database_age_hours)} caption="Last database backup" note={h.backups.database ? h.backups.database.filename : 'Run one in the Backups tab'} />
        <Tile value={hours(h.backups.files_age_hours)} caption="Last files backup" />
        <Tile value={`${Math.floor(h.server.uptime_seconds / 3600)} h`} caption="Server running for" note={`${h.server.memory_mb} MB memory · Node ${h.server.node}`} />
        <Tile value={h.channels.email ? t('On') : t('Off')} caption="E-mail sending" note={h.channels.sms ? t('SMS gateway on') : t('SMS gateway off')} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ approval workflows

function Workflows() {
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/workflows'), []);
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  async function save(row, patch) {
    setErr('');
    try {
      await api.put(`/admin/workflows/${row.request_type}`, { requires_approval: row.requires_approval, steps: row.steps, ...patch });
      setFlash(`${REQUEST_NAMES[row.request_type]}: saved.`);
      reload();
    } catch (e) { setErr(e.message); }
  }
  return (
    <>
      <p className="muted">{t('Choose which changes need someone else\'s approval. With two steps, one person reviews and a different person gives the final approval. Asset registration always uses its full workflow (draft, submitted, reviewed, approved, active).')}</p>
      <Alert kind="success">{flash}</Alert>
      <Alert>{err}</Alert>
      <Table head={['Request', 'Needs approval', 'Steps']}>
        {data.map((r) => (
          <tr key={r.request_type}>
            <td>{t(REQUEST_NAMES[r.request_type])}</td>
            <td><label className="check"><input type="checkbox" checked={r.requires_approval} onChange={(e) => save(r, { requires_approval: e.target.checked })} /> {r.requires_approval ? t('Yes') : t('No: happens immediately')}</label></td>
            <td>
              <select aria-label={t('Steps for {kind}', { kind: t(REQUEST_NAMES[r.request_type]) })} value={r.steps} disabled={!r.requires_approval} onChange={(e) => save(r, { steps: Number(e.target.value) })} style={{ width: 'auto' }}>
                <option value={1}>{t('One approval')}</option>
                <option value={2}>{t('Review, then approve')}</option>
              </select>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}

// ------------------------------------------------------------------ roles and permissions

function Permissions() {
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/permissions'), []);
  const [role, setRole] = useState('KIFLE_ADMIN');
  const [draft, setDraft] = useState(null);
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const current = data.roles.find((r) => r.role === role);
  const chosen = draft ?? new Set(current.permissions);
  const changed = draft && (draft.size !== current.permissions.length || [...draft].some((p) => !current.permissions.includes(p)));
  const differsFromDefault = current.permissions.length !== current.defaults.length || current.permissions.some((p) => !current.defaults.includes(p));

  async function save(list) {
    setErr('');
    try {
      await api.put(`/admin/permissions/${role}`, { permissions: [...list] });
      setFlash(`${current.label}: permissions saved. They apply the next time those users load a page.`);
      setDraft(null);
      reload();
    } catch (e) { setErr(e.message); }
  }

  return (
    <>
      <p className="muted">{t('A role\'s permissions say what its members may')}{' '}<em>{t('do')}</em>{t('; the area assigned to each user says which assets they can')}{' '}<em>{t('see')}</em>{t('. The Super Administrator always keeps every permission.')}</p>
      <div className="field" style={{ maxWidth: 320, marginBottom: 12 }}>
        <label htmlFor="perm-role">{t('Role')}</label>
        <select id="perm-role" value={role} onChange={(e) => { setRole(e.target.value); setDraft(null); setFlash(''); }}>
          {data.roles.map((r) => <option key={r.role} value={r.role}>{t(r.label)}</option>)}
        </select>
      </div>
      <Alert kind="success">{flash}</Alert>
      <Alert>{err}</Alert>
      {current.locked ? <Alert kind="info">{t('The Super Administrator always has every permission.')}</Alert> : (
        <>
          <ul className="perm-list">
            {data.permissions.map((p) => (
              <li key={p.key}>
                <label className="check">
                  <input
                    type="checkbox" checked={chosen.has(p.key)}
                    onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(p.key); else n.delete(p.key); setDraft(n); setFlash(''); }}
                  />
                  <span>{t(p.label)}{!current.defaults.includes(p.key) && chosen.has(p.key) && <span className="badge badge-warn" style={{ marginLeft: 6 }}>{t('added')}</span>}{current.defaults.includes(p.key) && !chosen.has(p.key) && <span className="badge badge-warn" style={{ marginLeft: 6 }}>{t('removed')}</span>}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={!changed} onClick={() => save(chosen)}>{t('Save permissions')}</button>
            <button type="button" className="btn" disabled={!differsFromDefault && !changed} onClick={() => save(new Set(current.defaults))}>{t('Reset to the default for this role')}</button>
          </div>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ notification rules

function NotificationRules() {
  const { data, error, loading, reload } = useAsync(() => api.get('/notifications/rules'), []);
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  async function save(rule, patch) {
    setErr('');
    try {
      const next = { enabled: rule.enabled, email: rule.email, sms: rule.sms, lead_days: rule.lead_days, ...patch };
      await api.put(`/notifications/rules/${rule.type}`, next);
      reload();
    } catch (e) { setErr(e.message); }
  }
  async function scan() {
    setErr('');
    try {
      const res = await api.post('/notifications/run');
      const total = Object.values(res.created).reduce((a, b) => a + b, 0);
      setFlash(total ? `${total} new notifications created.` : 'Nothing new to report.');
    } catch (e) { setErr(e.message); }
  }
  return (
    <>
      <p className="muted">{t('In-system notifications are always shown to the people responsible for the asset. E-mail and SMS are optional extras and need an e-mail address or phone number on the user. The scan runs every hour; you can also run it now.')}</p>
      {!data.channels.email && <Alert kind="warn">{t('E-mail is not set up on the server (SMTP_HOST in the settings file), so e-mail ticks have no effect yet.')}</Alert>}
      {!data.channels.sms && <Alert kind="warn">{t('No SMS gateway is set up (SMS_GATEWAY_URL), so SMS ticks have no effect yet.')}</Alert>}
      <Alert kind="success">{flash}</Alert>
      <Alert>{err}</Alert>
      <div className="actions" style={{ marginBottom: 10 }}><button type="button" className="btn" onClick={scan}>{t('Run the alert scan now')}</button></div>
      <Table head={['Alert', 'On', 'Warn this many days ahead', 'E-mail', 'SMS']}>
        {data.rules.map((r) => (
          <tr key={r.type}>
            <td>{t(r.label)}<div className="muted small">{r.scan_based ? t('Found by the hourly scan') : t('Sent when it happens')}</div></td>
            <td><input type="checkbox" aria-label={t('{label}: on', { label: t(r.label) })} checked={r.enabled} onChange={(e) => save(r, { enabled: e.target.checked })} /></td>
            <td>{r.scan_based && r.lead_days != null
              ? <input type="number" min="0" max="365" aria-label={t('{label}: days ahead', { label: t(r.label) })} defaultValue={r.lead_days} style={{ width: 80 }} onBlur={(e) => e.target.value !== String(r.lead_days) && save(r, { lead_days: e.target.value })} />
              : '—'}</td>
            <td><input type="checkbox" aria-label={t('{label}: e-mail', { label: t(r.label) })} checked={r.email} onChange={(e) => save(r, { email: e.target.checked })} /></td>
            <td><input type="checkbox" aria-label={t('{label}: SMS', { label: t(r.label) })} checked={r.sms} onChange={(e) => save(r, { sms: e.target.checked })} /></td>
          </tr>
        ))}
      </Table>
    </>
  );
}

// ------------------------------------------------------------------ settings

function Settings() {
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/settings'), []);
  const [flash, setFlash] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <section className="card">
      <p className="muted">{t('The texts are shown on printed and PDF reports. The calendar decides which months the monthly reports follow; both calendars are always shown.')}</p>
      <Alert kind="success">{flash}</Alert>
      <SpecForm
        submitLabel="Save settings" initial={data.values}
        fields={Object.entries(data.labels).map(([name, text]) => (data.choices?.[name]
          ? { name, label: text, wide: true, type: 'select', options: Object.entries(data.choices[name]).map(([value, choice]) => ({ value, label: choice })) }
          : { name, label: text, wide: true }))}
        onSubmit={async (v) => { await api.put('/admin/settings', v); setFlash('Saved.'); reload(); }}
      />
    </section>
  );
}

// ------------------------------------------------------------------ backups

function Backups() {
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/backups'), []);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  async function run(kind) {
    setBusy(true); setErr(''); setFlash('');
    try { await api.post('/admin/backups', { kind }); setFlash('Backup finished and checked.'); } catch (e) { setErr(e.message); }
    setBusy(false); reload();
  }
  async function verify(b) {
    setErr('');
    try { const r = await api.post(`/admin/backups/${b.id}/verify`); setFlash(`${b.filename}: ${r.status === 'OK' ? 'reads back correctly' : 'DAMAGED'}.`); reload(); } catch (e) { setErr(e.message); }
  }
  return (
    <>
      <p className="muted">{t('A backup has two parts: the database (all records and history) and the uploaded files (photos and documents). Copy the backup folder to another disk or site regularly: a backup on the same machine does not protect against losing the machine. Backups folder:')}{' '}<code>{data.dir}</code></p>
      <Alert kind="success">{flash}</Alert>
      <Alert>{err}</Alert>
      <div className="actions" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run('both')}>{busy ? t('Working…') : t('Back up now (database + files)')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => run('database')}>{t('Database only')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => run('files')}>{t('Files only')}</button>
      </div>
      <Table head={['When', 'What', 'File', 'Size', 'Result', '']} empty={data.backups.length === 0 && 'No backup has been made yet.'}>
        {data.backups.map((b) => (
          <tr key={b.id}>
            <td>{dateTime(b.created_at)}</td><td>{label(b.kind)}</td><td>{b.filename}</td><td>{bytes(Number(b.size_bytes))}</td>
            <td><Badge value={b.status} />{b.note && <div className="muted small">{b.note}</div>}</td>
            <td>{b.kind === 'DATABASE' && b.status === 'OK' && <button type="button" className="btn btn-small" onClick={() => verify(b)}>{t('Check again')}</button>}</td>
          </tr>
        ))}
      </Table>
      <details className="card" style={{ marginTop: 16 }}>
        <summary>{t('How to restore')}</summary>
        <ol>
          <li>{t('Stop the application.')}</li>
          <li>{t('Run')}{' '}<code>{t('npm --prefix backend run restore -- backups/db-YYYY-MM-DD-hh-mm-ss.sql.gz --yes')}</code>{t('. This replaces the contents of the database.')}</li>
          <li>{t('Copy the files from the matching')}{' '}<code>{t('files-…')}</code>{' '}{t('folder back into the uploads folder.')}</li>
          <li>{t('Start the application and check the dashboard. Do a restore test at least once a year.')}</li>
        </ol>
        <p className="muted small">{t('Set')}{' '}<code>{t('AUTO_BACKUP=true')}</code>{' '}{t('in the settings file to take a backup every day while the server is running, or schedule')}{' '}<code>{t('npm --prefix backend run backup')}</code>{' '}{t('with Windows Task Scheduler.')}</p>
      </details>
    </>
  );
}

// ------------------------------------------------------------------ API keys

function ApiKeys() {
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/api-keys'), []);
  const [modal, setModal] = useState(false);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  async function disable(k) {
    if (!window.confirm(t(`Disable the key for "${k.name}"? That system will lose access immediately.`))) return;
    try { await api.post(`/admin/api-keys/${k.id}/disable`); reload(); } catch (e) { setErr(e.message); }
  }
  return (
    <>
      <p className="muted">{t('Other City systems (GIS, finance, procurement, dashboards) can read the asset register through a read-only REST API. Each system gets its own key. Money figures are never included. Interface description:')}{' '}<a href="/api/integration/v1/openapi.json" target="_blank" rel="noreferrer">{t('/api/integration/v1/openapi.json')}</a>{t('. Send the key in the')}{' '}<code>{t('X-API-Key')}</code>{' '}{t('header.')}</p>
      <Alert>{err}</Alert>
      {created && (
        <Alert kind="warn">{t('Key for')}{' '}<strong>{created.name}</strong>{' '}{t('(copy it now, it cannot be shown again):')}<br />
          <code style={{ wordBreak: 'break-all' }}>{created.key}</code>
        </Alert>
      )}
      <div className="actions" style={{ marginBottom: 10 }}><button type="button" className="btn btn-primary" onClick={() => setModal(true)}>{t('Create a key')}</button></div>
      <Table head={['System', 'Key starts with', 'Last used', 'Status', '']} empty={data.length === 0 && 'No API keys yet.'}>
        {data.map((k) => (
          <tr key={k.id}>
            <td>{k.name}</td><td><code>{k.key_prefix}…</code></td><td>{k.last_used_at ? dateTime(k.last_used_at) : t('never')}</td>
            <td>{k.is_active ? <Badge value="ACTIVE" text="Active" /> : <Badge value="DRAFT" text="Disabled" />}</td>
            <td>{k.is_active && <button type="button" className="btn btn-small" onClick={() => disable(k)}>{t('Disable')}</button>}</td>
          </tr>
        ))}
      </Table>
      {modal && (
        <Modal title="Create an API key" onClose={() => setModal(false)}>
          <SpecForm
            submitLabel="Create" onCancel={() => setModal(false)}
            fields={[{ name: 'name', label: 'Which system will use it?', required: true, wide: true, placeholder: 'e.g. City GIS server' }]}
            onSubmit={async (v) => { setCreated(await api.post('/admin/api-keys', v)); setModal(false); reload(); }}
          />
        </Modal>
      )}
    </>
  );
}

const TABS = [
  ['health', 'System health'], ['workflows', 'Approval workflows'], ['permissions', 'Roles and permissions'], ['notifications', 'Alerts and notifications'],
  ['backups', 'Backups'], ['api', 'API access'], ['settings', 'Settings'],
];

export default function System() {
  const [tab, setTab] = useState('health');
  return (
    <>
      <PageHeader title="System administration" subtitle="Health, approvals, permissions, alerts, backups and integrations. Only Super Administrators can see this page." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="System administration" />
      {tab === 'health' && <Health />}
      {tab === 'workflows' && <Workflows />}
      {tab === 'permissions' && <Permissions />}
      {tab === 'notifications' && <NotificationRules />}
      {tab === 'backups' && <Backups />}
      {tab === 'api' && <ApiKeys />}
      {tab === 'settings' && <Settings />}
    </>
  );
}
