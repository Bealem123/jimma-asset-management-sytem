import { useState } from 'react';
import { api } from '../api.js';
import { useLookups } from '../lookups.jsx';
import { Alert, Badge, Modal, PageHeader, SpecForm, Tabs, opt } from '../components/ui.jsx';
import { t } from '../i18n.jsx';

// One entry per master-data table: how to list it and which fields to edit.
function resources(lk) {
  const validated = { name: 'is_validated', type: 'checkbox', label: 'Confirmed', checkLabel: 'Confirmed by Jimma City (no longer a working label)', wide: true };
  const active = { name: 'is_active', type: 'checkbox', label: 'Active', checkLabel: 'Active (can be chosen for new assets)', wide: true };
  return [
    { key: 'kifle-ketemas', title: 'Kifle Ketemas', rows: lk.kifle, cols: [['name', 'Name']], validated: true,
      fields: [{ name: 'name', label: 'Name', required: true, wide: true }, validated, active] },
    { key: 'kebeles', title: 'Kebeles', rows: lk.kebeles, cols: [['name', 'Name'], ['kifle_ketema_name', 'Kifle Ketema']], validated: true,
      hint: 'The 13 Kebeles are listed. Use Edit to assign each one to its Kifle Ketema, following the official city structure; the Kifle Ketemas do not need the same number of Kebeles. An asset cannot be registered in a Kebele until it is assigned, and moving a Kebele moves its assets with it.',
      fields: [{ name: 'name', label: 'Name', required: true }, { name: 'kifle_ketema_id', label: 'Kifle Ketema', type: 'select', options: opt(lk.kifle, undefined, { blank: 'Not confirmed yet' }) }, validated, active] },
    { key: 'sectors', title: 'Sectors', rows: lk.sectors, cols: [['code', 'Code'], ['name', 'Name']], validated: true,
      hint: 'The 13 sectors are working project labels, also used as working revenue classifications. They are not an official classification until confirmed.',
      fields: [{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description / open questions', type: 'textarea', wide: true }, validated, active] },
    { key: 'asset-categories', title: 'Asset categories', rows: lk.categories, cols: [['name', 'Name']], validated: true,
      hint: 'Candidate categories taken from the project discussions. Validate them with the City.',
      fields: [{ name: 'name', label: 'Name', required: true, wide: true }, { name: 'description', label: 'Description', type: 'textarea', wide: true }, validated, active] },
    { key: 'asset-types', title: 'Asset types', rows: lk.types, cols: [['name', 'Name'], ['category_name', 'Category']],
      fields: [{ name: 'name', label: 'Name', required: true }, { name: 'category_id', label: 'Category', type: 'select', required: true, options: opt(lk.categories, undefined, { blank: 'Choose…' }) }, active] },
  ];
}

const toForm = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? '' : typeof v === 'number' ? String(v) : v]));

export default function MasterData() {
  const lk = useLookups();
  const [key, setKey] = useState('sectors');
  const [modal, setModal] = useState(null); // { row } for edit, {} for new
  const [flash, setFlash] = useState('');
  const res = resources(lk).find((r) => r.key === key);

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
          <thead><tr>{res.cols.map(([, h]) => <th key={h}>{t(h)}</th>)}{res.validated && <th>{t('Confirmed')}</th>}<th>{t('Active')}</th><th /></tr></thead>
          <tbody>
            {res.rows.map((row) => (
              <tr key={row.id}>
                {res.cols.map(([c]) => <td key={c}>{(typeof row[c] === 'string' ? t(row[c]) : row[c]) ?? (c === 'kifle_ketema_name' ? <span className="badge badge-warn">{t('Not linked yet')}</span> : '')}</td>)}
                {res.validated && <td>{row.is_validated ? <Badge value="GOOD" text="Confirmed" /> : <span className="badge badge-unvalidated">{t('Working label')}</span>}</td>}
                <td>{row.is_active ? t('Yes') : <Badge value="DRAFT" text="Inactive" />}</td>
                <td><button type="button" className="btn btn-small" onClick={() => setModal({ row })}>{t('Edit')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {res.rows.length === 0 && <div className="empty">{t('Nothing here yet.')}</div>}
      </div>
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
