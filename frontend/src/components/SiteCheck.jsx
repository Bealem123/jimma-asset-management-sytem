import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from '../api.js';
import { label, today } from '../format.js';
import { Alert, Field, Loading } from './ui.jsx';
import AuthImage from './AuthImage.jsx';
import { t } from '../i18n.jsx';
import { shrinkPhoto } from '../images.js';

// On-site verification of a newly registered asset (the Kebele Administrator's step). Done on a phone at the asset:
// the phone's location, a scan of the asset's QR label (when it has one), a photo taken there and the condition found.

const QrScanner = lazy(() => import('./QrScanner.jsx'));

/** Distance in metres between two points (haversine); the server repeats this calculation. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const isOwnLabel = (text, code) => Boolean(text) && (text.trim() === code || text.trim().endsWith(`/scan/${code}`));

function Step({ n, title, done, children }) {
  return (
    <section className={`site-step${done ? ' done' : ''}`}>
      <h3><span className="site-step-n" aria-hidden="true">{done ? '✓' : n}</span>{t(title)}</h3>
      {children}
    </section>
  );
}

export default function SiteCheck({ asset, maxDistance, onDone, onCancel }) {
  const [pos, setPos] = useState(null); // { latitude, longitude, accuracy_m }
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [qr, setQr] = useState('');
  const [noLabel, setNoLabel] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [condition, setCondition] = useState(asset.condition);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadedId, setUploadedId] = useState(null); // the photo, once sent

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function locate() {
    setLocError('');
    if (!('geolocation' in navigator)) { setLocError(t('This browser cannot give a location. Use a phone with location turned on.')); return; }
    if (!window.isSecureContext) { setLocError(t('The location only works on a secure (HTTPS) page. Open the system through its HTTPS address.')); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) }); setLocating(false); },
      (e) => {
        setLocating(false);
        setLocError(e.code === 1
          ? t('Location access was refused. Allow location for this site in the browser settings, then try again.')
          : t('Your location could not be found. Turn on location (GPS), step outside if you can, and try again.'));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const small = await shrinkPhoto(file, 'site-verification.jpg');
    setPhoto(small);
    setUploadedId(null);
    setPreview(URL.createObjectURL(small));
  }

  const recorded = asset.latitude != null && asset.longitude != null;
  const distance = pos && recorded ? distanceMeters(asset.latitude, asset.longitude, pos.latitude, pos.longitude) : null;
  const allowed = Math.max(maxDistance, pos?.accuracy_m || 0);
  const far = distance != null && distance > allowed;
  const ownLabel = isOwnLabel(qr, asset.asset_code);
  const ready = pos && photo && condition;

  async function submit(e) {
    e.preventDefault();
    if (!ready) { setError(t('Get your location, take a photo and choose the condition you found.')); return; }
    setBusy(true); setError('');
    try {
      let docId = uploadedId;
      if (!docId) {
        const form = new FormData();
        form.append('doc_type', 'PHOTO');
        form.append('title', t('Site verification photo, {date}', { date: today() }));
        form.append('related_type', 'VERIFICATION');
        form.append('file', photo);
        docId = (await api.post(`/assets/${asset.id}/documents`, form)).id;
        setUploadedId(docId);
      }
      await api.post(`/assets/${asset.id}/workflow`, {
        action: 'review',
        evidence: { ...pos, qr_code: qr || null, found_condition: condition, photo_document_id: docId, note: note.trim() || null },
      });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="site-check">
      <p className="muted" style={{ marginTop: 0 }}>
        {t('Do this at the asset, on your phone. The Kifle Ketema Administrator sees this evidence before approving. If the asset is not as recorded, send it back instead.')}
      </p>

      <Step n={1} title="Your location" done={Boolean(pos)}>
        {pos ? (
          <div className="site-result">
            <div>{pos.latitude.toFixed(6)}, {pos.longitude.toFixed(6)} <span className="muted small">± {pos.accuracy_m} m</span></div>
            {distance != null && (
              <span className={`badge badge-${far ? 'bad' : 'good'}`}>
                {far ? t('{n} m from the recorded location: further than the {max} m allowed', { n: distance, max: allowed }) : t('{n} m from the recorded location', { n: distance })}
              </span>
            )}
            {!recorded && <span className="badge badge-info">{t('No location was recorded: this one will be saved as the asset\'s location')}</span>}
            <button type="button" className="btn btn-small" onClick={locate} disabled={locating}>{t('Measure again')}</button>
          </div>
        ) : <button type="button" className="btn btn-primary" onClick={locate} disabled={locating}>{locating ? t('Finding your location…') : t('Get my location')}</button>}
        {locError && <Alert kind="warn">{locError}</Alert>}
      </Step>

      <Step n={2} title="Scan the QR label" done={ownLabel || noLabel}>
        {qr ? (
          <div className="site-result">
            {ownLabel ? <span className="badge badge-good">{t('The label belongs to this asset')}</span>
              : <span className="badge badge-bad">{t('This label is not {code}\'s: {text}', { code: asset.asset_code, text: qr })}</span>}
            <button type="button" className="btn btn-small" onClick={() => { setQr(''); setScanning(true); }}>{t('Scan again')}</button>
          </div>
        ) : scanning ? (
          <>
            <Suspense fallback={<Loading />}><QrScanner onScan={(text) => { setQr(text); setScanning(false); }} /></Suspense>
            <button type="button" className="btn btn-small" onClick={() => setScanning(false)}>{t('Stop the camera')}</button>
          </>
        ) : (
          <div className="site-result">
            <button type="button" className="btn btn-primary" onClick={() => { setScanning(true); setNoLabel(false); }}>{t('Scan the label')}</button>
            <label className="check"><input type="checkbox" checked={noLabel} onChange={(e) => setNoLabel(e.target.checked)} /> {t('The asset has no label yet')}</label>
          </div>
        )}
      </Step>

      <Step n={3} title="Take a photo of the asset" done={Boolean(photo)}>
        <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} aria-label={t('Take a photo of the asset')} />
        {preview && <img src={preview} alt={t('The photo that will be sent')} className="site-photo" />}
      </Step>

      <Step n={4} title="What you found" done={Boolean(condition)}>
        <div className="form-grid">
          <Field label="Condition found" id="site-condition" required>
            <select id="site-condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
              {['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL'].map((c) => <option key={c} value={c}>{label(c)}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)" id="site-note" help="e.g. where exactly it stands, who showed it to you">
            <input id="site-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        </div>
        {condition !== asset.condition && <p className="muted small">{t('Recorded as {a}; you found it {b}. The approver will see the difference.', { a: label(asset.condition), b: label(condition) })}</p>}
      </Step>

      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !ready}>{busy ? t('Sending…') : t('Verify on site')}</button>
      </div>
    </form>
  );
}

/** The evidence from the latest site check, as the approver sees it on the asset page. */
export function SiteEvidence({ checks, assetPath, maxDistance, recordedCondition }) {
  const [c] = checks;
  if (!c) return null;
  const map = `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=18/${c.latitude}/${c.longitude}`;
  return (
    <section className="card site-evidence">
      <div className="card-head">
        <h2>{t('Verified on site')}</h2>
        <p className="muted small">{t('by {name} on {date}', { name: c.checked_by_name || '—', date: String(c.created_at).replace('T', ' ').slice(0, 16) })}</p>
      </div>
      <div className="site-evidence-body">
        {c.photo_document_id && <AuthImage path={`${assetPath}/documents/${c.photo_document_id}/download`} alt={t('Photo taken on site')} width={180} className="site-photo" />}
        <ul className="plain-list">
          <li>
            <span>{t('Where')}</span>
            {c.location_saved ? <span className="badge badge-info">{t('No location was recorded: this one was saved')}</span>
              : <span className={`badge badge-${c.far ? 'bad' : 'good'}`}>{c.far ? t('{n} m from the recorded location: further than allowed ({max} m)', { n: c.distance_m, max: maxDistance }) : t('{n} m from the recorded location', { n: c.distance_m })}</span>}
          </li>
          <li><span>{t('QR label')}</span><span className={`badge badge-${c.qr_scanned ? 'good' : 'warn'}`}>{c.qr_scanned ? t('Scanned on site') : t('Not scanned')}</span></li>
          <li>
            <span>{t('Condition found')}</span>
            <span>{label(c.found_condition)}{recordedCondition && c.found_condition !== recordedCondition && <> <span className="badge badge-warn">{t('recorded as {c}', { c: label(recordedCondition) })}</span></>}</span>
          </li>
          {c.note && <li><span>{t('Note')}</span><span>{c.note}</span></li>}
          <li><span>{t('Position')}</span><a href={map} target="_blank" rel="noreferrer">{Number(c.latitude).toFixed(5)}, {Number(c.longitude).toFixed(5)}{c.accuracy_m != null ? ` (± ${c.accuracy_m} m)` : ''}</a></li>
        </ul>
      </div>
    </section>
  );
}
