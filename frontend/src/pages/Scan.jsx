import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { Alert, PageHeader } from '../components/ui.jsx';
import QrScanner from '../components/QrScanner.jsx';
import { t } from '../i18n.jsx';

/**
 * Scan an asset's QR code or barcode to open its record. The scan is logged (who, when, where).
 * Also the landing page for /scan/AST-000125, which is what a printed QR code opens on an ordinary phone camera.
 */
export default function Scan() {
  const { code: urlCode } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('LOOKUP');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(!urlCode);
  const ran = useRef(false);

  async function open(text, context = mode) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let coords = {};
      if (navigator.geolocation) {
        coords = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }),
            () => resolve({}),
            { timeout: 4000 },
          );
        });
      }
      const asset = await api.post('/assets/scan', { code: text, context, ...coords });
      navigate(`/assets/${asset.id}${context === 'INSPECTION' ? '?action=inspect&scan=1' : ''}`, { replace: Boolean(urlCode) });
    } catch (e) {
      setError(e.status === 404 ? 'No asset with this code in your area.' : e.message);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (urlCode && !ran.current) { ran.current = true; open(urlCode, 'LOOKUP'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCode]);

  return (
    <>
      <PageHeader title="Scan an asset" subtitle="Point the camera at the QR code or barcode on the asset, or type its Asset ID." />
      <Alert>{error}</Alert>
      {urlCode && busy && <p className="muted" role="status">{t('Opening {code}…', { code: urlCode })}</p>}
      <section className="card">
        <div className="actions" role="group" aria-label={t('What to do after scanning')} style={{ marginBottom: 12 }}>
          <button type="button" className={`btn btn-small${mode === 'LOOKUP' ? ' btn-primary' : ''}`} aria-pressed={mode === 'LOOKUP'} onClick={() => setMode('LOOKUP')}>{t('Open the asset')}</button>
          {can.inspect(user) && <button type="button" className={`btn btn-small${mode === 'INSPECTION' ? ' btn-primary' : ''}`} aria-pressed={mode === 'INSPECTION'} onClick={() => setMode('INSPECTION')}>{t('Start an inspection')}</button>}
          {can.verify(user) && <Link className="btn btn-small" to="/verification">{t('Physical verification…')}</Link>}
        </div>
        {camera ? <QrScanner onScan={(t) => open(t)} paused={busy} /> : <button type="button" className="btn" onClick={() => setCamera(true)}>{t('Use the camera')}</button>}
        <form className="actions" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) open(typed.trim()); }}>
          <label className="sr-only" htmlFor="scan-code">{t('Asset ID')}</label>
          <input id="scan-code" placeholder={t('Asset ID, e.g. AST-000125')} maxLength={300} autoCapitalize="characters" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} style={{ maxWidth: 300 }} />
          <button type="submit" className="btn" disabled={busy}>{t('Open')}</button>
        </form>
      </section>
      <p className="muted small">{t('Scanning needs the camera. Browsers only allow that on secure (HTTPS) pages. Every scan is recorded with who scanned and when.')}</p>
    </>
  );
}
