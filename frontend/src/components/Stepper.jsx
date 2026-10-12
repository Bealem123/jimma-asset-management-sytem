import NavIcon from './NavIcon.jsx';
import { t } from '../i18n.jsx';

/**
 * The steps of a multi-step form: a numbered circle per step on one line, its title and where it stands
 * (Completed / In progress / Pending). A step that has been reached can be opened again by clicking it.
 * steps: [{ title (already translated), icon (a NavIcon name) }]; `reached(i)` says whether step i may be opened.
 */
export default function Stepper({ steps, current, done, reached, onGo }) {
  return (
    <ol className="stepper" style={{ '--steps': steps.length }} aria-label={t('Steps')}>
      {steps.map((s, i) => {
        const state = i === current ? 'current' : done.has(i) ? 'done' : 'pending';
        const chip = { current: 'In progress', done: 'Completed', pending: 'Pending' }[state];
        return (
          <li key={s.title} className={`stepper-step is-${state}${done.has(i) ? ' is-done' : ''}`}>
            <button type="button" onClick={() => onGo(i)} disabled={i === current || !reached(i)} aria-current={i === current ? 'step' : undefined}>
              <span className="stepper-dot" aria-hidden="true"><NavIcon name={state === 'done' ? 'check' : s.icon} /></span>
              <span className="stepper-n">{t('Step {n}', { n: i + 1 })}</span>
              <span className="stepper-title">{s.title}</span>
              <span className={`stepper-chip chip-${state}`}>{t(chip)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
