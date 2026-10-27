import { useState } from 'react';
import { api } from '../api.js';
import { useLookups } from '../lookups.jsx';
import { Alert, Badge, ConfirmDialog, Modal, PageHeader, SpecForm, Tabs, opt } from '../components/ui.jsx';
import { t } from '../i18n.jsx';
import NavIcon from '../components/NavIcon.jsx';

// One entry per master-data table: how to list it and which fields to edit.
function resources(lk) {
  const validated = { name: 'is_validated', type: 'checkbox', label: 'Confirmed', checkLabel: 'Confirmed by Jimma City (no longer a working label)', wide: true };
  const active = { name: 'is_active', type: 'checkbox', label: 'Active', checkLabel: 'Active (can be chosen for new assets)', wide: true };
  // where the area's assets without a GPS position are drawn on the map
  const centreHelp = 'The centre of the area on the asset map: its assets without a GPS position are drawn here. Find the place on the Asset map (Satellite) or in any map application, and copy its coordinates. Leave both empty if not known.';
  const centre = [
    { name: 'latitude', label: 'Centre latitude', type: 'number', step: 'any', kind: 'latitude', placeholder: 'e.g. 7.6738', help: centreHelp },
    { name: 'longitude', label: 'Centre longitude', type: 'number', step: 'any', kind: 'longitude', placeholder: 'e.g. 36.8346' },
  ];
  return [
    { key: 'kifle-ketemas', title: 'Kifle Ketemas', rows: lk.kifle, cols: [['name', 'Name'], ['centre', 'Centre on the map']], validated: true,
      fields: [{ name: 'name', label: 'Name', required: true, wide: true, kind: 'name', maxLength: 120 }, ...centre, validated, active] },
    { key: 'kebeles', title: 'Kebeles', rows: lk.kebeles, cols: [['name', 'Name'], ['kifle_ketema_name', 'Kifle Ketema'], ['centre', 'Centre on the map']], validated: true,
      hint: 'The 13 Kebeles are listed. Use Edit to assign each one to its Kifle Ketema, following the official city structure; the Kifle Ketemas do not need the same number of Kebeles. An asset cannot be registered in a Kebele until it is assigned, and moving a Kebele moves its assets with it. Set each Kebele\'s centre so its assets without GPS appear on the map in their own Kebele.',
      fields: [{ name: 'name', label: 'Name', required: true, kind: 'name', maxLength: 120 }, { name: 'kifle_ketema_id', label: 'Kifle Ketema', type: 'select', options: opt(lk.kifle, undefined, { blank: 'Not confirmed yet' }) }, ...centre, validated, active] },
    { key: 'sectors', title: 'Sectors', rows: lk.sectors, cols: [['code', 'Code'], ['name', 'Name']], validated: true,
      hint: 'The 13 sectors are working project labels, also used as working revenue classifications. They are not an official classification until confirmed.',
      fields: [{ name: 'code', label: 'Code', required: true, maxLength: 20, validate: (v) => (/^[A-Za-z0-9-]{1,20}$/.test(v.trim()) ? null : 'Code: 1 to 20 letters, digits or dashes, e.g. LND.') }, { name: 'name', label: 'Name', required: true, kind: 'name', maxLength: 120 }, { name: 'description', label: 'Description / open questions', type: 'textarea', wide: true }, validated, active] },
    { key: 'asset-categories', title: 'Asset categories', rows: lk.categories, cols: [['name', 'Name']], validated: true,
      hint: 'Candidate categories taken from the project discussions. Validate them with the City.',
      fields: [{ name: 'name', label: 'Name', required: true, wide: true, kind: 'name', maxLength: 120 }, { name: 'description', label: 'Description', type: 'textarea', wide: true }, validated, active] },
    { key: 'asset-types', title: 'Asset types', rows: lk.types, cols: [['name', 'Name'], ['category_name', 'Category']],
      fields: [{ name: 'name', label: 'Name', required: true, kind: 'name', maxLength: 120 }, { name: 'category_id', label: 'Category', type: 'select', required: true, options: opt(lk.categories, undefined, { blank: 'Choose…' }) }, active] },
  ];
}

const toForm = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? '' : typeof v === 'number' ? String(v) : v]));

export default function MasterData() {
  const lk = useLookups();
  const [key, setKey] = useState('sectors');
  const [modal, setModal] = useState(null); // { row } for edit, {} for new
  const [flash, setFlash] = useState('');
  const [toggling, setToggling] = useState(null); // the entry being switched off or on
  const res = resources(lk).find((r) => r.key === key);

  async function setActive(row, active) {
    await api.patch(`/master/${key}/${row.id}`, { is_active: active });
    setToggling(null);
    setFlash(active ? t('{name} is active again.', { name: t(row.name) }) : t('{name} is deactivated: it is kept on existing records but can no longer be chosen.', { name: t(row.name) }));
    await lk.refresh();
  }

  async function save(values) {
    const body = { ...values };
    if (modal.row) await api.patch(`/master/${key}/${modal.row.id}`, body);
    else await api.post(`/master/${key}`, body);
    setModal(null);
    setFlash('Saved.');
    await lk.refresh();
  }

  return (
    <>
      <PageHeader title="Master data" subtitle="The lists every asset record draws from. Changing a name here updates it everywhere; nothing is deleted, only deactivated.">
        <button type="button" className="btn btn-primary" onClick={() => setModal({})}>{t('Add')} {t(res.title).toLowerCase().replace(/s$/, '')}</button>
      </PageHeader>
      <Tabs tabs={resources(lk).map((r) => [r.key, r.title])} value={key} onChange={(k) => { setKey(k); setFlash(''); }} label="Master data lists" />
      {res.hint && <Alert kind="info">{res.hint}</Alert>}
      <Alert kind="success">{flash}</Alert>
      <div className="table-wrap">
        <table>
          <thead><tr>{res.cols.map(([, h]) => <th key={h}>{t(h)}</th>)}{res.validated && <th>{t('Confirmed')}</th>}<th>{t('Active')}</th><th><span className="sr-only">{t('Actions')}</span></th></tr></thead>
          <tbody>
            {res.rows.map((row) => (
              <tr key={row.id}>
                {res.cols.map(([c]) => (
                  <td key={c}>
                    {c === 'centre'
                      ? (row.latitude != null ? <span className="small">{Number(row.latitude).toFixed(5)}, {Number(row.longitude).toFixed(5)}</span> : <span className="badge badge-warn">{t('Not set')}</span>)
                      : (typeof row[c] === 'string' ? t(row[c]) : row[c]) ?? (c === 'kifle_ketema_name' ? <span className="badge badge-warn">{t('Not linked yet')}</span> : '')}
                  </td>
                ))}
                {res.validated && <td>{row.is_validated ? <Badge value="GOOD" text="Confirmed" /> : <span className="badge badge-unvalidated">{t('Working label')}</span>}</td>}
                <td>{row.is_active ? t('Yes') : <Badge value="DRAFT" text="Inactive" />}</td>
                <td>
                  {/* nothing is deleted: an entry still used by assets and accounts is switched off instead */}
                  <div className="actions row-actions">
                    <button type="button" className="btn btn-small btn-icon-only" title={t('Edit')} aria-label={`${t('Edit')} ${t(row.name)}`} onClick={() => setModal({ row })}>
                      <NavIcon name="edit" />
                    </button>
                    {row.is_active ? (
                      <button type="button" className="btn btn-small btn-cancel btn-icon-only" title={t('Deactivate')} aria-label={`${t('Deactivate')} ${t(row.name)}`} onClick={() => setToggling({ row, active: false })}>
                        <NavIcon name="pause" />
                      </button>
                    ) : (
                      <button type="button" className="btn btn-small btn-icon-only" title={t('Activate')} aria-label={`${t('Activate')} ${t(row.name)}`} onClick={() => setToggling({ row, active: true })}>
                        <NavIcon name="check" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {res.rows.length === 0 && <div className="empty">{t('Nothing here yet.')}</div>}
      </div>
      {toggling && (
        <ConfirmDialog
          title={toggling.active ? 'Activate' : 'Deactivate'} danger={!toggling.active} confirmLabel={toggling.active ? 'Activate' : 'Deactivate'}
          message={toggling.active
            ? t('Make {name} available again for new records?', { name: t(toggling.row.name) })
            : t('Deactivate {name}? Records that already use it keep it, but it can no longer be chosen for new ones. You can activate it again at any time.', { name: t(toggling.row.name) })}
          onClose={() => setToggling(null)}
          onConfirm={() => setActive(toggling.row, toggling.active)}
        />
      )}
      {modal && (
        <Modal title={`${modal.row ? 'Edit' : 'Add'} ${res.title.toLowerCase().replace(/s$/, '')}`} onClose={() => setModal(null)}>
          <SpecForm
            key={modal.row?.id ?? 'new'}
            fields={res.fields}
            initial={modal.row ? toForm(modal.row) : { is_active: true, is_validated: false }}
            onSubmit={save}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </>
  );
}
