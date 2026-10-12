import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { t } from '../i18n.jsx';

/**
 * Camera scanner for QR codes and barcodes (Code 128, Code 39, EAN ...).
 * Calls onScan(text) once per distinct read, so holding the camera steady does not repeat.
 * The browser only allows the camera on HTTPS pages or on localhost.
 */
export default function QrScanner({ onScan, paused = false }) {
  const id = `qr-${useId().replace(/:/g, '')}`;
  const last = useRef({ text: '', at: 0 });
  const handler = useRef(onScan);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  handler.current = onScan;

  useEffect(() => {
    let scanner;
    let stopped = false;
    (async () => {
      try {
        scanner = new Html5Qrcode(id, { verbose: false });
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.8); return { width: s, height: s }; } },
          (text) => {
            const now = Date.now();
            if (last.current.text === text && now - last.current.at < 4000) return;
            last.current = { text, at: now };
            handler.current(text);
          },
          () => {},
        );
        if (stopped) await scanner.stop().catch(() => {});
        setStarting(false);
      } catch (e) {
        setStarting(false);
        setError(window.isSecureContext
          ? t('The camera could not be started. Allow camera access for this site, or type the Asset ID instead.')
          : t('The camera only works on a secure (HTTPS) page. Type the Asset ID instead, or open the system through its HTTPS address.'));
        console.warn('Scanner:', e);
      }
    })();
    return () => {
      stopped = true;
      if (scanner?.isScanning) scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [id]);

  return (
    <div>
      {error && <div className="alert alert-warn" role="alert">{error}</div>}
      <div id={id} className="scanner" style={{ opacity: paused ? 0.4 : 1 }} aria-label={t('Camera view for scanning a QR code or barcode')} />
      {starting && !error && <p className="muted small" role="status">{t('Starting the camera…')}</p>}
    </div>
  );
}
