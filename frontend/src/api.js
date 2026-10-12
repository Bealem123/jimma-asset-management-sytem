import { t } from './i18n.jsx';

// Thin fetch wrapper. The token lives in sessionStorage (cleared when the browser closes);
// storage can be unavailable (private mode), so every access is guarded.
const KEY = 'jimma_ams_token';

export const tokenStore = {
  get() { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set(t) { try { sessionStorage.setItem(KEY, t); } catch { /* no storage: session lasts until reload */ } },
  clear() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(status, message, details, body) {
    super(message);
    this.status = status;
    this.details = details || {};
    this.body = body || {}; // the whole error response (e.g. the per-row problems of a failed import)
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body, { raw = false } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, t('Cannot reach the server. Check your connection and try again.'));
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const details = data.details ? Object.fromEntries(Object.entries(data.details).map(([k, v]) => [k, typeof v === 'string' ? t(v) : v])) : data.details;
    throw new ApiError(res.status, t(data.error || 'Something went wrong.'), details, data);
  }
  return localize(data);
}

// Display names that come from the master lists (sector, category, Kifle Ketema, Kebele ...) are shown in the
// user's language. This only changes what is displayed: ids are untouched, and screens that edit master data
// read the real names from the lists themselves.
const DISPLAY_NAME = /^(sector|category|asset_type|kifle_ketema|kebele|department|revenue_sector|expected_kifle|expected_kebele|found_kifle|found_kebele|from_kifle_ketema|from_kebele|to_kifle_ketema|to_kebele|from_department|to_department)_name$/;
function localize(value) {
  if (Array.isArray(value)) return value.map(localize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = typeof v === 'string' && DISPLAY_NAME.test(k) ? t(v) : localize(v);
    return out;
  }
  return value;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  send: (method, p, b) => request(method, p, b),
};

export const qs = (params) => {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) u.set(k, v); });
  const s = u.toString();
  return s ? `?${s}` : '';
};

/** Download an authenticated file (CSV/PDF export, document) through the browser's save flow. */
export async function download(path, fallbackName) {
  const res = await request('GET', path, undefined, { raw: true });
  const cd = res.headers.get('content-disposition') || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Fetch an authenticated image (QR code ...) as an object URL the <img> tag can use. */
export async function fetchObjectUrl(path) {
  const res = await request('GET', path, undefined, { raw: true });
  return URL.createObjectURL(await res.blob());
}
