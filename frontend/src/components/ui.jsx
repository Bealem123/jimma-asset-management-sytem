import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../api.js';
import { label, tone } from '../format.js';
import { t } from '../i18n.jsx';

/** Run an async loader and track loading/error. `reload()` re-runs it. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const run = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    fn().then(
      (data) => { if (!cancelled) setState({ data, error: '', loading: false }); },
      (e) => { if (!cancelled) setState({ data: null, error: e.message, loading: false }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => run(), [run]);
  return { ...state, reload: run };
}

export const Badge = ({ value, text }) => <span className={`badge badge-${tone(value)}`}>{text != null ? t(text) : label(value)}</span>;

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{typeof children === 'string' ? t(children) : children}</div>;
}

export const Loading = ({ text = 'Loading…' }) => <p className="muted" role="status">{t(text)}</p>;

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1>{t(title)}</h1>
        {subtitle && <p className="muted">{t(subtitle)}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const downOnBackdrop = useRef(false); // close on a click on the backdrop only, not at the end of a drag that left the window
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''}`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onPointerDown={(e) => { downOnBackdrop.current = e.target === ref.current; }}
      onClick={(e) => { if (e.target === ref.current && downOnBackdrop.current) onClose(); }}
    >
      <div className="modal-head">
        <h2>{t(title)}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label={t('Close')}>✕</button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="muted small">{total} {total === 1 ? t('record') : t('records')}</p>;
  return (
    <nav className="pagination" aria-label={t('Pagination')}>
      <span className="muted small">{t('{from}–{to} of {total}', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}</span>
      <div className="actions">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('Previous')}</button>
        <span className="small">{t('Page {page} of {pages}', { page, pages })}</span>
        <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('Next')}</button>
      </div>
    </nav>
  );
}

/** Label + control + error, correctly wired for screen readers. */
/**
 * A themed confirmation window, used instead of the browser's own confirm box. `onConfirm(reason)` may be async;
 * an error it throws is shown inside the window. With `reasonLabel` it also asks why (and `suggestions` offers
 * common answers to pick from).
 */
export function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', danger, reasonLabel, reasonRequired, reasonHelp, suggestions = [], onConfirm, onClose,
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const missing = reasonRequired && !reason.trim();
  async function submit(e) {
    e.preventDefault();
    if (missing) { setError('Please give a reason.'); return; }
    setBusy(true); setError('');
    try { await onConfirm(reason.trim()); } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="confirm">
        <p className="confirm-message">{message}</p>
        {reasonLabel && (
          <Field label={reasonLabel} required={reasonRequired} id={id} help={reasonHelp} error={error && missing ? error : undefined}>
            <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus autoComplete="off" />
            {suggestions.length > 0 && (
              <div className="chips" role="group" aria-label={t('Common reasons')}>
                {suggestions.map((s) => (
                  <button key={s} type="button" className={`chip${reason === t(s) ? ' on' : ''}`} onClick={() => setReason(t(s))}>{t(s)}</button>
                ))}
              </div>
            )}
          </Field>
        )}
        {error && !missing && <Alert>{error}</Alert>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>{t(confirmLabel)}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Field({ label: text, error, help, required, children, id }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{t(text)}{required && <span aria-hidden="true" className="req"> *</span>}</label>
      {children}
      {help && !error && <p className="help" id={`${id}-help`}>{t(help)}</p>}
      {error && <p className="error-text" id={`${id}-err`}>{t(error)}</p>}
    </div>
  );
}

/**
 * Form built from a list of field specs.
 * spec: { name, label, type, options (array or fn(values)), derive(value, values), required, help, placeholder, show(values), accept, rows, step, min }
 * Also: `onValues(values)` hears every change (a multi-step form keeps them between steps), `initialErrors` shows
 * errors found elsewhere (e.g. by the server when the last step is saved), `secondary` adds a button such as Back.
 */
export function SpecForm({ fields, initial = {}, onSubmit, submitLabel = 'Save', onCancel, danger, onValues, initialErrors, secondary }) {
  const uid = useId();
  const [values, setValues] = useState(() => {
    const v = {};
    fields.forEach((f) => { v[f.name] = initial[f.name] ?? (f.type === 'checkbox' ? false : ''); });
    return v;
  });
  const [errors, setErrors] = useState(initialErrors || {});
  const [general, setGeneral] = useState(initialErrors && Object.keys(initialErrors).length ? t('Please correct the highlighted fields.') : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { onValues?.(values); }, [values]); // eslint-disable-line react-hooks/exhaustive-deps

  // `derive(value, next)` (optional, pure) returns extra field values to set, e.g. clearing a dependent select.
  const set = (name, value) => setValues((v) => {
    let next = { ...v, [name]: value };
    const f = fields.find((x) => x.name === name);
    if (f?.derive) next = { ...next, ...f.derive(value, next) };
    return next;
  });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setGeneral('');
    try {
      const out = {};
      fields.forEach((f) => { if (!f.show || f.show(values)) out[f.name] = values[f.name]; });
      await onSubmit(out);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.details);
        setGeneral(Object.keys(err.details).length ? t('Please correct the highlighted fields.') : err.message);
      } else {
        setGeneral(t('Unexpected error. Please try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Alert>{general}</Alert>
      <div className="form-grid">
        {fields.filter((f) => !f.show || f.show(values)).map((f) => {
          const id = `${uid}-${f.name}`;
          const options = typeof f.options === 'function' ? f.options(values) : f.options || [];
          const common = {
            id, name: f.name, 'aria-invalid': errors[f.name] ? 'true' : undefined,
            'aria-describedby': errors[f.name] ? `${id}-err` : f.help ? `${id}-help` : undefined,
          };
          let control;
          // `fixedWhenSingle`: a select whose only real choice is already chosen is shown as fixed text, not a dropdown
          const real = options.filter((o) => o.value !== '');
          if (f.type === 'select' && f.fixedWhenSingle && real.length === 1 && String(values[f.name]) === String(real[0].value)) {
            control = <output {...common} className="fixed-value">{t(real[0].label)}</output>;
          } else if (f.type === 'select') {
            control = (
              <select {...common} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                {options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </select>
            );
          } else if (f.type === 'textarea') {
            control = <textarea {...common} rows={f.rows || 3} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />;
          } else if (f.type === 'checkbox') {
            control = (
              <label className="check">
                <input {...common} type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
                <span>{t(f.checkLabel || f.label)}</span>
              </label>
            );
          } else if (f.type === 'multiselect') {
            control = (
              <select {...common} multiple size={Math.min(6, options.length || 3)} value={values[f.name] || []}
                onChange={(e) => set(f.name, [...e.target.selectedOptions].map((o) => o.value))}>
                {options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </select>
            );
          } else if (f.type === 'file') {
            control = (
              <input
                {...common} type="file" accept={f.accept} capture={f.capture}
                onChange={(e) => set(f.name, e.target.files[0] || '')}
              />
            );
          } else if (f.type === 'custom') {
            // escape hatch for one-off controls: render({ values, set, id }) returns the element
            control = f.render({ values, set, id });
          } else {
            control = (
              <input
                {...common} type={f.type || 'text'} value={values[f.name]} placeholder={t(f.placeholder)}
                step={f.step} min={f.min} autoComplete={f.autoComplete || 'off'}
                onChange={(e) => set(f.name, e.target.value)}
              />
            );
          }
          return (
            <div key={f.name} className={f.wide ? 'span-2' : undefined}>
              {f.type === 'checkbox'
                ? <Field id={id} error={errors[f.name]} help={f.help}>{control}</Field>
                : <Field id={id} label={f.label} required={f.required} error={errors[f.name]} help={f.help}>{control}</Field>}
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>{t('Cancel')}</button>}
        {secondary}
        <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>{busy ? t('Saving…') : t(submitLabel)}</button>
      </div>
    </form>
  );
}

export const opt = (rows, text = (r) => r.name, { blank } = {}) => [
  ...(blank ? [{ value: '', label: t(blank) }] : []),
  ...rows.map((r) => ({ value: String(r.id), label: t(text(r)) })),
];
export const enumOpt = (values, { blank } = {}) => [
  ...(blank ? [{ value: '', label: blank }] : []),
  ...values.map((v) => ({ value: v, label: label(v) })),
];

export const Empty = ({ children }) => <div className="empty">{typeof children === 'string' ? t(children) : children}</div>;

/** A table with a header row and an empty-state message (pass `empty` text when there are no rows). */
export function Table({ head, children, empty }) {
  return (
    <div className="table-wrap">
      <table><thead><tr>{head.map((h, i) => <th key={`${h}-${i}`}>{t(h)}</th>)}</tr></thead><tbody>{children}</tbody></table>
      {empty && <Empty>{empty}</Empty>}
    </div>
  );
}

/** One term/definition pair; renders nothing when there is no value. */
export const Row = ({ term, children }) => (children === null || children === undefined || children === '' ? null : <><dt>{t(term)}</dt><dd>{children}</dd></>);

/** A row of tabs. The teal highlight slides from the old tab to the new one (instantly when reduced motion is asked for). */
export function Tabs({ tabs, value, onChange, label: aria = 'Sections' }) {
  const ref = useRef(null);
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const measure = () => {
      const el = box.querySelector('[aria-selected="true"]');
      setPill(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
    };
    measure();
    // widths change when fonts finish loading or the window is resized
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(box);
    box.querySelectorAll('button').forEach((b) => ro?.observe(b));
    return () => ro?.disconnect();
  }, [value, tabs.length]);
  return (
    <div className={`tabs${pill ? ' has-pill' : ''}`} role="tablist" aria-label={t(aria)} ref={ref}>
      {pill && <span className="tabs-pill" aria-hidden="true" style={{ width: pill.w, height: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }} />}
      {tabs.map(([key, text]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} data-text={t(text)} onClick={() => onChange(key)}>{t(text)}</button>
      ))}
    </div>
  );
}
