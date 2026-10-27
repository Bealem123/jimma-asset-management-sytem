import { useEffect, useRef, useState } from 'react';
import { api, fetchObjectUrl } from '../api.js';
import { t } from '../i18n.jsx';
import NavIcon from './NavIcon.jsx';
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

const MAX_STAGE_W = 340;
const MAX_STAGE_H = 320;
const SIDE = 480;

/**
 * Choose the part of a picture to keep: drag any edge or corner of the rectangular box to resize,
 * drag the center cross to move, and rotate as needed.
 * `src` is an object URL; `onDone` gets a JPEG blob.
 */
function CropDialog({ src, onCancel, onDone, onError }) {
  const [img, setImg] = useState(null);
  const [rot, setRot] = useState(0); // 0, 90, 180, 270
  const [crop, setCrop] = useState(null); // { x, y, w, h }
  const [saving, setSaving] = useState(false);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => onError(t('This file is not a picture. Use a JPG, PNG or WebP picture.'));
    i.src = src;
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const isTurned = rot % 180 !== 0;
  const naturalW = img ? (isTurned ? img.naturalHeight : img.naturalWidth) : 1;
  const naturalH = img ? (isTurned ? img.naturalWidth : img.naturalHeight) : 1;
  const scale = Math.min(MAX_STAGE_W / naturalW, MAX_STAGE_H / naturalH, 1);
  const dispW = Math.max(120, Math.round(naturalW * scale));
  const dispH = Math.max(120, Math.round(naturalH * scale));

  // Initialize or adjust crop box when image loads or rotates
  useEffect(() => {
    if (!img) return;
    const initialSize = Math.round(Math.min(dispW, dispH) * 0.82);
    setCrop({
      x: Math.round((dispW - initialSize) / 2),
      y: Math.round((dispH - initialSize) / 2),
      w: initialSize,
      h: initialSize,
    });
  }, [img, rot, dispW, dispH]);

  // Draw rendered image to stage canvas
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = dispW;
    canvas.height = dispH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.save();
    ctx.translate(dispW / 2, dispH / 2);
    ctx.rotate((rot * Math.PI) / 180);
    const drawW = isTurned ? dispH : dispW;
    const drawH = isTurned ? dispW : dispH;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }, [img, rot, dispW, dispH, isTurned]);

  const startDrag = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startCrop = { ...crop };
    const minSize = 28;

    const onPointerMove = (ev) => {
      ev.preventDefault();
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let newX = startCrop.x;
      let newY = startCrop.y;
      let newW = startCrop.w;
      let newH = startCrop.h;

      if (handle === 'move') {
        newX = Math.max(0, Math.min(dispW - startCrop.w, startCrop.x + dx));
        newY = Math.max(0, Math.min(dispH - startCrop.h, startCrop.y + dy));
      } else {
        // Horizontal resize (holding east or west edge/corner)
        if (handle.includes('e')) {
          const maxW = dispW - startCrop.x;
          newW = Math.max(minSize, Math.min(maxW, startCrop.w + dx));
        } else if (handle.includes('w')) {
          const right = startCrop.x + startCrop.w;
          const maxX = right - minSize;
          newX = Math.max(0, Math.min(maxX, startCrop.x + dx));
          newW = right - newX;
        }

        // Vertical resize (holding north or south edge/corner)
        if (handle.includes('s')) {
          const maxH = dispH - startCrop.y;
          newH = Math.max(minSize, Math.min(maxH, startCrop.h + dy));
        } else if (handle.includes('n')) {
          const bottom = startCrop.y + startCrop.h;
          const maxY = bottom - minSize;
          newY = Math.max(0, Math.min(maxY, startCrop.y + dy));
          newH = bottom - newY;
        }
      }

      setCrop({
        x: Math.round(newX),
        y: Math.round(newY),
        w: Math.round(newW),
        h: Math.round(newH),
      });
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const rotate = () => {
    setRot((r) => (r + 90) % 360);
  };

  const setSquare = () => {
    if (!crop) return;
    const s = Math.round(Math.min(crop.w, crop.h, dispW, dispH));
    setCrop((c) => ({
      x: Math.max(0, Math.min(dispW - s, c.x)),
      y: Math.max(0, Math.min(dispH - s, c.y)),
      w: s,
      h: s,
    }));
  };

  const setFitAll = () => {
    setCrop({ x: 0, y: 0, w: dispW, h: dispH });
  };

  async function save() {
    if (!img || !canvasRef.current || !crop) return;
    setSaving(true);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = SIDE;
    outCanvas.height = SIDE;
    const ctx = outCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIDE, SIDE);
    ctx.imageSmoothingQuality = 'high';

    // Preserve crop aspect ratio inside square avatar canvas without stretching
    const aspect = crop.w / crop.h;
    let dw = SIDE;
    let dh = SIDE;
    let dx = 0;
    let dy = 0;
    if (aspect > 1) {
      dh = Math.round(SIDE / aspect);
      dy = Math.round((SIDE - dh) / 2);
    } else if (aspect < 1) {
      dw = Math.round(SIDE * aspect);
      dx = Math.round((SIDE - dw) / 2);
    }

    ctx.drawImage(
      canvasRef.current,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      dx,
      dy,
      dw,
      dh
    );

    const blob = await new Promise((resolve) => outCanvas.toBlob(resolve, 'image/jpeg', 0.92));
    onDone(blob);
  }

  return (
    <Modal title={t('Crop the picture')} onClose={onCancel}>
      <div className="crop">
        <div
          ref={stageRef}
          className="crop-stage"
          style={{ width: dispW, height: dispH }}
        >
          <canvas ref={canvasRef} />

          {crop && (
            <div
              className="crop-box"
              style={{
                left: crop.x,
                top: crop.y,
                width: crop.w,
                height: crop.h,
              }}
            >
              {/* Inside area: drag inside to reposition the crop box */}
              <div
                className="crop-inside"
                onPointerDown={(e) => startDrag(e, 'move')}
                title={t('Drag inside to move')}
              >
                <div className="crop-grid" />
              </div>

              {/* 4 Draggable Edges: hold and drag edge to crop */}
              <div
                className="crop-edge crop-edge-n"
                onPointerDown={(e) => startDrag(e, 'n')}
                title={t('Drag top edge to crop')}
              >
                <span className="crop-grip crop-grip-n" />
              </div>
              <div
                className="crop-edge crop-edge-s"
                onPointerDown={(e) => startDrag(e, 's')}
                title={t('Drag bottom edge to crop')}
              >
                <span className="crop-grip crop-grip-s" />
              </div>
              <div
                className="crop-edge crop-edge-w"
                onPointerDown={(e) => startDrag(e, 'w')}
                title={t('Drag left edge to crop')}
              >
                <span className="crop-grip crop-grip-w" />
              </div>
              <div
                className="crop-edge crop-edge-e"
                onPointerDown={(e) => startDrag(e, 'e')}
                title={t('Drag right edge to crop')}
              >
                <span className="crop-grip crop-grip-e" />
              </div>

              {/* 4 Draggable Corner Handles: drag corner to crop both edges */}
              <div
                className="crop-handle crop-handle-nw"
                onPointerDown={(e) => startDrag(e, 'nw')}
                title={t('Drag corner to crop')}
              >
                <span className="crop-corner-box" />
              </div>
              <div
                className="crop-handle crop-handle-ne"
                onPointerDown={(e) => startDrag(e, 'ne')}
                title={t('Drag corner to crop')}
              >
                <span className="crop-corner-box" />
              </div>
              <div
                className="crop-handle crop-handle-sw"
                onPointerDown={(e) => startDrag(e, 'sw')}
                title={t('Drag corner to crop')}
              >
                <span className="crop-corner-box" />
              </div>
              <div
                className="crop-handle crop-handle-se"
                onPointerDown={(e) => startDrag(e, 'se')}
                title={t('Drag corner to crop')}
              >
                <span className="crop-corner-box" />
              </div>
            </div>
          )}
        </div>

        <p className="muted small">
          {t('Drag any edge or corner of the rectangular box to crop. Drag inside the box to move it.')}
        </p>

        <div className="crop-tools">
          <button type="button" className="btn btn-small" onClick={setSquare} disabled={!img}>
            {t('Square')}
          </button>
          <button type="button" className="btn btn-small" onClick={setFitAll} disabled={!img}>
            {t('Fit photo')}
          </button>
          <button type="button" className="btn btn-small btn-icon-nav" onClick={rotate} disabled={!img}>
            ↻ {t('Rotate')}
          </button>
        </div>

        <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-cancel" onClick={onCancel}>{t('Cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!img || saving}>
            {saving ? t('Saving…') : t('Use this picture')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
/**
 * Profile section component displaying the circular avatar with coral camera icon,
 * cyan plus badge, user name with chevron, and Edit pill button.
 * Matches user's exact design mockup across all accounts.
 */
export function PhotoPicker({ user, path, onChanged, size = 104, onEdit, showMeta = true }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropping, setCropping] = useState(null); // { src, own }
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef(null);

  const key = user?.photo ? `${user.id}:${user.photo}` : null;
  const [src, setSrc] = useState(() => (key ? ready.get(key) ?? null : null));

  useEffect(() => {
    if (!key) { setSrc(null); return undefined; }
    let live = true;
    setSrc(ready.get(key) ?? null);
    load(key, user).then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [key]);

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
    e.target.value = '';
    if (!file) return;
    setError('');
    setMenuOpen(false);
    setCropping({ src: URL.createObjectURL(file), own: true });
  }

  async function recrop() {
    setMenuOpen(false);
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

  function remove() {
    setMenuOpen(false);
    run(async () => {
      await api.del(path);
      return null;
    });
  }

  const displayName = user?.full_name || user?.username || 'User';

  return (
    <div className="profile-section-card">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={pick}
        disabled={busy}
      />

      {/* Circular Profile Avatar (centered) */}
      <div className="profile-avatar-wrapper" style={{ width: size, height: size }}>
        <button
          type="button"
          className={`profile-avatar-circle${busy ? ' is-busy' : ''}`}
          style={{ width: size, height: size }}
          onClick={() => (user?.photo ? setMenuOpen((o) => !o) : fileInputRef.current?.click())}
          title={t(user?.photo ? 'Manage profile picture' : 'Upload profile picture')}
          aria-label={t(user?.photo ? 'Manage profile picture' : 'Upload profile picture')}
          disabled={busy}
        >
          {src ? (
            <img src={src} alt={displayName} className="profile-avatar-img" />
          ) : (
            <div className="profile-camera-icon">
              <svg viewBox="0 0 48 48" fill="none" width="46" height="46">
                <path
                  d="M16 11.5l2.2-3.4A3 3 0 0 1 20.7 6.8h6.6a3 3 0 0 1 2.5 1.3l2.2 3.4h7a5 5 0 0 1 5 5v21a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-21a5 5 0 0 1 5-5h7z"
                  fill="#ff3b5c"
                />
                <circle cx="24" cy="27.5" r="7.5" fill="#ffffff" />
              </svg>
            </div>
          )}
        </button>

        {/* Cyan Plus Badge at bottom-right of circle */}
        <button
          type="button"
          className="profile-plus-badge"
          onClick={() => fileInputRef.current?.click()}
          title={t('Add or change picture')}
          aria-label={t('Add or change picture')}
          disabled={busy}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round">
            <line x1="10" y1="4" x2="10" y2="16" />
            <line x1="4" y1="10" x2="16" y2="10" />
          </svg>
        </button>
      </div>

      {/* Name, Chevron & Edit Pill */}
      {showMeta && (
        <div className="profile-header-meta">
          <button
            type="button"
            className="profile-name-toggle"
            onClick={() => setMenuOpen((o) => !o)}
            title={t('Toggle profile options')}
          >
            <span className="profile-display-name">{displayName}</span>
            <svg
              className={`profile-chevron${menuOpen ? ' open' : ''}`}
              viewBox="0 0 16 16"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3.5,6 8,10.5 12.5,6" />
            </svg>
          </button>

          <button
            type="button"
            className="btn-profile-edit"
            onClick={() => {
              if (onEdit) onEdit();
              else setMenuOpen((o) => !o);
            }}
            title={t('Edit profile')}
          >
            {t('Edit')}
          </button>
        </div>
      )}

      {/* Action Tray / Menu */}
      {menuOpen && (
        <div className="profile-action-menu">
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <NavIcon name="camera" />
            <span>{t(user?.photo ? 'Change picture' : 'Upload picture')}</span>
          </button>

          {user?.photo && (
            <button
              type="button"
              className="profile-menu-item"
              onClick={recrop}
              disabled={busy}
            >
              <NavIcon name="crop" />
              <span>{t('Crop picture')}</span>
            </button>
          )}

          {user?.photo && (
            <button
              type="button"
              className="profile-menu-item item-danger"
              onClick={remove}
              disabled={busy}
            >
              <NavIcon name="trash" />
              <span>{t('Remove picture')}</span>
            </button>
          )}
        </div>
      )}

      {busy && <p className="muted small" style={{ marginTop: 8 }}>{t('Saving…')}</p>}
      {error && <p className="text-bad small" role="alert" style={{ marginTop: 8 }}>{error}</p>}

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
