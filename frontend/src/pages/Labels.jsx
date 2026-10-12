import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { api } from '../api.js';
import { Alert, Loading, PageHeader, useAsync } from '../components/ui.jsx';
import AuthImage from '../components/AuthImage.jsx';
import { t } from '../i18n.jsx';

function Barcode({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: 'CODE128', height: 34, width: 1.4, displayValue: false, margin: 0 });
  }, [value]);
  return <svg ref={ref} className="barcode" role="img" aria-label={`Barcode ${value}`} />;
}

/** Printable labels: a QR code (scanned by phone or camera) and a Code 128 barcode (scanned by a barcode reader), plus the Asset ID in words. */
export default function Labels() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
  const [size, setSize] = useState('medium');
  const [withBarcode, setWithBarcode] = useState(true);
  const { data, error, loading } = useAsync(
    () => Promise.all(ids.map((id) => api.get(`/assets/${id}`).then((r) => r.asset).catch(() => null))),
    [ids.join(',')],
  );

  if (!ids.length) return <Alert kind="info">{t('Choose assets in the asset list (tick the boxes) or open one asset and use QR label.')} <Link to="/assets">{t('Assets')}</Link></Alert>;
  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const assets = data.filter(Boolean);

  return (
    <>
      <PageHeader title="QR labels" subtitle={t('{n} label(s). Print on adhesive paper or weatherproof tags, and fix one to each asset.', { n: assets.length })}>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>{t('Print')}</button>
      </PageHeader>
      <div className="filters no-print">
        <div className="field">
          <label htmlFor="lab-size">{t('Label size')}</label>
          <select id="lab-size" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="small">{t('Small (about 5 cm)')}</option>
            <option value="medium">{t('Medium (about 7 cm)')}</option>
            <option value="large">{t('Large (about 10 cm)')}</option>
          </select>
        </div>
        <label className="check"><input type="checkbox" checked={withBarcode} onChange={(e) => setWithBarcode(e.target.checked)} />{' '}{t('Include a barcode')}</label>
      </div>
      <div className={`labels labels-${size}`}>
        {assets.map((a) => (
          <figure key={a.id} className="label">
            <AuthImage path={`/assets/${a.id}/qr.svg`} alt={`QR code ${a.asset_code}`} width={size === 'small' ? 100 : size === 'large' ? 190 : 140} />
            <figcaption>
              <strong className="label-code">{a.asset_code}</strong>
              <span className="label-name">{a.name}</span>
              <span className="label-org">{t('Jimma City Administration')}</span>
            </figcaption>
            {withBarcode && <Barcode value={a.asset_code} />}
          </figure>
        ))}
      </div>
      {assets.length < ids.length && <Alert kind="warn">{t('{n} asset(s) could not be found or are outside your area.', { n: ids.length - assets.length })}</Alert>}
    </>
  );
}
