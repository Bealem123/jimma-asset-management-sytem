import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { dateTime } from '../format.js';
import { Alert, Loading, PageHeader, useAsync } from '../components/ui.jsx';
import { t } from '../i18n.jsx';

export default function Notifications({ onChange }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.get(`/notifications?limit=100${unreadOnly ? '&unread=1' : ''}`), [unreadOnly]);
  const [err, setErr] = useState('');

  async function mark(n) {
    try { await api.post(`/notifications/${n.id}/read`); reload(); onChange?.(); } catch (e) { setErr(e.message); }
  }
  async function markAll() {
    try { await api.post('/notifications/read-all'); reload(); onChange?.(); } catch (e) { setErr(e.message); }
  }

  return (
    <>
      <PageHeader title="Notifications" subtitle="Maintenance and inspections coming due, documents and leases about to expire, approvals waiting, critical assets and verification problems.">
        <button type="button" className="btn" onClick={() => setUnreadOnly(!unreadOnly)} aria-pressed={unreadOnly}>{unreadOnly ? t('Show all') : t('Unread only')}</button>
        <button type="button" className="btn" onClick={markAll}>{t('Mark all as read')}</button>
      </PageHeader>
      <Alert>{err}</Alert>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : data.length === 0 ? (
        <div className="card empty">{t('Nothing to show. You are up to date.')}</div>
      ) : (
        <ul className="notice-list">
          {data.map((n) => (
            <li key={n.id} className={n.is_read ? 'read' : 'unread'}>
              <div>
                <div className="notice-type">{t(n.type_label)} {!n.is_read && <span className="badge badge-warn">{t('New')}</span>}</div>
                <div>{n.link ? <Link to={n.link} onClick={() => !n.is_read && mark(n)}>{t(n.title)}</Link> : t(n.title)}</div>
                {n.body && <div className="muted small">{t(n.body)}</div>}
                <div className="muted small">{dateTime(n.created_at)}{n.email_status ? ` · e-mail ${n.email_status.toLowerCase()}` : ''}{n.sms_status ? ` · SMS ${n.sms_status.toLowerCase()}` : ''}</div>
              </div>
              {!n.is_read && <button type="button" className="btn btn-small" onClick={() => mark(n)}>{t('Mark as read')}</button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
