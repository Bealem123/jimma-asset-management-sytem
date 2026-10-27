import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { etb, label, num } from '../format.js';
import {
  Alert, Field, FilterBar, FilterSearch, FilterSelect, Loading, PageHeader, SpecForm, Table, enumOpt, useAsync, useFilters,
} from '../components/ui.jsx';
import { bothDates, periodName, periodSpan } from '../ethiopian.js';
import { t, getLanguage } from '../i18n.jsx';

// Monthly reports up the chain of responsibility: each person confirms the report of their area and sends it to their
// boss, who accepts it or returns it. Sector -> Kebele; Kebele, Financial Officer, Inspector -> Kifle Ketema;
// Kifle Ketema, Internal Auditor -> Mayor. The Super Administrator follows them all. Every date shows both calendars.

const STATUS = {
  ACCEPTED: ['good', 'Accepted'],
  SUBMITTED: ['info', 'Sent, waiting for a decision'],
  RETURNED: ['warn', 'Returned for correction'],
};

function Status({ item }) {
  const [tone, text] = STATUS[item.status] || (item.late ? ['bad', 'Late: not sent'] : ['neutral', 'Not sent yet']);
  return (
    <>
      <span className={`badge badge-${tone}`}>{t(text)}</span>
      {item.status === 'RETURNED' && item.late && <span className="badge badge-bad">{t('Late')}</span>}
      {item.sent_late && item.status !== 'RETURNED' && <div className="muted small">{t('Sent after the deadline')}</div>}
    </>
  );
}

// one filter for both lists: the statuses a report can be in, with "late" across them
const STATUS_FILTER = [['', 'Any status'], ['unsent', 'Not sent yet'], ['late', 'Late'], ['SUBMITTED', 'Sent, waiting for a decision'], ['RETURNED', 'Returned for correction'], ['ACCEPTED', 'Accepted']];
const statusOptions = STATUS_FILTER.map(([value, text]) => ({ value, label: text }));
const matchesStatus = (x, s) => !s || (s === 'unsent' ? !x.status : s === 'late' ? Boolean(x.late) : x.status === s);

const Month = ({ p }) => <><strong>{periodName(p)}</strong>{periodSpan(p) && <div className="muted small">{periodSpan(p)}</div>}</>;

export const areaLabel = (a) => (a.city ? t('Whole city') : [...a.sectors, ...a.kebeles, ...a.kifle].map((x) => t(x)).join(' · ') || '—');

/** The figures of a report, as the system generated them. */
function Figures({ snapshot }) {
  const show = (r) => (r.kind === 'money' ? etb(r.value) : r.kind === 'text' ? r.value : num(r.value));
  return (
    <div className="grid grid-2">
      {snapshot.sections.map((s) => (
        <section key={s.title} className="card">
          <h3>{t(s.title)}</h3>
          {s.note && <p className="muted small">{t(s.note)}</p>}
          {s.rows.length === 0 ? <p className="muted">{t('Nothing recorded.')}</p> : (
            <dl className="role-list">
              {s.rows.map((r) => <div key={r.label}><dt>{r.kind === 'action' ? label(r.label) : t(r.label)}</dt><dd>{show(r)}</dd></div>)}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}

const BackToList = () => <Link className="btn" to="/monthly-reports">{t('All monthly reports')}</Link>;

// ---------------------------------------------------------------------------------------------- one report (its own page)

export function MonthlyReportPage() {
  const { id } = useParams();
  const { data: r, error, loading, reload } = useAsync(() => api.get(`/monthly-reports/report/${id}`), [id]);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(action) {
    setProblem('');
    if (action === 'return' && !note.trim()) { setProblem(t('Write what must be corrected.')); return; }
    setBusy(true);
    try {
      await api.post(`/monthly-reports/report/${id}/${action}`, { note: note.trim() || undefined });
      await reload();
      setDone(t(action === 'accept' ? 'Accepted' : 'Returned for correction'));
    } catch (e) { setProblem(e.message); } finally { setBusy(false); }
  }

  if (loading && !r) return <Loading />;
  if (error) return <><PageHeader title="Monthly report"><BackToList /></PageHeader><Alert>{error}</Alert></>;
  return (
    <>
      <PageHeader title={`${r.reporter.full_name} · ${periodName(r.period)}`}><BackToList /></PageHeader>
      <Alert kind="success">{done}</Alert>
      {r.can_resend && (
        <Alert kind="warn">
          {t('Returned for correction:')} “{r.decision_note}”{' '}
          <Link className="btn btn-small btn-primary" to={`/monthly-reports/prepare/${r.period.key}`}>{t('Correct and send again')}</Link>
        </Alert>
      )}
      <section className="card">
        <dl className="role-list">
          <div><dt>{t('From')}</dt><dd>{r.reporter.full_name} ({label(r.reporter.role)}) · {areaLabel(r.area)}</dd></div>
          <div><dt>{t('Month')}</dt><dd>{periodName(r.period)}{periodSpan(r.period) && <span className="muted"> ({periodSpan(r.period)})</span>}</dd></div>
          <div><dt>{t('Status')}</dt><dd><Status item={r} /></dd></div>
          <div><dt>{t('Sent')}</dt><dd>{bothDates(r.submitted_at)}{r.version > 1 && <span className="muted"> · {t('version {n}', { n: r.version })}</span>}</dd></div>
          <div><dt>{t('Deadline')}</dt><dd>{bothDates(r.deadline)}</dd></div>
          {r.decided_by && <div><dt>{t(r.status === 'RETURNED' ? 'Returned by' : 'Accepted by')}</dt><dd>{r.decided_by.full_name} · {bothDates(r.decided_at)}{r.decision_note && <div>“{r.decision_note}”</div>}</dd></div>}
        </dl>
        <h3>{t('Comments of the sender')}</h3>
        <p>{r.comment || <span className="muted">{t('No comments.')}</span>}</p>
      </section>
      <div style={{ marginTop: 16 }}><Figures snapshot={r.snapshot} /></div>
      <p className="muted small">{t('Figures generated by the system on {date}.', { date: bothDates(r.snapshot.generated_at) })}</p>
      {r.can_decide && (
        <section className="card">
          <h3>{t('Your decision')}</h3>
          <Alert>{problem}</Alert>
          <Field id="decision-note" label="Note (required to return the report)">
            <textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => decide('return')}>{t('Return for correction')}</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('accept')}>{t('Accept')}</button>
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------- preparing one's own report (its own page)

export function PrepareReportPage() {
  const { periodKey } = useParams();
  const navigate = useNavigate();
  const mine = useAsync(() => api.get('/monthly-reports'), []);
  const preview = useAsync(() => api.get(`/monthly-reports/preview/${periodKey}`), [periodKey]);
  if (mine.loading && !mine.data) return <Loading />;
  if (mine.error) return <><PageHeader title="Monthly report"><BackToList /></PageHeader><Alert>{mine.error}</Alert></>;
  const item = mine.data.periods.find((p) => p.period.key === periodKey);
  if (!item) return <><PageHeader title="Monthly report"><BackToList /></PageHeader><Alert>{t('Unknown reporting period.')}</Alert></>;
  const title = t('Monthly report: {month}', { month: periodName(item.period) });
  if (item.report && item.report.status !== 'RETURNED') {
    return <><PageHeader title={title}><BackToList /></PageHeader><Alert kind="info">{t('This report has already been sent.')}</Alert></>;
  }
  return (
    <>
      <PageHeader title={title}><BackToList /></PageHeader>
      {item.report?.status === 'RETURNED' && (
        <Alert kind="warn">{t('Returned for correction:')} “{item.report.decision_note}”</Alert>
      )}
      <p className="muted">{t('The system has prepared the figures of your area. Check them, add your comments (what went well, what is wrong, what you need), then confirm and send.')}</p>
      {preview.loading ? <Loading /> : preview.error ? <Alert>{preview.error}</Alert> : <Figures snapshot={preview.data} />}
      <section className="card" style={{ marginTop: 16 }}>
        <SpecForm
          submitLabel="Confirm and send"
          initial={{ comment: item.report?.comment || '', confirm: false }}
          fields={[
            { name: 'comment', label: 'Your comments', type: 'textarea', rows: 5, wide: true, maxLength: 4000, help: 'If some reports from your team are missing, explain why here.' },
            { name: 'confirm', type: 'checkbox', label: 'Confirmation', checkLabel: 'I confirm that these figures and my comments are correct.', wide: true },
          ]}
          onCancel={() => navigate('/monthly-reports')}
          onSubmit={async (v) => {
            if (!v.confirm) throw new ApiError(400, '', { confirm: t('Tick the box to confirm the report.') });
            await api.post(`/monthly-reports/${item.period.key}/submit`, { comment: v.comment });
            navigate('/monthly-reports', { state: { flash: t('Report for {month} sent.', { month: periodName(item.period) }) } });
          }}
        />
      </section>
    </>
  );
}

function MyReports({ data }) {
  const [f, setF, clear, any] = useFilters(['my_status']);
  const periods = data.periods.filter((item) => matchesStatus(item, f.my_status));
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Your monthly reports')}</h2>
      </div>
      <p className="muted">
        {data.reviewers.length
          ? t('Sent to {names} ({role}), due {n} days after the month ends.', { names: data.reviewers.map((r) => r.full_name).join(', '), role: label(data.sends_to), n: data.deadline_days })
          : t('Nobody receives your report yet: the {role} of your area has no active account.', { role: label(data.sends_to) })}
      </p>
      <FilterBar any={any} onClear={clear}>
        <FilterSelect id="my-sta" text="Status" value={f.my_status} onChange={(v) => setF('my_status', v)} options={statusOptions} />
      </FilterBar>
      <Table head={['Month', 'Deadline', 'Status', 'Sent', '']} empty={periods.length === 0 && 'Nothing matches these filters.'}>
        {periods.map((item) => (
          <tr key={item.period.key}>
            <td><Month p={item.period} /></td>
            <td className="small">{bothDates(item.deadline)}</td>
            <td><Status item={item} /></td>
            <td className="small">{item.report ? bothDates(item.report.submitted_at) : '—'}</td>
            <td>
              <div className="actions">
                {(!item.report || item.report.status === 'RETURNED') && <Link className="btn btn-small btn-primary" to={`/monthly-reports/prepare/${item.period.key}`}>{t(item.report ? 'Correct and send again' : 'Prepare and send')}</Link>}
                {item.report && <Link className="btn btn-small" to={`/monthly-reports/report/${item.report.id}`}>{t('Open')}</Link>}
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- the reports that come to the user

function TeamReports({ period, onPeriod }) {
  const { data, error, loading } = useAsync(() => api.get(`/monthly-reports/team${period ? `?period=${period}` : ''}`), [period]);
  const [f, setF, clear, any] = useFilters(['q', 'role', 'status']);
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const m = data.members;
  const count = (fn) => m.filter(fn).length; // the totals are of everyone, whatever the filters
  const needle = f.q.trim().toLowerCase();
  const shown = m.filter((x) => (!f.role || x.user.role === f.role) && matchesStatus(x, f.status)
    && (!needle || [x.user.full_name, x.user.username, areaLabel(x.area)].some((s) => String(s).toLowerCase().includes(needle))));
  const roles = [...new Set(m.map((x) => x.user.role))];
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t(data.decides ? 'Reports sent to you' : 'All monthly reports')}</h2>
        <select value={data.period.key} onChange={(e) => onPeriod(e.target.value)} aria-label={t('Month')}>
          {[data.period, ...data.periods.filter((p) => p.key !== data.period.key)].map((p) => <option key={p.key} value={p.key}>{periodName(p)}{periodSpan(p) && ` (${periodSpan(p)})`}</option>)}
        </select>
      </div>
      {!data.decides && (
        <p className="muted">
          {t('You follow every report; each one is accepted or returned by the person it is sent to.')}
          {' '}{t('You see whether each report was sent and decided, not what it says: that stays between the sender and the person it is sent to.')}
        </p>
      )}
      <p className="small">
        {t('{sent} of {total} sent', { sent: count((x) => ['SUBMITTED', 'ACCEPTED'].includes(x.status)), total: m.length })}
        {' · '}{t('{n} waiting for a decision', { n: count((x) => x.status === 'SUBMITTED') })}
        {' · '}{t('{n} accepted', { n: count((x) => x.status === 'ACCEPTED') })}
        {' · '}<span className={count((x) => x.late) ? 'text-bad' : undefined}>{t('{n} late', { n: count((x) => x.late) })}</span>
      </p>
      {m.length > 0 && (
        <FilterBar any={any} onClear={clear}>
          <FilterSearch id="tr-q" value={f.q} onChange={(v) => setF('q', v)} placeholder="Name, username or area" />
          {roles.length > 1 && <FilterSelect id="tr-role" text="Role" value={f.role} onChange={(v) => setF('role', v)} options={enumOpt(roles, { blank: 'All roles' })} />}
          <FilterSelect id="tr-sta" text="Status" value={f.status} onChange={(v) => setF('status', v)} options={statusOptions} />
        </FilterBar>
      )}
      <Table head={['Name', 'Role', 'Area', 'Status', 'Deadline', 'Sent', '']}
        empty={shown.length === 0 && (m.length === 0 ? 'Nobody sends you a monthly report yet.' : 'Nothing matches these filters.')}>
        {shown.map((x) => (
          <tr key={x.user.id}>
            <td>{x.user.full_name}<div className="muted small">{x.user.username}</div></td>
            <td>{label(x.user.role)}</td>
            <td>{areaLabel(x.area)}</td>
            <td><Status item={x} /></td>
            <td className="small">{bothDates(x.deadline)}</td>
            <td className="small">{x.report ? bothDates(x.report.submitted_at) : '—'}</td>
            <td>{data.decides && x.report && <Link className={`btn btn-small${x.can_decide ? ' btn-primary' : ''}`} to={`/monthly-reports/report/${x.report.id}`}>{t(x.can_decide ? 'Review' : 'Open')}</Link>}</td>
          </tr>
        ))}
      </Table>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- the page

const SUBTITLE = {
  SECTOR_ADMIN: 'Each month, confirm the report of your sector and send it to your Kebele Administrator.',
  KEBELE_ADMIN: 'Review the reports of your Sector Administrators, then send the report of your Kebele to your Kifle Ketema Administrator.',
  FINANCIAL_OFFICER: 'Each month, confirm the financial report of your Kifle Ketema and send it to its Kifle Ketema Administrator.',
  INSPECTOR: 'Each month, confirm the report of your inspections and send it to your Kifle Ketema Administrator.',
  KIFLE_ADMIN: 'Review the reports of your Kebele Administrators, Financial Officers and Inspectors, then send the report of your Kifle Ketema to the Mayor.',
  AUDITOR: 'Each month, send your independent report directly to the Mayor.',
  EXECUTIVE: 'The confirmed monthly reports of the Kifle Ketemas and of the Internal Auditor.',
  SUPER_ADMIN: 'Follow whether the monthly reports are sent on time at every level.',
};

export default function MonthlyReports() {
  const { user } = useAuth();
  const [search, setSearch] = useSearchParams();
  const { data, error, loading } = useAsync(() => api.get('/monthly-reports'), []);
  const flash = useLocation().state?.flash || ''; // "Report for ... sent." after sending from its own page
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <>
      <PageHeader title="Monthly reports" subtitle={SUBTITLE[user.role]} />
      <Alert kind="success">{flash}</Alert>
      <p className="muted small">
        {getLanguage() === 'en' // in English only Gregorian dates are shown
          ? (data.calendar === 'ET' ? 'Reporting months follow the Ethiopian calendar and are shown by their dates.' : 'Reporting months follow the Gregorian calendar.')
          : t(data.calendar === 'ET' ? 'Months follow the Ethiopian calendar; the Gregorian dates are shown beside them.' : 'Months follow the Gregorian calendar; the Ethiopian dates are shown beside them.')}
        {' '}{t('Today: {date}', { date: bothDates(data.today) })}
      </p>
      {data.sends && <MyReports data={data} />}
      {data.receives && (
        <TeamReports
          period={search.get('period')}
          onPeriod={(key) => { const next = new URLSearchParams(search); next.set('period', key); setSearch(next, { replace: true }); }}
        />
      )}
    </>
  );
}
