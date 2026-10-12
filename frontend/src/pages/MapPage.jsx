import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, qs } from '../api.js';
import { useLookups } from '../lookups.jsx';
import { label } from '../format.js';
import { Alert, Badge, PageHeader, enumOpt, opt, useAsync } from '../components/ui.jsx';
import { t } from '../i18n.jsx';

const JIMMA = [7.6738, 36.8346];
// condition colours (also shown in the legend, so colour is never the only cue: the list below repeats the condition in words)
// the condition scale of the dashboards (light steps: map tiles are always light)
const COLORS = { EXCELLENT: '#006b3c', GOOD: '#0ca30c', FAIR: '#fab219', POOR: '#ec835a', CRITICAL: '#d03b3b' };
const FILTERS = ['category_id', 'sector_id', 'kifle_ketema_id', 'kebele_id', 'status', 'condition'];

function Select({ id, text, value, onChange, options }) {
  return (
    <div className="field">
      <label htmlFor={id}>{t(text)}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
      </select>
    </div>
  );
}

export default function MapPage() {
  const lk = useLookups();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) || '']));
  const focus = params.get('focus');
  const query = qs(filters);
  const { data, error, loading } = useAsync(() => api.get(`/assets/map${query}`), [query]);
  const [selected, setSelected] = useState(null);
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'kifle_ketema_id') next.delete('kebele_id');
    next.delete('focus');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    map.current = L.map(el.current, { center: JIMMA, zoom: 13 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors', referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!data || !map.current) return;
    layer.current.clearLayers();
    const bounds = [];
    for (const a of data) {
      const marker = L.circleMarker([a.latitude, a.longitude], {
        radius: String(a.id) === focus ? 11 : 7, color: '#ffffff', weight: 2, fillColor: COLORS[a.condition] || '#555', fillOpacity: 0.95,
      });
      marker.on('click', () => setSelected(a));
      marker.bindTooltip(`${a.asset_code} · ${a.name}`);
      marker.addTo(layer.current);
      bounds.push([a.latitude, a.longitude]);
      if (String(a.id) === focus) setSelected(a);
    }
    if (bounds.length) map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [data, focus]);

  const kebeleOptions = useMemo(
    () => lk.kebeles.filter((k) => k.kifle_ketema_id && (!filters.kifle_ketema_id || String(k.kifle_ketema_id) === filters.kifle_ketema_id)),
    [lk.kebeles, filters.kifle_ketema_id],
  );

  return (
    <>
      <PageHeader title="Asset map" subtitle="Assets that have GPS coordinates, coloured by condition. Click one for its details.">
        <Link className="btn" to={`/assets${qs(filters)}`}>{t('Show as list')}</Link>
      </PageHeader>
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('Map filters')}>
        <Select id="m-sec" text="Sector" value={filters.sector_id} onChange={(v) => setFilter('sector_id', v)} options={opt(lk.sectors, undefined, { blank: 'All sectors' })} />
        <Select id="m-cat" text="Category" value={filters.category_id} onChange={(v) => setFilter('category_id', v)} options={opt(lk.categories, undefined, { blank: 'All categories' })} />
        <Select id="m-kif" text="Kifle Ketema" value={filters.kifle_ketema_id} onChange={(v) => setFilter('kifle_ketema_id', v)} options={opt(lk.kifle, undefined, { blank: 'All' })} />
        <Select id="m-keb" text="Kebele" value={filters.kebele_id} onChange={(v) => setFilter('kebele_id', v)} options={opt(kebeleOptions, undefined, { blank: 'All' })} />
        <Select id="m-sta" text="Status" value={filters.status} onChange={(v) => setFilter('status', v)} options={enumOpt(lk.enums.statuses, { blank: 'Any' })} />
        <Select id="m-con" text="Condition" value={filters.condition} onChange={(v) => setFilter('condition', v)} options={enumOpt(lk.enums.conditions, { blank: 'Any' })} />
      </form>
      <Alert>{error}</Alert>
      <div className="map-layout">
        <div ref={el} className="map" role="application" aria-label={t('Map of assets')} />
        <aside className="card map-side" aria-live="polite">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p style={{ margin: 0 }}><Link to={`/assets/${selected.id}`}>{selected.asset_code}</Link></p>
              <p><Badge value={selected.condition} /> <Badge value={selected.status} /></p>
              <dl className="dl">
                <dt>{t('Category')}</dt><dd>{selected.category_name}</dd>
                <dt>{t('Sector')}</dt><dd>{selected.sector_name}</dd>
                <dt>{t('Kifle Ketema')}</dt><dd>{selected.kifle_ketema_name}</dd>
                <dt>{t('Kebele')}</dt><dd>{selected.kebele_name || '—'}</dd>
                <dt>{t('Coordinates')}</dt><dd>{selected.latitude}, {selected.longitude}</dd>
              </dl>
              <Link className="btn btn-primary btn-small" to={`/assets/${selected.id}`}>{t('Open the asset')}</Link>
            </>
          ) : (
            <p className="muted">{loading ? t('Loading…') : data?.length ? t('{n} assets on the map. Click one for details.', { n: data.length }) : t('No assets with coordinates match these filters. Add GPS coordinates when registering or editing an asset.')}</p>
          )}
          <h3 style={{ marginTop: 16 }}>{t('Condition')}</h3>
          <ul className="legend">
            {Object.entries(COLORS).map(([k, c]) => <li key={k}><span className="dot" style={{ background: c }} aria-hidden="true" />{label(k)}</li>)}
          </ul>
        </aside>
      </div>
      {data && data.length > 0 && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary>{t('Text list of the {n} mapped assets', { n: data.length })}</summary>
          <ul className="plain-list">
            {data.slice(0, 300).map((a) => (
              <li key={a.id}><Link to={`/assets/${a.id}`}>{a.asset_code} · {a.name}</Link><span className="muted small">{label(a.condition)} · {a.kifle_ketema_name}{a.kebele_name ? ` / ${a.kebele_name}` : ''}</span></li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
