import { Fragment, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { label } from '../format.js';
import { Alert, Loading, PageHeader, SpecForm, opt, useAsync } from '../components/ui.jsx';
import { t } from '../i18n.jsx';
import NavIcon from '../components/NavIcon.jsx';
import Stepper from '../components/Stepper.jsx';
import { ROLE_HELP, nameFields, usernameFor } from './Users.jsx';
import { validateEmail, validatePassword, validatePhone } from '../validation.js';

// Creating an account, in steps like registering an asset: who the person is, the area they work in, how they sign in,
// how to reach them, then a review. The same flow for every level: the Super Administrator (Kifle Ketema Administrators,
// the Mayor and the specialists), a Kifle Ketema Administrator (its Kebele Administrators) and a Kebele Administrator
// (its Sector Administrators). The server checks everything again.

const STEP_ICONS = ['account', 'map', 'verification', 'notifications', 'approvals'];
const REVIEW = 4;
const CITYWIDE = ['EXECUTIVE', 'AUDITOR']; // see the whole City by role: no area to assign
const ONE_PER_KIFLE_KETEMA = ['KIFLE_ADMIN', 'FINANCIAL_OFFICER', 'INSPECTOR']; // exactly one Kifle Ketema, and one each per Kifle Ketema
const ONE_PER_AREA = ['KIFLE_ADMIN', 'KEBELE_ADMIN', 'SECTOR_ADMIN']; // each area has exactly one active administrator

const isEmpty = (v) => v === '' || v == null || (Array.isArray(v) && !v.length);

export default function UserNew() {
  const lk = useLookups();
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roles = can.managedAccountRoles(me);
  const { data: accounts, error: loadError } = useAsync(() => api.get('/users'), []);

  // what the button that opened this page already chose: a role, and for a Kifle Ketema Administrator its Kifle Ketema
  const presetRole = roles.includes(params.get('role')) ? params.get('role') : can.managedAccountRole(me);
  const myKebeles = me.role === 'KIFLE_ADMIN' ? lk.kebeles.filter((k) => me.scope.kifle.includes(k.kifle_ketema_id))
    : me.role === 'KEBELE_ADMIN' ? lk.kebeles.filter((k) => me.scope.kebeles.includes(k.id)) : lk.kebeles;
  const [values, setValues] = useState(() => ({
    role: presetRole || '', first_name: '', father_name: '', grandfather_name: '',
    kifle_ketema_id: params.get('kifle') || '',
    kebele_id: myKebeles.length === 1 ? String(myKebeles[0].id) : '', sector_id: '',
    password: '', password_again: '', is_active: true, email: '', phone: '',
  }));
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(() => new Set());
  const [errors, setErrors] = useState({}); // by step: what the server found when the account was created
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!accounts) return <Loading />;

  // Areas that already have their one active administrator are not offered (the server would refuse a second one).
  const taken = (role, pick) => new Set(accounts.filter((u) => u.role === role && u.is_active).flatMap(pick));
  const takenKifle = taken(values.role, (u) => u.kifle_ketema_ids.map(String)); // by the role being created
  const takenKebele = taken('KEBELE_ADMIN', (u) => u.kebele_ids.map(String));
  const takenSector = taken('SECTOR_ADMIN', (u) => u.kebele_ids.flatMap((k) => u.sector_ids.map((s) => `${k}:${s}`)));
  const kebeleText = (k) => `${t(k.name)}${k.kifle_ketema_name ? ` (${t(k.kifle_ketema_name)})` : ` (${t('Kifle Ketema not set')})`}`;
  const roleHelp = Object.fromEntries(ROLE_HELP);
  // a step's form holds only its own fields: the later steps read the role chosen in step 1 from here
  const { role } = values;

  const fields = [
    // 1. the account
    {
      page: 0, name: 'role', label: 'Role', type: 'select', required: true, fixedWhenSingle: true, wide: true,
      options: [{ value: '', label: 'Choose…' }, ...roles.map((r) => ({ value: r, label: label(r) }))],
      // another role works in another kind of area
      derive: () => ({ kifle_ketema_id: '', kebele_id: myKebeles.length === 1 ? String(myKebeles[0].id) : '', sector_id: '' }),
    },
    {
      page: 0, name: '_role_help', type: 'custom', wide: true, show: (v) => Boolean(roleHelp[v.role]),
      render: ({ values: v }) => <p className="muted small" style={{ margin: 0 }}>{t(roleHelp[v.role])}</p>,
    },
    ...nameFields(0),
    {
      page: 0, name: '_username', type: 'custom', wide: true, show: (v) => Boolean(usernameFor(v.first_name)),
      render: ({ values: v }) => (
        <p className="muted small" style={{ margin: 0 }}>
          {t('Username for signing in: {username}. If someone already has it, the father’s name is added, e.g. {both}.', {
            username: usernameFor(v.first_name), both: `${usernameFor(v.first_name)}.${usernameFor(v.father_name) || '…'}`,
          })}
        </p>
      ),
    },
    // 2. the area the person works in
    {
      page: 1, name: 'kifle_ketema_id', label: 'Kifle Ketema', type: 'select', required: true, wide: true,
      show: () => ONE_PER_KIFLE_KETEMA.includes(role), help: 'One for each Kifle Ketema, covering every Kebele in it. Those that already have one are not listed.',
      options: () => opt(lk.kifle.filter((k) => !takenKifle.has(String(k.id)) || String(k.id) === values.kifle_ketema_id), undefined, { blank: 'Choose…' }),
    },
    {
      page: 1, name: 'kebele_id', label: 'Kebele', type: 'select', required: true, fixedWhenSingle: true, wide: true,
      show: () => role === 'KEBELE_ADMIN' || role === 'SECTOR_ADMIN',
      help: 'A Kebele Administrator and a Sector Administrator each work in exactly one Kebele.',
      options: (v) => opt(myKebeles.filter((k) => role !== 'KEBELE_ADMIN' || !takenKebele.has(String(k.id)) || String(k.id) === v.kebele_id), kebeleText, { blank: 'Choose…' }),
      derive: () => ({ sector_id: '' }),
    },
    {
      page: 1, name: 'sector_id', label: 'Sector', type: 'select', required: true, wide: true,
      show: () => role === 'SECTOR_ADMIN',
      help: 'One of the 13 sectors. Sectors of this Kebele that already have an administrator are not listed.',
      options: (v) => opt(lk.sectors.filter((s) => !v.kebele_id || !takenSector.has(`${v.kebele_id}:${s.id}`)), (s) => t(s.name), { blank: v.kebele_id ? 'Choose…' : 'Choose a Kebele first' }),
    },
    // 3. signing in
    { page: 2, name: 'password', label: 'Temporary password', type: 'password', required: true, autoComplete: 'new-password', help: 'At least 8 characters, with upper- and lower-case letters, a number and a symbol. The person must choose their own password at first sign-in.', validate: (v) => validatePassword(v, { required: true, min: 8, label: 'Temporary password' }) },
    { page: 2, name: 'password_again', label: 'Type the password again', type: 'password', required: true, autoComplete: 'new-password' },
    { page: 2, name: 'is_active', type: 'checkbox', label: 'Active', checkLabel: 'Account is active (can sign in)', wide: true },
    // 4. how to reach the person
    { page: 3, name: 'email', label: 'E-mail', type: 'email', help: 'For e-mail notifications.', validate: (v) => validateEmail(v, { required: false, label: 'E-mail' }) },
    { page: 3, name: 'phone', label: 'Phone', type: 'tel', help: 'For SMS notifications, e.g. +2519…', validate: (v) => validatePhone(v, { required: false, label: 'Phone' }) },
  ];
  const shown = (f, v = values) => !f.show || f.show(v);
  // nothing left to choose: every area this person could be given already has its one active administrator
  const noneFree = (ONE_PER_KIFLE_KETEMA.includes(role) && lk.kifle.every((k) => takenKifle.has(String(k.id))))
    || (role === 'KEBELE_ADMIN' && myKebeles.every((k) => takenKebele.has(String(k.id))))
    || (role === 'SECTOR_ADMIN' && values.kebele_id && lk.sectors.every((x) => takenSector.has(`${values.kebele_id}:${x.id}`)));

  const steps = [t('Account'), t('Assigned area'), t('Sign-in'), t('Contact'), t('Review')]
    .map((title, i) => ({ title, icon: STEP_ICONS[i] }));
  const go = (i) => { setStep(i); setFormKey((k) => k + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const reached = (i) => i === 0 || done.has(i) || done.has(i - 1);
  const keepValues = (v) => setValues((prev) => ({ ...prev, ...v }));

  // Next: what this step needs must be filled in before moving on
  async function next(v) {
    const all = { ...values, ...v };
    const problems = Object.fromEntries(fields
      .filter((f) => f.page === step && f.required && shown(f, all) && isEmpty(all[f.name]))
      .map((f) => [f.name, t('{label} is required.', { label: t(f.label || 'This') })]));

    for (const f of fields.filter((f) => f.page === step && shown(f, all))) {
      if (f.validate && !problems[f.name]) {
        const err = f.validate(all[f.name], all);
        if (err) problems[f.name] = t(err);
      }
    }

    if (step === 2 && !problems.password_again && all.password_again !== all.password) {
      problems.password_again = t('The two passwords are not the same.');
    }
    if (Object.keys(problems).length) throw new ApiError(400, t('Please correct the highlighted fields.'), problems);
    keepValues(v);
    setErrors((e) => ({ ...e, [step]: undefined }));
    setDone((d) => new Set(d).add(step));
    go(step + 1);
  }

  // which step and field a problem the server found belongs to
  const fieldOf = (name) => ({
    kifle_ketema_ids: 'kifle_ketema_id', kebele_ids: 'kebele_id', sector_ids: 'sector_id',
  }[name] || name);
  const stepOf = (name) => fields.find((f) => f.name === name)?.page ?? 0;

  async function save() {
    setSaving(true);
    setSaveError('');
    const v = values;
    try {
      const made = await api.post('/users', {
        first_name: v.first_name, father_name: v.father_name, grandfather_name: v.grandfather_name, role: v.role, password: v.password, is_active: v.is_active, email: v.email, phone: v.phone,
        kifle_ketema_ids: (ONE_PER_KIFLE_KETEMA.includes(v.role) ? [v.kifle_ketema_id] : []).filter(Boolean).map(Number),
        kebele_ids: (v.role === 'KEBELE_ADMIN' || v.role === 'SECTOR_ADMIN') && v.kebele_id ? [Number(v.kebele_id)] : [],
        sector_ids: v.role === 'SECTOR_ADMIN' && v.sector_id ? [Number(v.sector_id)] : [],
      });
      navigate('/users', { state: { flash: t('{name} has been created. Their username is {username}; they choose their own password at first sign-in.', { name: made.full_name, username: made.username }) } });
    } catch (err) {
      const details = err instanceof ApiError ? err.details || {} : {};
      if (Object.keys(details).length) {
        // back to the step with the problem, with the problem marked
        const byStep = {};
        for (const [k, m] of Object.entries(details)) (byStep[stepOf(fieldOf(k))] ||= {})[fieldOf(k)] = m;
        setErrors(byStep);
        go(Math.min(...Object.keys(byStep).map(Number)));
      } else {
        setSaveError(err.message || t('Unexpected error. Please try again.'));
      }
    } finally {
      setSaving(false);
    }
  }

  // how a value reads on the review page
  const shownValue = (f) => {
    const v = values[f.name];
    if (f.type === 'password') return v ? '•'.repeat(Math.min(v.length, 14)) : null;
    if (f.type === 'checkbox') return t(v ? 'Yes' : 'No');
    if (isEmpty(v)) return null;
    if (f.type === 'select' || f.type === 'multiselect') {
      const options = typeof f.options === 'function' ? f.options(values) : f.options || [];
      const names = [].concat(v).map((x) => options.find((o) => String(o.value) === String(x))?.label ?? String(x));
      return names.map((n) => t(n)).join(', ');
    }
    return String(v);
  };

  const stepFields = fields.filter((f) => f.page === step);
  const back = step > 0 && (
    <button type="button" className="btn btn-icon-only btn-step" onClick={() => go(step - 1)} title={t('Back')} aria-label={t('Back')}>
      <NavIcon name="chevronLeft" />
    </button>
  );
  const cancel = () => navigate('/users');

  return (
    <>
      <PageHeader title="Add user" subtitle={values.role ? label(values.role) : undefined} />
      <section className="card stepper-card">
        <Stepper steps={steps} current={step} done={done} reached={reached} onGo={go} />
      </section>

      <section className="card">
        <h2>{t('Step {n}', { n: step + 1 })} · {steps[step].title}</h2>
        {step === 1 && noneFree && <Alert kind="info">{t('Every area you can choose already has its administrator. To replace one, first deactivate their account on the Users page.')}</Alert>}
        {step < REVIEW ? (
          step === 1 && CITYWIDE.includes(values.role) ? (
            <>
              <p className="muted">{t('A {role} sees the whole City by role, so there is no area to assign.', { role: label(values.role) })}</p>
              <div className="form-actions">
                <button type="button" className="btn btn-cancel" onClick={cancel}>{t('Cancel')}</button>
                {back}
                <button type="button" className="btn btn-primary btn-icon-only btn-step" onClick={() => next({})} title={t('Next')} aria-label={t('Next')}>
                  <NavIcon name="chevronRight" />
                </button>
              </div>
            </>
          ) : (
            <SpecForm
              key={`${step}-${formKey}`}
              fields={stepFields}
              initial={values}
              initialErrors={errors[step]}
              onValues={keepValues}
              onSubmit={next}
              submitLabel="Next"
              secondary={back}
              onCancel={cancel}
            />
          )
        ) : (
          <>
            <Alert>{saveError}</Alert>
            {[0, 1, 2, 3].map((i) => {
              const rows = fields.filter((f) => f.page === i && f.type !== 'custom' && f.name !== 'password_again' && shown(f))
                .map((f) => [f, shownValue(f)]).filter(([, v]) => v != null);
              return (
                <div key={i} className="review-block">
                  <div className="review-head">
                    <h3>{steps[i].title}</h3>
                    <button type="button" className="btn btn-small" onClick={() => go(i)}>{t('Edit')}</button>
                  </div>
                  {rows.length ? (
                    <dl className="dl">
                      {rows.map(([f, v]) => <Fragment key={f.name}><dt>{t(f.label)}</dt><dd>{v}</dd></Fragment>)}
                    </dl>
                  ) : <p className="muted small">{i === 1 && CITYWIDE.includes(values.role) ? t('Whole city') : t('Nothing entered.')}</p>}
                </div>
              );
            })}
            <div className="form-actions">
              <button type="button" className="btn btn-cancel" onClick={cancel} disabled={saving}>{t('Cancel')}</button>
              {back}
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving…') : t('Create account')}</button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
