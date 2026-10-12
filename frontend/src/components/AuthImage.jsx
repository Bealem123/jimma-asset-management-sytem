import { useEffect, useState } from 'react';
import { fetchObjectUrl } from '../api.js';

/** An image served by an authenticated endpoint (the browser cannot send the token on a plain <img src>). */
export default function AuthImage({ path, alt, width = 160, className }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url = '';
    let cancelled = false;
    fetchObjectUrl(path).then((u) => { url = u; if (!cancelled) setSrc(u); else URL.revokeObjectURL(u); }).catch(() => setFailed(true));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (failed) return <span className="muted small">Image unavailable</span>;
  if (!src) return <span className="muted small" style={{ display: 'inline-block', width, height: width }}>Loading…</span>;
  return <img className={className} src={src} alt={alt} width={width} height={width} />;
}
