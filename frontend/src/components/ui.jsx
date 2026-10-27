import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../api.js';
import { label, today, tone } from '../format.js';
import { t } from '../i18n.jsx';
import NavIcon from './NavIcon.jsx';
import {
  isValidCalendarDate, validateEmail, validateFile, validateLatitude, validateLongitude, validateNameText, validatePersonName, validatePhone,
} from '../validation.js';

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

export function Alert({ kind = 'error', className, children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}${className ? ` ${className}` : ''}`} role={kind === 'error' ? 'alert' : 'status'}>{typeof children === 'string' ? t(children) : children}</div>;
}

export const Loading = ({ text = 'Loading…' }) => <p className="muted" role="status">{t(text)}</p>;

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1>{t(title)}</h1>
        {subtitle && <p className="muted">{t(subtitle)}</p>}
      </div>
      <div className="actions">
        <div className="page-flags" data-page-flags />
        {children}
      </div>
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
        <button
          type="button"
          className="btn btn-icon-only"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('Previous')}
          title={t('Previous')}
        >
          <NavIcon name="chevronLeft" />
        </button>
        <span className="small">{t('Page {page} of {pages}', { page, pages })}</span>
        <button
          type="button"
          className="btn btn-icon-only"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={t('Next')}
          title={t('Next')}
        >
          <NavIcon name="chevronRight" />
        </button>
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
          <button type="button" className="btn btn-cancel" onClick={onClose}>{t('Cancel')}</button>
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

// The characters a field of each kind accepts while typing (the same as the server's rules): a person's name is
// letters of any script with spaces, hyphens, apostrophes and dots; the name of a person or an office may also have
// digits and & / , ( ); a phone number digits, + spaces and dashes.
const KEEP = {
  person: { drop: /[^\p{L}\p{M}\s.'’`-]/gu, hint: 'Only letters, spaces, hyphens and apostrophes: no numbers or symbols.' },
  name: { drop: /[^\p{L}\p{M}\p{N}\s&/.,'’`()-]/gu, hint: 'Only letters, numbers, spaces and - & / . , ( )' },
  tel: { drop: /[^\d+\s-]/g, hint: 'Only digits, + and spaces.', limit: (v) => limitPhone(v), full: 'The phone number is complete: 10 digits for 09…, 12 for +251 9….' },
};

/**
 * A phone number stops when it is complete (the same formats as validation.js): 09… or 07… has 10 digits,
 * +251… or 251… 12, a bare 9… or 7… 9, any other international number at most 15.
 */
function limitPhone(v) {
  const digits = v.replace(/\D/g, '');
  const max = digits.startsWith('0') ? 10 : digits.startsWith('251') ? 12 : /^[79]/.test(digits) && !v.trim().startsWith('+') ? 9 : 15;
  let seen = 0;
  let out = '';
  for (const ch of v) {
    if (/\d/.test(ch)) { if (seen === max) break; seen += 1; }
    else if (ch === '+' && out.trim()) continue; // a plus only at the start
    out += ch;
  }
  return out;
}

// The longest text a field takes unless its spec says otherwise (the server's usual limits).
const TEXT_MAX = { text: 200, textarea: 2000 };
export const maxLengthOf = (f) => f.maxLength ?? TEXT_MAX[f.type || 'text'];

/**
 * Validates a single field specification against its current value.
 * Beyond the type: `maxLength`, `kind` ('person' | 'name' | 'latitude' | 'longitude'), `integer`, `past` (a date
 * that has already come) and `after` (the name of the field this date or time cannot be before).
 */
export function validateFieldSpec(f, val, allValues = {}) {
  if (f.show && !f.show(allValues)) return null;
  const isBlank = val === '' || val == null || (Array.isArray(val) && !val.length);
  if (f.required && isBlank) {
    return t('{label} is required.', { label: t(f.label || 'This field') });
  }
  if (isBlank) return null;

  const max = maxLengthOf(f);
  if (max && typeof val === 'string' && val.trim().length > max) return t('Maximum {n} characters.', { n: max });
  const name = t(f.label || 'Name');
  const kindErr = f.kind === 'person' ? validatePersonName(val, { label: name, max: max || 160 })
    : f.kind === 'name' ? validateNameText(val, { label: name, max: max || 200 })
      : f.kind === 'latitude' ? validateLatitude(val, { label: name })
        : f.kind === 'longitude' ? validateLongitude(val, { label: name }) : null;
  if (kindErr) return t(kindErr);

  if (f.validate) {
    const customErr = f.validate(val, allValues);
    if (customErr) return typeof customErr === 'string' ? t(customErr) : customErr;
  }

  if ((f.type === 'date' || f.type === 'datetime-local') && f.past && String(val).slice(0, 10) > today()) {
    return t('This date cannot be in the future.');
  }
  if (f.after && allValues[f.after] && String(val) < String(allValues[f.after])) {
    return t('Cannot be before {min}.', { min: String(allValues[f.after]).replace('T', ' ') });
  }

  if (f.type === 'email') {
    const err = validateEmail(val, { label: t(f.label || 'Email') });
    if (err) return t(err);
  }

  if (f.type === 'tel') {
    const err = validatePhone(val, { label: t(f.label || 'Phone') });
    if (err) return t(err);
  }

  if (f.type === 'date') {
    if (!isValidCalendarDate(String(val))) return t('Enter a valid date.');
    if (f.min && val < f.min) return t('Cannot be before {min}.', { min: f.min });
    if (f.max && val > f.max) return t('Cannot be after {max}.', { max: f.max });
  }

  if (f.type === 'datetime-local' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(val))) return t('Enter a valid date and time.');

  if (f.type === 'number') {
    const num = Number(val);
    if (String(val).trim() === '' || Number.isNaN(num) || !Number.isFinite(num)) return t('Must be a valid number.');
    if (f.integer && !Number.isInteger(num)) return t('Enter a whole number.');
    // money (step 0.01) has at most two decimals: birr and cents
    if (String(f.step) === '0.01' && Math.abs(num * 100 - Math.round(num * 100)) > 1e-6) return t('At most two decimals.');
    if (f.min !== undefined && num < Number(f.min)) return t('Must be at least {min}.', { min: f.min });
    if (f.max !== undefined && num > Number(f.max)) return t('Cannot exceed {max}.', { max: f.max });
  }

  if (f.type === 'file' && val && typeof val === 'object' && 'size' in val) {
    const err = validateFile(val, { label: t(f.label || 'File'), allowedExts: f.allowedExts });
    if (err) return t(err);
  }

  return null;
}

/**
 * Form built from a list of field specs.
 * spec: { name, label, type, options (array or fn(values)), derive(value, values), required, help, placeholder, show(values), accept, rows, step, min, max, validate }
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
  const set = (name, value) => {
    setValues((v) => {
      let next = { ...v, [name]: value };
      const f = fields.find((x) => x.name === name);
      if (f?.derive) next = { ...next, ...f.derive(value, next) };
      return next;
    });
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };
  // What may be typed in a field of each kind: other keys are refused as they are pressed, with a word on why
  // (after `set`, which clears the field's old error).
  const change = (f, raw) => {
    const keep = KEEP[f.kind] || (f.type === 'tel' ? KEEP.tel : null);
    const allowed = keep && typeof raw === 'string' ? raw.replace(keep.drop, '') : raw;
    const clean = keep?.limit ? keep.limit(allowed) : allowed;
    set(f.name, clean);
    if (clean !== raw) setErrors((prev) => ({ ...prev, [f.name]: t(allowed !== raw ? keep.hint : keep.full) }));
  };

  const onBlurField = (f) => {
    const err = validateFieldSpec(f, values[f.name], values);
    if (err) {
      setErrors((prev) => ({ ...prev, [f.name]: err }));
    } else if (errors[f.name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[f.name];
        return next;
      });
    }
  };

  async function submit(e) {
    e.preventDefault();
    const visibleFields = fields.filter((f) => !f.show || f.show(values));
    const clientErrors = {};
    for (const f of visibleFields) {
      const err = validateFieldSpec(f, values[f.name], values);
      if (err) clientErrors[f.name] = err;
    }
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setGeneral(t('Please correct the highlighted fields.'));
      return;
    }
    setBusy(true);
    setErrors({});
    setGeneral('');
    try {
      const out = {};
      visibleFields.forEach((f) => { out[f.name] = values[f.name]; });
      await onSubmit(out);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.details || {});
        setGeneral(Object.keys(err.details || {}).length ? t('Please correct the highlighted fields.') : err.message);
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
            onBlur: () => onBlurField(f),
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
            control = <textarea {...common} rows={f.rows || 3} maxLength={maxLengthOf(f)} value={values[f.name]} onChange={(e) => change(f, e.target.value)} />;
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
                step={f.step ?? (f.integer ? 1 : undefined)} min={f.min}
                max={f.max ?? (f.past && f.type === 'date' ? today() : undefined)}
                maxLength={f.type === 'number' || f.type === 'date' || f.type === 'datetime-local' ? undefined : maxLengthOf(f)}
                inputMode={f.type === 'number' ? (f.integer ? 'numeric' : 'decimal') : f.type === 'tel' ? 'tel' : undefined}
                autoComplete={f.autoComplete || 'off'}
                onChange={(e) => change(f, e.target.value)}
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
        {onCancel && <button type="button" className="btn btn-cancel" onClick={onCancel} disabled={busy}>{t('Cancel')}</button>}
        {secondary}
        <button
          type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'} ${submitLabel === 'Next' ? 'btn-icon-only btn-step' : ''}`} disabled={busy}
          {...(submitLabel === 'Next' && { title: t('Next'), 'aria-label': t('Next') })}
        >
          {busy ? t('Saving…') : submitLabel === 'Next' ? <NavIcon name="chevronRight" /> : t(submitLabel)}
        </button>
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

// ---------------------------------------------------------------- list filters

/**
 * Filters kept in the address (so a filtered list can be shared, and survives a reload), as on the Assets page.
 * Returns [values, set(key, value), clear, any]. Other parameters of the page (a tab, say) are left alone.
 */
export function useFilters(keys) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) || '']));
  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const clear = () => {
    const next = new URLSearchParams(params);
    keys.forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };
  return [values, set, clear, keys.some((k) => values[k])];
}

/** The filter row: its fields, and a "Clear filters" button while any is set. */
export const FilterBar = ({ children, any, onClear, label: name = 'Filters' }) => (
  <form className="filters" role="search" aria-label={t(name)} onSubmit={(e) => e.preventDefault()}>
    {children}
    {any && <button type="button" className="btn" onClick={onClear}>{t('Clear filters')}</button>}
  </form>
);

export function FilterSelect({ id, text, value, onChange, options }) {
  return (
    <div className="field">
      <label htmlFor={id}>{t(text)}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
      </select>
    </div>
  );
}

export function FilterSearch({ id, text = 'Search', value, onChange, placeholder }) {
  return (
    <div className="field grow">
      <label htmlFor={id}>{t(text)}</label>
      <input id={id} type="search" placeholder={placeholder && t(placeholder)} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function FilterDate({ id, text, value, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{t(text)}</label>
      <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export const Empty = ({ children }) => <div className="empty">{typeof children === 'string' ? t(children) : children}</div>;

/**
 * A table with a header row and an empty-state message (pass `empty` text when there are no rows).
 * `num`: the column indexes holding figures, whose headers line up right like their `td.num` cells.
 */
export function Table({ head, children, empty, num = [] }) {
  return (
    <div className="table-wrap">
      <table><thead><tr>{head.map((h, i) => <th key={`${h}-${i}`} className={num.includes(i) ? 'num' : undefined}>{t(h)}</th>)}</tr></thead><tbody>{children}</tbody></table>
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
      {tabs.map(([key, text, badge]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} data-text={t(text)} onClick={() => onChange(key)}>
          {t(text)}
          {badge != null && <span className="tab-badge" style={{ marginLeft: 6, fontSize: '0.85em', opacity: 0.85 }}>({badge})</span>}
        </button>
      ))}
    </div>
  );
}
