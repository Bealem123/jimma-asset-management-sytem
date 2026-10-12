import { useEffect, useRef, useState } from 'react';
import { api, fetchObjectUrl } from '../api.js';
import { t } from '../i18n.jsx';
import { Modal } from './ui.jsx';

// Profile pictures are fetched with the session token (an <img> cannot send it) and kept for the life of the page:
// one object URL per user and picture version, so a new picture is fetched once and an old one is never shown again.
const pending = new Map(); // `${id}:${version}` -> Promise<string | null>
const ready = new Map(); // `${id}:${version}` -> object URL

export const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function load(key, user) {
  if (!pending.has(key)) {
    pending.set(key, fetchObjectUrl(`/auth/photo/${user.id}?v=${user.photo}`)
      .then((url) => { ready.set(key, url); return url; })
      .catch(() => { pending.delete(key); return null; }));
  }
  return pending.get(key);
}

/** The user's profile picture, or their initials when they have none. */
export function Avatar({ user, size }) {
  const key = user?.photo ? `${user.id}:${user.photo}` : null;
  const [src, setSrc] = useState(() => (key ? ready.get(key) ?? null : null));
  useEffect(() => {
    if (!key) { setSrc(null); return undefined; }
    let live = true;
    setSrc(ready.get(key) ?? null);
    load(key, user).then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(user?.full_name)}
    </span>
  );
}

// ---------------------------------------------------------------- cropping

const VIEW = 280; // the crop frame on screen, in CSS pixels
const SIDE = 480; // the saved picture, in pixels: sharp at every size it is shown, and only a few dozen kilobytes
const MAX_ZOOM = 5;

/**
 * Choose the part of a picture to keep: drag to move it, zoom with the slider (or the mouse wheel), rotate in
 * quarter turns. The round guide shows how it will look; the saved picture is the whole square.
 * `src` is an object URL; `onDone` gets a JPEG blob.
 */
function CropDialog({ src, onCancel, onDone, onError }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0); // 0, 90, 180, 270
  const [pos, setPos] = useState({ x: 0, y: 0 }); // the picture's centre, from the frame's centre, in screen pixels
  const [saving, setSaving] = useState(false);
  const view = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => onError(t('This file is not a picture. Use a JPG, PNG or WebP picture.'));
    i.src = src;
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const w = img?.naturalWidth || 1;
  const h = img?.naturalHeight || 1;
  const turned = rot % 180 !== 0;
  const base = VIEW / Math.min(w, h); // at zoom 1 the picture just covers the frame
  const scale = base * zoom;
  // the picture always covers the whole frame: its centre may move only as far as its overhang
  const clamp = (p, z = zoom, r = rot) => {
    const s = base * z;
    const [ew, eh] = r % 180 ? [h * s, w * s] : [w * s, h * s];
    const mx = Math.max(0, (ew - VIEW) / 2);
    const my = Math.max(0, (eh - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const zoomTo = (z) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(next);
    setPos((p) => clamp({ x: (p.x * next) / zoom, y: (p.y * next) / zoom }, next)); // keep the same spot in the middle
  };

  // the wheel needs a non-passive listener to stop the page scrolling while zooming
  useEffect(() => {
    const el = view.current;
    if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: pos };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (d) setPos(clamp({ x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y }));
  };
  const onPointerUp = () => { drag.current = null; };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 30 : 8;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { e.preventDefault(); setPos((p) => clamp({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1] })); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(zoom * 1.1); }
    if (e.key === '-') { e.preventDefault(); zoomTo(zoom / 1.1); }
  };
  const rotate = () => {
    const next = (rot + 90) % 360;
    setRot(next);
    setPos((p) => clamp({ x: -p.y, y: p.x }, zoom, next));
  };

  async function save() {
    setSaving(true);
    // draw exactly what the frame shows, at the saved size
    const out = Math.max(160, Math.min(SIDE, Math.round(VIEW / scale)));
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // a transparent PNG gets a white background
    ctx.fillRect(0, 0, out, out);
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(out / VIEW, out / VIEW);
    ctx.translate(VIEW / 2 + pos.x, VIEW / 2 + pos.y);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, (-w * scale) / 2, (-h * scale) / 2, w * scale, h * scale);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    onDone(blob);
  }

  return (
    <Modal title="Crop the picture" onClose={onCancel}>
      <div className="crop">
        <div
          ref={view}
          className="crop-view"
          style={{ width: VIEW, height: VIEW }}
          tabIndex={0}
          role="application"
          aria-label={t('Picture. Drag or use the arrow keys to move it, + and - to zoom.')}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {img && (
            <img
              src={src} alt="" draggable={false}
              style={{
                width: w * scale, height: h * scale, left: VIEW / 2 + pos.x, top: VIEW / 2 + pos.y,
                transform: `translate(-50%, -50%) rotate(${rot}deg)`,
              }}
            />
          )}
          <span className="crop-ring" aria-hidden="true" />
        </div>
        <p className="muted small">{t('Drag the picture to choose what shows inside the circle.')}</p>
        <div className="crop-tools">
          <label className="crop-zoom">
            <span>{t('Zoom')}</span>
            <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} disabled={!img} />
          </label>
          <button type="button" className="btn btn-small" onClick={rotate} disabled={!img}>{t('Rotate')} ↻</button>
        </div>
        <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!img || saving}>{saving ? t('Saving…') : t('Use this picture')}</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Show a profile picture with buttons to add, crop, change or remove it. `path` is the API path of that picture
 * (/auth/photo for my own, /users/:id/photo for an account I manage); `onChanged` gets the new version or null.
 */
export function PhotoPicker({ user, path, onChanged, size = 88 }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropping, setCropping] = useState(null); // { src, own } — `own`: an object URL made here, to release after

  const closeCrop = () => {
    if (cropping?.own) URL.revokeObjectURL(cropping.src);
    setCropping(null);
  };

  async function run(work) {
    setBusy(true);
    setError('');
    try {
      onChanged(await work());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again still fires a change
    if (!file) return;
    setError('');
    setCropping({ src: URL.createObjectURL(file), own: true });
  }

  // crop the current picture again
  async function recrop() {
    const url = await load(`${user.id}:${user.photo}`, user);
    if (url) setCropping({ src: url, own: false });
  }

  function upload(blob) {
    closeCrop();
    run(async () => {
      const form = new FormData();
      form.append('photo', blob, 'photo.jpg');
      return (await api.put(path, form)).photo;
    });
  }

  return (
    <div className="photo-picker">
      <Avatar user={user} size={size} />
      <div>
        <div className="actions">
          <label className={`btn btn-small btn-primary photo-pick${busy ? ' is-busy' : ''}`}>
            {busy ? t('Saving…') : t(user.photo ? 'Change picture' : 'Add picture')}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} disabled={busy} />
          </label>
          {user.photo && <button type="button" className="btn btn-small" disabled={busy} onClick={recrop}>{t('Crop picture')}</button>}
          {user.photo && (
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => run(async () => { await api.del(path); return null; })}>
              {t('Remove picture')}
            </button>
          )}
        </div>
        <p className="muted small">{t('JPG, PNG or WebP. After choosing a picture you can move, zoom and rotate it.')}</p>
        {error && <p className="text-bad small" role="alert">{error}</p>}
      </div>
      {cropping && (
        <CropDialog
          src={cropping.src}
          onCancel={closeCrop}
          onDone={upload}
          onError={(message) => { closeCrop(); setError(message); }}
        />
      )}
    </div>
  );
}
