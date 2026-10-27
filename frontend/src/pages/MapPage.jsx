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
const STREET = 17; // the zoom of one asset: its street, inside its Kebele
const LABEL_ZOOM = 14; // from this zoom on, every asset's name, Kifle Ketema and Kebele are written beside it
const SAT_MAX = 18; // the closest zoom with real satellite photographs of Jimma
const LAYER_KEY = 'map-layer'; // street or satellite, remembered on this device
// Jimma City as a box [south, west, north, east] (set on the server, JIMMA_BOUNDS): the map never leaves it
const DEFAULT_BOUNDS = [7.58, 36.72, 7.78, 36.95];
// condition colours (also shown in the legend, so colour is never the only cue: the list below repeats the condition in words)
// the condition scale of the dashboards (light steps: map tiles are always light)
const COLORS = { EXCELLENT: '#006b3c', GOOD: '#0ca30c', FAIR: '#fab219', POOR: '#ec835a', CRITICAL: '#d03b3b' };
const FILTERS = ['category_id', 'sector_id', 'kifle_ketema_id', 'kebele_id', 'status', 'condition'];
// the popup is HTML: what people typed (an asset's name ...) must not be read as markup
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Assets placed at the same area centre would hide one another: each one after the first is set a few metres out on a
 * spiral around the centre, so all can be seen and clicked. Exact GPS positions are never moved.
 */
function spread(rows) {
  const seen = new Map();
  return rows.map((a) => {
    if (a.placed === 'GPS') return a;
    const key = `${a.latitude},${a.longitude}`;
    const i = seen.get(key) || 0;
    seen.set(key, i + 1);
    if (!i) return a;
    const r = 0.00018 * Math.sqrt(i); // about 20 m, growing slowly
    const angle = i * 2.39996; // the golden angle: an even spiral
    return { ...a, latitude: a.latitude + r * Math.sin(angle), longitude: a.longitude + r * Math.cos(angle) };
  });
}

/** How an asset got its place on the map, in words (for the popup and the side panel). */
function placement(a) {
  if (a.placed === 'GPS') return t('Exact GPS position');
  const area = a.placed === 'KEBELE' ? t('Kebele {name}', { name: t(a.kebele_name) })
    : a.placed === 'KIFLE_KETEMA' ? t('Kifle Ketema {name}', { name: t(a.kifle_ketema_name) })
      : t('Jimma City (the centre of its Kebele is not set yet)');
  return a.gps_outside
    ? t('Its GPS position is outside Jimma, so it is shown at the centre of {area}. Correct its coordinates.', { area })
    : t('No GPS position: shown at the centre of {area}.', { area });
}

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
  const [south, west, north, east] = lk.enums.jimma_bounds || DEFAULT_BOUNDS;
  const city = [[south, west], [north, east]];
  // the server places each asset: at its GPS position in Jimma, or at the centre of its Kebele / Kifle Ketema (approximate)
  const mapped = useMemo(() => spread(data || []), [data]);
  const atCity = useMemo(() => (data || []).filter((a) => a.placed === 'CITY'), [data]);
  // a position recorded outside Jimma is a mistake: never drawn there, listed for correction
  const misplaced = useMemo(() => (data || []).filter((a) => a.gps_outside), [data]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'kifle_ketema_id') next.delete('kebele_id');
    next.delete('focus');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    // held inside Jimma: it cannot be panned away or zoomed out beyond the city
    map.current = L.map(el.current, { center: JIMMA, zoom: 13, minZoom: 12, maxBounds: L.latLngBounds(city).pad(0.25), maxBoundsViscosity: 1 });
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors', referrerPolicy: 'strict-origin-when-cross-origin' });
    // satellite photographs, with place and road names on top, to recognise the building, yard or plot itself
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services';
    // Esri photographs Jimma down to zoom 18 (at 19 it only says "Map data not yet available"): never zoom past that,
    // and on sharp (high-density) screens draw the next level's photos at half size, so they stay crisp
    const crisp = { detectRetina: true, maxZoom: L.Browser.retina ? SAT_MAX + 1 : SAT_MAX, maxNativeZoom: L.Browser.retina ? SAT_MAX - 1 : SAT_MAX };
    const satellite = L.layerGroup([
      L.tileLayer(`${esri}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { ...crisp, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
      L.tileLayer(`${esri}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, crisp),
    ]);
    const maxFor = (layer) => (layer === satellite ? SAT_MAX : 19);
    // the view this person chose last time (only a convenience: without storage, the street map)
    let saved = null;
    try { saved = localStorage.getItem(LAYER_KEY); } catch { /* no storage */ }
    const first = saved === 'satellite' ? satellite : street;
    first.addTo(map.current);
    map.current.setMaxZoom(maxFor(first));
    L.control.layers({ [t('Street map')]: street, [t('Satellite')]: satellite }, null, { position: 'topright', collapsed: false }).addTo(map.current);
    map.current.on('baselayerchange', (e) => {
      map.current.setMaxZoom(maxFor(e.layer)); // a closer street map view steps back to the sharpest photo
      try { localStorage.setItem(LAYER_KEY, e.layer === satellite ? 'satellite' : 'street'); } catch { /* no storage */ }
    });
    // names and places are written on the map from neighbourhood level on; across the whole city they would cover it
    const labels = () => el.current?.classList.toggle('labels-on', map.current.getZoom() >= LABEL_ZOOM);
    map.current.on('zoomend', labels);
    labels();
    layer.current = L.layerGroup().addTo(map.current);
    const timer = setTimeout(() => map.current?.invalidateSize(), 200);
    return () => { clearTimeout(timer); map.current?.remove(); map.current = null; };
  }, []);

  const recenterJimma = () => {
    if (map.current) map.current.fitBounds(city);
  };

  const fitAll = () => {
    if (!map.current || !mapped.length) return;
    map.current.fitBounds(mapped.map((a) => [a.latitude, a.longitude]), { padding: [40, 40], maxZoom: 16 });
  };

  useEffect(() => {
    if (!data || !map.current) return;
    layer.current.clearLayers();
    const bounds = [];
    let focused = null;
    for (const a of mapped) {
      const exact = a.placed === 'GPS';
      // an approximate place (its area's centre) is drawn as a ring with a dashed edge, never like a real position
      const marker = L.circleMarker([a.latitude, a.longitude], {
        radius: String(a.id) === focus ? 12 : 8,
        color: exact ? '#ffffff' : COLORS[a.condition] || '#555',
        weight: exact ? 2.5 : 3,
        dashArray: exact ? null : '4 3',
        fillColor: COLORS[a.condition] || '#555',
        fillOpacity: exact ? 0.95 : 0.3,
      });
      marker.on('click', () => {
        setSelected(a);
        map.current?.flyTo([a.latitude, a.longitude], Math.max(map.current.getZoom(), STREET));
      });
      // where it is, in the City's own terms: Kifle Ketema and Kebele as registered
      const where = [a.kifle_ketema_name && `${t('Kifle Ketema')}: ${t(a.kifle_ketema_name)}`, a.kebele_name && `${t('Kebele')}: ${t(a.kebele_name)}`].filter(Boolean);
      const popupHtml = `
        <div style="font-family: inherit; min-width: 170px; padding: 2px;">
          <strong style="display:block; font-size: 1.05em; margin-bottom: 2px;">${esc(a.name)}</strong>
          <span style="color: #64748b; font-size: 0.85em; display:block; margin-bottom: 6px;">${esc(a.asset_code)}</span>
          <div style="display: flex; gap: 4px; margin-bottom: 6px;">
            <span style="background: ${COLORS[a.condition] || '#666'}; color: #fff; font-size: 0.72em; font-weight: bold; padding: 2px 6px; border-radius: 4px;">${esc(label(a.condition))}</span>
            <span style="background: #e2e8f0; color: #334155; font-size: 0.72em; font-weight: bold; padding: 2px 6px; border-radius: 4px;">${esc(label(a.status))}</span>
          </div>
          <div style="font-size: 0.85em; color: #475569; margin-bottom: 8px;">
            ${esc(a.category_name)}${where.map((w) => `<br>${esc(w)}`).join('')}
          </div>
          ${exact ? '' : `<div style="font-size: 0.8em; color: #92400e; background: #fef3c7; padding: 4px 6px; border-radius: 4px; margin-bottom: 8px;">${esc(placement(a))}</div>`}
          <a href="/assets/${a.id}" style="display: inline-block; background: #006b3c; color: #fff; text-decoration: none; padding: 4px 10px; border-radius: 6px; font-size: 0.82em; font-weight: 600;">${esc(t('View asset'))} →</a>
        </div>
      `;
      marker.bindPopup(popupHtml);
      const place = [a.kifle_ketema_name, a.kebele_name].filter(Boolean).map((x) => esc(t(x))).join(' / ');
      marker.bindTooltip(`<strong>${esc(`${a.asset_code} · ${a.name}`)}</strong>${place ? `<br><span>${place}</span>` : ''}`, {
        permanent: true, direction: 'top', offset: [0, -10], className: 'asset-label',
      });
      marker.addTo(layer.current);
      bounds.push([a.latitude, a.longitude]);
      if (String(a.id) === focus) {
        setSelected(a);
        focused = [a.latitude, a.longitude];
        marker.openPopup();
      }
    }
    // one asset asked for (from its record): its street; otherwise all the assets shown, or the whole city
    if (focused) map.current.setView(focused, STREET);
    else if (bounds.length) map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    else map.current.fitBounds(city);
  }, [mapped, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const kebeleOptions = useMemo(
    () => lk.kebeles.filter((k) => k.kifle_ketema_id && (!filters.kifle_ketema_id || String(k.kifle_ketema_id) === filters.kifle_ketema_id)),
    [lk.kebeles, filters.kifle_ketema_id],
  );

  return (
    <>
      <PageHeader title="Asset map" subtitle="Every asset in its registered Kifle Ketema and Kebele, coloured by condition: at its GPS position, or at the centre of its area when it has none. Click one for its details.">
        <div className="actions">
          <button type="button" className="btn btn-small" onClick={recenterJimma}>{t('Center on Jimma')}</button>
          <button type="button" className="btn btn-small" onClick={fitAll} disabled={!mapped.length}>{t('Fit all assets')}</button>
          <Link className="btn btn-small" to={`/assets${qs(filters)}`}>{t('Show as list')}</Link>
        </div>
      </PageHeader>
      <section className="card" style={{ marginBottom: 16, background: 'var(--surface-2)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '0.98rem' }}>{t('Why use the GIS Asset Map?')}</h3>
        <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>
          {t('The GIS map gives Jimma City leadership and field teams geographic oversight: track public infrastructure (machinery, vehicles, buildings, health facilities) across all 3 Kifle Ketemas and 13 Kebeles, inspect condition hotspots (green for good, red for critical), plan physical verification routes, and prevent unauthorized asset displacement.')}
        </p>
      </section>
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('Map filters')}>
        <Select id="m-sec" text="Sector" value={filters.sector_id} onChange={(v) => setFilter('sector_id', v)} options={opt(lk.sectors, undefined, { blank: 'All sectors' })} />
        <Select id="m-cat" text="Category" value={filters.category_id} onChange={(v) => setFilter('category_id', v)} options={opt(lk.categories, undefined, { blank: 'All categories' })} />
        <Select id="m-kif" text="Kifle Ketema" value={filters.kifle_ketema_id} onChange={(v) => setFilter('kifle_ketema_id', v)} options={opt(lk.kifle, undefined, { blank: 'All' })} />
        <Select id="m-keb" text="Kebele" value={filters.kebele_id} onChange={(v) => setFilter('kebele_id', v)} options={opt(kebeleOptions, undefined, { blank: 'All' })} />
        <Select id="m-sta" text="Status" value={filters.status} onChange={(v) => setFilter('status', v)} options={enumOpt(lk.enums.statuses, { blank: 'Any' })} />
        <Select id="m-con" text="Condition" value={filters.condition} onChange={(v) => setFilter('condition', v)} options={enumOpt(lk.enums.conditions, { blank: 'Any' })} />
      </form>
      <Alert>{error}</Alert>
      {misplaced.length > 0 && (
        <Alert kind="warn">
          {t('{n} asset(s) have a GPS position outside Jimma City, so they are shown at the centre of their registered area instead. Correct their coordinates:', { n: misplaced.length })}{' '}
          {misplaced.map((a, i) => <span key={a.id}>{i > 0 && ', '}<Link to={`/assets/${a.id}/edit`}>{a.asset_code} · {a.name}</Link></span>)}
        </Alert>
      )}
      {atCity.length > 0 && (
        <Alert kind="info">
          {t('{n} asset(s) have no GPS position, and the centre of their Kebele and Kifle Ketema is not set yet, so they are shown at the centre of Jimma City. Add their GPS position, or ask the Super Administrator to set each area\'s centre in Master data:', { n: atCity.length })}{' '}
          {atCity.slice(0, 20).map((a, i) => <span key={a.id}>{i > 0 && ', '}<Link to={`/assets/${a.id}/edit`}>{a.asset_code} · {a.name}</Link></span>)}
          {atCity.length > 20 && ' …'}
        </Alert>
      )}
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
                <dt>{t('Position')}</dt>
                <dd>
                  {selected.placed === 'GPS' ? `${selected.latitude}, ${selected.longitude}` : placement(selected)}
                  {selected.gps_outside && <div className="muted small">{t('Recorded: {lat}, {lng}', { lat: selected.recorded_latitude, lng: selected.recorded_longitude })}</div>}
                </dd>
              </dl>
              <Link className="btn btn-primary btn-small" to={`/assets/${selected.id}`}>{t('Open the asset')}</Link>
            </>
          ) : (
            <p className="muted">{loading ? t('Loading…') : mapped.length ? t('{n} assets on the map. Click one for details.', { n: mapped.length }) : t('No asset matches these filters.')}</p>
          )}
          <p className="muted small">{t('Zoom in to read each asset\'s name, Kifle Ketema and Kebele on the map. Switch to Satellite (top right) to see the place itself.')}</p>
          <h3 style={{ marginTop: 16 }}>{t('Condition')}</h3>
          <ul className="legend">
            {Object.entries(COLORS).map(([k, c]) => <li key={k}><span className="dot" style={{ background: c }} aria-hidden="true" />{label(k)}</li>)}
          </ul>
          <h3 style={{ marginTop: 16 }}>{t('Position')}</h3>
          <ul className="legend">
            <li><span className="dot" style={{ background: '#555', border: '2px solid #fff', boxShadow: '0 0 0 1px #555' }} aria-hidden="true" />{t('Exact GPS position')}</li>
            <li><span className="dot" style={{ background: 'rgba(85,85,85,0.3)', border: '2px dashed #555' }} aria-hidden="true" />{t('Centre of its Kebele, Kifle Ketema or the city (no GPS)')}</li>
          </ul>
        </aside>
      </div>
      {mapped.length > 0 && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary>{t('Text list of the {n} mapped assets', { n: mapped.length })}</summary>
          <ul className="plain-list">
            {mapped.slice(0, 300).map((a) => (
              <li key={a.id}><Link to={`/assets/${a.id}`}>{a.asset_code} · {a.name}</Link><span className="muted small">{label(a.condition)} · {a.kifle_ketema_name}{a.kebele_name ? ` / ${a.kebele_name}` : ''}</span></li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
