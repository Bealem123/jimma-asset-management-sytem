import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../api.js';
import { Alert, PageHeader, SpecForm, Table } from '../components/ui.jsx';
import { t } from '../i18n.jsx';

export default function ImportPage() {
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function run(values, dryRun) {
    setResult(null);
    setErr('');
    const fd = new FormData();
    fd.append('file', values.file);
    try {
      const res = await api.post(`/assets/import${dryRun ? '?dry_run=true' : ''}`, fd);
      setResult({ ...res, dryRun });
    } catch (e) {
      setErr(e.message);
      // a rejected file comes back with every problem row
      if (e.body?.errors?.length) setResult({ ...e.body, failed: true });
    }
  }

  return (
    <>
      <PageHeader title="Import assets" subtitle="Load many assets from a spreadsheet saved as CSV. The whole file is checked first: if any row is wrong, nothing is imported.">
        <button type="button" className="btn" onClick={() => download('/assets/import/template.csv', 'asset-import-template.csv').catch((e) => setErr(e.message))}>{t('Download template')}</button>
        <Link className="btn" to="/assets">{t('Back to assets')}</Link>
      </PageHeader>
      <section className="card">
        <h2>{t('Choose a file')}</h2>
        <ul className="muted small">
          <li>{t('Required columns:')}{' '}<strong>{t('name')}</strong>, <strong>{t('category')}</strong>, <strong>{t('sector')}</strong>{' '}{t('(name or code), and a')}{' '}<strong>{t('kebele')}</strong>{' '}{t('or')}{' '}<strong>{t('kifle_ketema')}</strong>.</li>
          <li>{t('Names must match the Master data lists (for example the category "Vehicles" and the type "Pickup").')}</li>
          <li>{t('Imported assets start as')}{' '}<strong>{t('Draft')}</strong>{' '}{t('and go through the normal approval. Serial and registration numbers already in use are refused.')}</li>
          <li>{t('You can only import into your own assigned area.')}</li>
        </ul>
        <SpecForm
          submitLabel="Import now"
          fields={[{ name: 'file', label: 'CSV file', type: 'file', accept: '.csv,text/csv', required: true, wide: true }]}
          onSubmit={async (v) => { if (!v.file) { setErr(t('Choose a file.')); return; } await run(v, false); }}
        />
        <hr style={{ margin: '18px 0', border: 0, borderTop: '1px solid var(--line)' }} />
        <SpecForm
          submitLabel="Only check the file (import nothing)"
          fields={[{ name: 'file', label: 'CSV file to check', type: 'file', accept: '.csv,text/csv', required: true, wide: true }]}
          onSubmit={async (v) => { if (!v.file) { setErr(t('Choose a file.')); return; } await run(v, true); }}
        />
      </section>
      {result?.dryRun && !result.failed && <Alert kind="success">{t('The file is valid: {n} assets would be imported. Nothing was changed.', { n: result.valid })}</Alert>}
      {result && !result.dryRun && !result.failed && <Alert kind="success">{t('Imported {n} assets ({first} to {last}). They are drafts waiting to be submitted for review.', { n: result.imported, first: result.first, last: result.last })}</Alert>}
      {err && <Alert>{err}</Alert>}
      {result?.errors?.length > 0 && (
        <Table head={['Row', 'Asset', 'Problems']}>
          {result.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.name}</td><td>{e.problems.join(' · ')}</td></tr>)}
        </Table>
      )}
    </>
  );
}
