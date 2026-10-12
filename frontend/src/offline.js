// Offline data collection for field work (inspections, physical verification).
// When the network is down, a result is saved on this device and sent automatically when the
// connection returns. Nothing is lost if the browser is closed in between (localStorage).
import { useEffect, useState } from 'react';
import { ApiError, api } from './api.js';

const OUTBOX = 'jimma_ams_outbox';
const FAILED = 'jimma_ams_outbox_failed';
const EVENT = 'jimma-outbox-change';

const read = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
const write = (key, list) => {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  window.dispatchEvent(new Event(EVENT));
};

export const pending = () => read(OUTBOX);
export const failed = () => read(FAILED);
export const clearFailed = () => write(FAILED, []);

/**
 * Send a JSON request now, or keep it for later if the server cannot be reached.
 * Returns { queued: true } when saved on the device, otherwise the server's answer.
 */
export async function sendOrQueue(method, path, body, description) {
  const save = () => {
    write(OUTBOX, [...read(OUTBOX), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, path, body, description, at: new Date().toISOString() }]);
    return { queued: true };
  };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return save();
  try {
    return await api.send(method, path, body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) return save();
    throw e;
  }
}

let syncing = false;
/** Try to send everything saved on this device. Stops at the first "cannot reach the server". */
export async function syncOutbox() {
  if (syncing) return { sent: 0, rejected: 0 };
  syncing = true;
  let sent = 0;
  let rejected = 0;
  try {
    for (const item of read(OUTBOX)) {
      try {
        await api.send(item.method, item.path, item.body);
        sent += 1;
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // still offline: keep the rest
        if (e instanceof ApiError && e.status === 401) break; // signed out: keep them for after sign-in
        rejected += 1; // the server refused it (e.g. campaign closed): keep it visible for the user
        write(FAILED, [...read(FAILED), { ...item, error: e.message }]);
      }
      write(OUTBOX, read(OUTBOX).filter((x) => x.id !== item.id));
    }
  } finally {
    syncing = false;
  }
  return { sent, rejected };
}

/** Live view of what is waiting on this device; also retries whenever the browser comes back online. */
export function useOutbox() {
  const [state, setState] = useState({ pending: pending(), failed: failed(), online: typeof navigator === 'undefined' ? true : navigator.onLine });
  useEffect(() => {
    const refresh = () => setState({ pending: pending(), failed: failed(), online: navigator.onLine });
    const goOnline = () => { refresh(); syncOutbox().then(refresh); };
    window.addEventListener(EVENT, refresh);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', refresh);
    if (navigator.onLine && pending().length) syncOutbox().then(refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', refresh);
    };
  }, []);
  return state;
}
