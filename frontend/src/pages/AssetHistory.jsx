import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, PageHeader, Loading, Alert, Badge, Tabs } from '../components/ui.jsx';
import { dateTime, label } from '../format.js';
import { t } from '../i18n.jsx';

export default function AssetHistory() {
  const { id } = useParams();
  const { data, error, loading } = useAsync(() => api.get(`/assets/${id}`), [id]);
  const [filter, setFilter] = useState('all');

  if (loading && !data) return <Loading text="Loading asset history…" />;
  if (error) return <Alert>{error}</Alert>;
  if (!data?.asset) return <Alert>{t('Asset not found, or it is outside your area.')}</Alert>;

  const { asset, history = [] } = data;
  const filtered = history.filter((h) => {
    if (filter === 'workflow') return h.action?.includes('STATUS') || h.action?.includes('WORKFLOW') || h.action?.includes('SUBMIT') || h.action?.includes('APPROV');
    if (filter === 'inspection') return h.action?.includes('INSPECT') || h.action?.includes('VERIF');
    if (filter === 'valuation') return h.action?.includes('VALUATION') || h.action?.includes('REVENUE');
    return true;
  });

  return (
    <>
      <PageHeader
        title={`${asset.asset_code} · ${t('Edit & Audit History')}`}
        subtitle={`${asset.name} (${asset.category_name} · ${asset.sector_name})`}
      >
        <div className="actions">
          <Link className="btn btn-small" to={`/assets/${id}`}>{t('Back to asset details')}</Link>
        </div>
      </PageHeader>

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ margin: 0 }}>{t('Complete change history')}</h2>
          <Tabs
            tabs={[
              ['all', 'All changes'],
              ['workflow', 'Workflow & Status'],
              ['inspection', 'Inspections'],
              ['valuation', 'Valuations & Financials'],
            ]}
            value={filter}
            onChange={setFilter}
            label="Filter the history"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="muted" style={{ padding: '24px 0' }}>{t('No history entries match this filter.')}</p>
        ) : (
          <ul className="timeline" style={{ marginTop: 20 }}>
            {filtered.map((h) => {
              const changes = h.changes ? Object.entries(h.changes).filter(([, v]) => v && typeof v === 'object' && 'from' in v) : [];
              return (
                <li key={h.id}>
                  <div style={{ fontWeight: 600, fontSize: '0.98rem' }}>{t(h.summary)}</div>
                  {changes.length > 0 && (
                    <div className="small muted" style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {changes.map(([k, v]) => (
                        <span key={k} style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
                          <strong>{label(k.replace(/_id$/, ''))}:</strong> {String(v.from ?? '—')} → {String(v.to ?? '—')}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="when" style={{ marginTop: 6 }}>
                    {dateTime(h.created_at)} · {h.username || t('system')}
                    {h.action && <Badge value={h.action} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
