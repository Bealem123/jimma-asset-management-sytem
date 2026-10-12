import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { shrinkPhoto } from '../images.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { Alert, Loading, PageHeader, SpecForm, enumOpt, opt, useAsync } from '../components/ui.jsx';
import { t } from '../i18n.jsx';
import Stepper from '../components/Stepper.jsx';

const ACQ_FIELDS = ['method', 'procurement_ref', 'supplier_name', 'supplier_contact', 'contract_ref', 'invoice_ref', 'approval_ref', 'approved_by_name', 'approved_on', 'notes'];

/** Fills latitude and longitude from the device's GPS. */
function GpsButton({ set }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  function locate() {
    setMsg('');
    if (!navigator.geolocation) { setMsg('This device cannot report its location.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set('latitude', p.coords.latitude.toFixed(6));
        set('longitude', p.coords.longitude.toFixed(6));
        setMsg(`Location captured (accuracy about ${Math.round(p.coords.accuracy)} m).`);
        setBusy(false);
      },
      () => { setMsg('Location could not be read. Allow location access, or type the coordinates.'); setBusy(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  return (
    <div>
      <button type="button" className="btn btn-small" onClick={locate} disabled={busy}>{busy ? t('Reading GPS…') : t('Use my current location')}</button>
      {msg && <span className="muted small" role="status"> {msg}</span>}
    </div>
  );
}

/** The photo of the asset, required to register it: choose one from the device or take it with the camera. */
function AssetPhotoInput({ id, value, set }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!value) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  return (
    <div className="asset-photo-input">
      {preview
        ? <img src={preview} alt={t('The photo that will be saved with the asset')} className="asset-photo-preview" />
        : <div className="asset-photo-empty" aria-hidden="true">📷</div>}
      <div>
        <label className={`btn btn-small ${value ? '' : 'btn-primary '}photo-pick`}>
          {t(value ? 'Choose another photo' : 'Take or choose a photo')}
          <input
            id={id} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) set('photo', f); }}
          />
        </label>
        {value && <p className="muted small" style={{ margin: '6px 0 0' }}>{value.name}</p>}
      </div>
    </div>
  );
}

// Registration in five steps: the asset itself, what its sector records about it, where it is and who is
// responsible, how it was acquired and what it is worth, then a review before it is saved. Editing uses the same
// steps, all open at once.
const STEP_ICONS = ['assets', 'reports', 'map', 'coin', 'approvals'];
const REVIEW = 4;
const OTHER_TYPE = '__other'; // "Other" in the Type list: the type is typed in instead
const isEmpty = (v) => v === '' || v == null;

export default function AssetForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { data, error, loading } = useAsync(() => (editing ? api.get(`/assets/${id}`) : Promise.resolve(null)), [id]);

  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (editing && !data.permissions.can_edit) {
    return <Alert>{data.permissions.locked ? t('This asset cannot be edited because it has been disposed.') : t('This asset cannot be edited with your role.')} <Link to={`/assets/${id}`}>{t('Back to the asset')}</Link></Alert>;
  }
  return <AssetWizard key={id || 'new'} id={id} asset={data?.asset} />;
}

function AssetWizard({ id, asset }) {
  const editing = Boolean(asset);
  const navigate = useNavigate();
  const lk = useLookups();
  const { user } = useAuth();

  // A user bound to an area sees and can choose only that area: their own sector, Kebele and Kifle Ketema.
  const sc = user.scope;
  const wide = can.citywide(user);
  const inList = (list, ids) => list.filter((x) => ids.includes(x.id));
  const myKebeles = wide ? lk.kebeles
    : sc.kebeles.length ? inList(lk.kebeles, sc.kebeles)
      : sc.kifle.length ? lk.kebeles.filter((k) => sc.kifle.includes(k.kifle_ketema_id)) : lk.kebeles;
  const mySectors = wide || !sc.sectors.length ? lk.sectors : inList(lk.sectors, sc.sectors);
  const myKifle = wide ? lk.kifle
    : sc.kifle.length ? inList(lk.kifle, sc.kifle)
      : sc.kebeles.length ? lk.kifle.filter((f) => myKebeles.some((k) => k.kifle_ketema_id === f.id)) : lk.kifle;
  // a Sector Administrator's registration fills owner, responsible office and officer on the server
  const filledForMe = user.role === 'SECTOR_ADMIN';
  const onlyOne = (list) => (list.length === 1 ? String(list[0].id) : undefined);
  const myKebele = onlyOne(myKebeles.filter((k) => k.kifle_ketema_id));
  const unlinkedCount = myKebeles.filter((k) => !k.kifle_ketema_id && k.is_active).length;
  const defaults = {
    ...(onlyOne(mySectors) && { sector_id: onlyOne(mySectors) }),
    ...(myKebele && { kebele_id: myKebele, kifle_ketema_id: String(myKebeles.find((k) => String(k.id) === myKebele).kifle_ketema_id) }),
    ...(!myKebele && onlyOne(myKifle) && { kifle_ketema_id: onlyOne(myKifle) }),
  };

  const [initial] = useState(() => (asset
    ? {
      ...Object.fromEntries(Object.entries(asset).filter(([k]) => k !== 'details').map(([k, v]) => [k, v == null ? '' : typeof v === 'number' ? String(v) : v])),
      ...Object.fromEntries(Object.entries(asset.details || {}).map(([k, v]) => [`details.${k}`, v == null ? '' : String(v)])),
      ...(asset.asset_type_other && !asset.asset_type_id && { asset_type_id: OTHER_TYPE }),
      is_reservable: Boolean(asset.is_reservable),
    }
    : { owner_name: 'Jimma City Administration', ownership_type: 'OWNED', condition: 'GOOD', status: 'REGISTERED', acq_method: '', submit: true, ...defaults }));
  const [values, setValues] = useState(initial);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(() => new Set(editing ? [0, 1, 2, 3] : []));
  const [errors, setErrors] = useState({}); // by step: errors the server found when everything was saved
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // active choices only, but keep the value an existing asset already has
  const keep = (rows, current) => rows.filter((r) => r.is_active !== false || String(r.id) === String(current));
  const unvalidated = [...lk.sectors, ...lk.categories, ...lk.kifle, ...lk.kebeles].some((r) => r.is_validated === false);
  // Kebeles whose Kifle Ketema is not confirmed yet cannot be used for an asset
  const linkedKebeles = (rows) => rows.filter((k) => k.kifle_ketema_id);
  const kebeleKifle = (kebeleId) => lk.kebeles.find((k) => String(k.id) === String(kebeleId))?.kifle_ketema_id;
  const clearDetails = (v) => Object.fromEntries(Object.keys(v).filter((k) => k.startsWith('details.')).map((k) => [k, '']));

  // step 2: what this asset's sector records (lib/sectorFields.js on the server); money fields only for those who see money
  const sector = lk.sectors.find((s) => String(s.id) === String(values.sector_id));
  const sectorFields = (lk.enums.sector_fields?.[sector?.code] || []).filter((f) => !f.money || can.financial(user));
  const detailFields = sectorFields.map((f) => ({
    page: 1,
    name: `details.${f.key}`,
    label: `${t(f.label)}${f.unit ? ` (${f.unit})` : ''}`,
    type: f.type,
    required: Boolean(f.required),
    help: f.help,
    ...(f.type === 'select' && { options: [{ value: '', label: 'Choose…' }, ...f.options.map((o) => ({ value: o, label: o }))] }),
    ...(f.type === 'number' && { step: 'any', min: '0' }),
    ...(f.show && { show: (v) => f.show.in.includes(v[`details.${f.show.key}`]) }),
  }));

  const fields = [
    // 1. the asset
    { page: 0, name: 'name', label: 'Asset name', required: true, wide: true, placeholder: 'e.g. Excavator CAT 320' },
    ...(editing ? [] : [{
      page: 0, name: 'photo', label: 'Photo of the asset', type: 'custom', required: true, wide: true,
      help: 'A clear photo of the whole asset. The Kebele Administrator compares it with what they find on site.',
      render: ({ values: v, set, id: fieldId }) => <AssetPhotoInput id={fieldId} value={v.photo} set={set} />,
    }]),
    {
      page: 0, name: 'sector_id', label: 'Responsible sector', type: 'select', required: true, fixedWhenSingle: true, wide: true,
      help: 'The sector that manages this asset. The next step asks what this sector records about it.',
      options: () => opt(keep(mySectors, initial.sector_id), (s) => s.name, { blank: 'Choose…' }),
      derive: (value, v) => clearDetails(v), // another sector records other things
    },
    {
      page: 0, name: 'category_id', label: 'Category', type: 'select', required: true,
      options: () => opt(keep(lk.categories, initial.category_id), undefined, { blank: 'Choose…' }),
      derive: () => ({ asset_type_id: '' }),
    },
    {
      page: 0, name: 'asset_type_id', label: 'Type', type: 'select',
      options: (v) => [
        ...opt(keep(lk.types.filter((ty) => String(ty.category_id) === String(v.category_id)), initial.asset_type_id), undefined, { blank: v.category_id ? 'Choose…' : 'Choose a category first' }),
        ...(v.category_id ? [{ value: OTHER_TYPE, label: 'Other (type it in)' }] : []),
      ],
    },
    {
      page: 0, name: 'asset_type_other', label: 'Type of asset', required: true, placeholder: 'e.g. Concrete mixer',
      help: 'Not in the list? Type it here. An administrator can add it to the list later.',
      show: (v) => v.asset_type_id === OTHER_TYPE,
    },
    { page: 0, name: 'condition', label: 'Physical condition', type: 'select', options: enumOpt(lk.enums.conditions) },
    { page: 0, name: 'function_use', label: 'Function / use', placeholder: 'e.g. Road construction, public transport' },
    { page: 0, name: 'serial_number', label: 'Serial number', help: 'Two live assets cannot share a serial number.' },
    { page: 0, name: 'registration_number', label: 'Registration / plate number' },
    { page: 0, name: 'description', label: 'Description / specifications', type: 'textarea', wide: true },
    // 2. what the sector records
    ...detailFields,
    // 3. where it is and who is responsible
    {
      page: 2, name: 'kifle_ketema_id', label: 'Kifle Ketema', type: 'select', required: true, fixedWhenSingle: true,
      options: () => opt(keep(myKifle, initial.kifle_ketema_id), undefined, { blank: 'Choose…' }),
      derive: (value, v) => (v.kebele_id && String(kebeleKifle(v.kebele_id)) !== String(value) ? { kebele_id: '' } : {}),
    },
    {
      page: 2, name: 'kebele_id', label: 'Kebele', type: 'select', fixedWhenSingle: true,
      help: unlinkedCount ? t('{n} Kebeles are not yet linked to a Kifle Ketema and cannot be chosen. An administrator links them in Master data.', { n: unlinkedCount }) : undefined,
      options: (v) => opt(keep(linkedKebeles(myKebeles).filter((k) => !v.kifle_ketema_id || String(k.kifle_ketema_id) === String(v.kifle_ketema_id)), initial.kebele_id), undefined, { blank: 'Not recorded' }),
      derive: (value) => (value ? { kifle_ketema_id: String(kebeleKifle(value) ?? '') } : {}),
    },
    { page: 2, name: 'location_detail', label: 'Specific location / building / facility', wide: true, placeholder: 'Building, plot, yard or street' },
    { page: 2, name: 'latitude', label: 'Latitude (GPS)', type: 'number', step: 'any' },
    { page: 2, name: 'longitude', label: 'Longitude (GPS)', type: 'number', step: 'any' },
    { page: 2, name: '_gps', type: 'custom', wide: true, label: 'GPS', render: ({ set }) => <GpsButton set={set} /> },
    { page: 2, name: 'ownership_type', label: 'Ownership', type: 'select', options: enumOpt(lk.enums.ownership_types) },
    { page: 2, name: 'owner_name', label: 'Legal owner', required: true, show: () => !filledForMe },
    { page: 2, name: 'responsible_office', label: 'Responsible office', show: () => !filledForMe },
    { page: 2, name: 'responsible_officer', label: 'Responsible officer', show: () => !filledForMe },
    { page: 2, name: 'current_holder', label: 'Current user / holder', help: 'Who has or uses it now. May differ from the owner and the responsible office.', wide: true },
    ...(editing ? [] : [{ page: 2, name: 'status', label: 'Initial status', type: 'select', options: enumOpt(['PLANNED', 'REGISTERED']), help: 'It becomes Active when the approval workflow is completed.' }]),
    { page: 2, name: 'is_reservable', type: 'checkbox', label: 'Reservation', checkLabel: 'This asset can be reserved (vehicle, equipment, hall …)', wide: true },
    // 4. how it was acquired and what it is worth
    { page: 3, name: 'acquisition_date', label: 'Acquisition date', type: 'date' },
    { page: 3, name: 'acquisition_cost', label: 'Acquisition cost (ETB)', type: 'number', step: '0.01', min: '0' },
    { page: 3, name: 'useful_life_years', label: 'Useful life (years)', type: 'number', min: '1', help: 'Used to calculate depreciation.' },
    { page: 3, name: 'salvage_value', label: 'Salvage value (ETB)', type: 'number', step: '0.01', min: '0', help: 'Expected value at the end of its life.' },
    ...(editing ? [] : [
      { page: 3, name: 'current_valuation', label: 'Current valuation (ETB)', type: 'number', step: '0.01', min: '0' },
      { page: 3, name: 'valuation_date', label: 'Valuation date', type: 'date' },
      { page: 3, name: 'acq_method', label: 'How was it acquired?', type: 'select', wide: true, options: [{ value: '', label: 'Not recorded now' }, ...enumOpt(lk.enums.acquisition_methods)], help: 'Recording the acquisition keeps the supplier, contract and approval with the asset.' },
      { page: 3, name: 'acq_procurement_ref', label: 'Procurement reference', show: (v) => v.acq_method },
      { page: 3, name: 'acq_supplier_name', label: 'Supplier / vendor / donor', show: (v) => v.acq_method },
      { page: 3, name: 'acq_supplier_contact', label: 'Supplier contact', show: (v) => v.acq_method },
      { page: 3, name: 'acq_contract_ref', label: 'Contract reference', show: (v) => v.acq_method },
      { page: 3, name: 'acq_invoice_ref', label: 'Invoice reference', show: (v) => v.acq_method },
      { page: 3, name: 'acq_approval_ref', label: 'Acquisition approval (decision / minute)', show: (v) => v.acq_method },
      { page: 3, name: 'acq_approved_by_name', label: 'Approved by', show: (v) => v.acq_method },
      { page: 3, name: 'acq_approved_on', label: 'Approved on', type: 'date', show: (v) => v.acq_method },
    ]),
  ];
  const shown = (f, v = values) => !f.show || f.show(v);

  const sectorName = sector ? t(sector.name) : '';
  const steps = [
    t('Asset'),
    sector ? t('{sector} details', { sector: sectorName }) : t('Sector details'),
    t('Location & responsibility'),
    t('Acquisition & value'),
    t('Review'),
  ].map((title, i) => ({ title, icon: STEP_ICONS[i] }));

  const go = (i) => { setStep(i); setFormKey((k) => k + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const reached = (i) => editing || i === 0 || done.has(i) || done.has(i - 1);
  const keepValues = (v) => setValues((prev) => ({ ...prev, ...v }));

  // Next: what this step needs must be filled in before moving on
  async function next(v) {
    const all = { ...values, ...v };
    const missing = fields.filter((f) => f.page === step && f.required && shown(f, all) && isEmpty(all[f.name]));
    if (missing.length) {
      throw new ApiError(400, t('Please correct the highlighted fields.'), Object.fromEntries(missing.map((f) => [f.name, f.name === 'photo' ? t('Add a photo of the asset.') : t('This is needed.')])));
    }
    keepValues(v);
    setErrors((e) => ({ ...e, [step]: undefined }));
    setDone((d) => new Set(d).add(step));
    go(step + 1);
  }

  // which step a field the server complained about is on
  const stepOf = (name) => {
    if (name.startsWith('details.')) return 1;
    if (name.startsWith('acquisition')) return 3;
    return fields.find((f) => f.name === name)?.page ?? 0;
  };

  async function save() {
    setSaving(true);
    setSaveError('');
    try {
      const body = {};
      for (const f of fields) {
        if (f.type === 'custom' || f.page === 1 || !shown(f)) continue;
        body[f.name] = values[f.name];
      }
      // "Other": no listed type, the typed one instead
      if (body.asset_type_id === OTHER_TYPE) body.asset_type_id = '';
      else body.asset_type_other = '';
      body.details = Object.fromEntries(detailFields.filter((f) => shown(f) && !isEmpty(values[f.name])).map((f) => [f.name.slice(8), values[f.name]]));
      let saved;
      if (editing) {
        saved = await api.patch(`/assets/${id}`, body);
      } else {
        if (body.acq_method) {
          body.acquisition = { method: body.acq_method, acquisition_date: body.acquisition_date, cost: body.acquisition_cost };
          for (const f of ACQ_FIELDS.filter((x) => x !== 'method')) if (body[`acq_${f}`]) body.acquisition[f] = body[`acq_${f}`];
        }
        for (const k of Object.keys(body)) if (k.startsWith('acq_')) delete body[k];
        body.submit = Boolean(values.submit);
        // the asset and its photo travel together: nothing is registered without the photo
        const form = new FormData();
        form.append('data', JSON.stringify(body));
        form.append('photo', await shrinkPhoto(values.photo, 'asset-photo.jpg'));
        saved = await api.post('/assets', form);
      }
      navigate(`/assets/${saved.id}`);
    } catch (err) {
      const details = err instanceof ApiError ? err.details || {} : {};
      if (Object.keys(details).length) {
        // send the person back to the step with the problem, with the problem marked
        const byStep = {};
        for (const [k, m] of Object.entries(details)) (byStep[stepOf(k)] ||= {})[k] = m;
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
    if (f.name === 'photo') return v ? `📷 ${v.name}` : null;
    if (f.type === 'checkbox') return v ? t('Yes') : null;
    if (isEmpty(v)) return null;
    if (f.type === 'select') {
      const options = typeof f.options === 'function' ? f.options(values) : f.options || [];
      const o = options.find((x) => String(x.value) === String(v));
      return o ? t(o.label) : String(v);
    }
    if (f.type === 'number' && f.name !== 'latitude' && f.name !== 'longitude') return Number(v).toLocaleString('en-US');
    return String(v);
  };

  const stepFields = fields.filter((f) => f.page === step);
  const back = step > 0 && <button type="button" className="btn" onClick={() => go(step - 1)}>{t('Back')}</button>;

  return (
    <>
      <PageHeader title={editing ? `Edit ${asset.asset_code}` : 'Register asset'} subtitle={editing ? asset.name : 'A permanent Asset ID is assigned when you save.'} />
      <section className="card stepper-card">
        <Stepper steps={steps} current={step} done={done} reached={reached} onGo={go} />
      </section>
      {step === 0 && unvalidated && <Alert kind="info">{t('Sectors, categories, Kifle Ketemas and Kebeles are working labels until the City confirms them. They can be corrected in Master data without losing any asset records.')}</Alert>}

      <section className="card">
        <h2>{t('Step {n}', { n: step + 1 })} · {steps[step].title}</h2>
        {step === 1 && (
          <p className="muted">
            {sector ? t('What the {sector} sector records about its assets. Fields marked * are needed before the asset can be sent for verification.', { sector: sectorName }) : t('Choose the responsible sector in step 1 first.')}
          </p>
        )}
        {step < REVIEW ? (
          step === 1 && !detailFields.length ? (
            <div className="form-actions">{back}<button type="button" className="btn btn-primary" onClick={() => next({})}>{t('Next')}</button></div>
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
              onCancel={() => navigate(editing ? `/assets/${id}` : '/assets')}
            />
          )
        ) : (
          <>
            <Alert>{saveError}</Alert>
            {[0, 1, 2, 3].map((i) => {
              const rows = fields.filter((f) => f.page === i && f.name !== '_gps' && shown(f)).map((f) => [f, shownValue(f)]).filter(([, v]) => v != null);
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
                  ) : <p className="muted small">{t('Nothing entered.')}</p>}
                </div>
              );
            })}
            {!editing && (
              <label className="check" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={Boolean(values.submit)} onChange={(e) => keepValues({ submit: e.target.checked })} />
                <span>{t('Send it to the Kebele Administrator for verification as soon as it is registered')}</span>
              </label>
            )}
            {!editing && <p className="muted small">{t('Otherwise it is kept as a draft that only you can see, and you can send it later from its page.')}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => navigate(editing ? `/assets/${id}` : '/assets')} disabled={saving}>{t('Cancel')}</button>
              {back}
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving…') : t(editing ? 'Save changes' : 'Register asset')}</button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
