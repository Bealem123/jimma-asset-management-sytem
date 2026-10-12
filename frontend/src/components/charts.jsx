import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { num } from '../format.js';
import { t } from '../i18n.jsx';
import NavIcon from './NavIcon.jsx';

// Charts drawn as plain SVG. Common rules: thin marks, 4px rounded data ends on a single baseline, hairline solid
// grid, a 2px surface gap between touching fills, text in ink colours (never the series colour), a legend whenever
// there are two or more series, a hover/focus tooltip on every mark, and the numbers also available as a table.
// Colours come from CSS variables (--bar, --pipe-*, --cond-*) so light and dark mode each use their own steps.

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

/** 'YYYY-MM' -> short month name ("Oct"). */
export const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleString('en', { month: 'short' });

/** A clean axis maximum (1, 2, 2.5, 5 x 10^n) at or above the largest value. */
function niceMax(v) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((s) => s * p).find((s) => s >= v);
}

/** The rendered width of an element (for charts that draw at their real size, so text never shrinks). */
function useWidth(fallback = 600) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** The tooltip: the value leads, the label follows. Positioned in % of its relative wrapper. */
function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="viz-tip" role="status" style={{ left: `${tip.x}%`, top: `${tip.y}%` }}>
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  );
}

/** The same numbers as a small table, folded away (the accessible twin of every chart). */
function TableView({ head, rows }) {
  return (
    <details className="viz-table">
      <summary>{t('Show the numbers')}</summary>
      <table>
        <thead><tr>{head.map((h) => <th key={h} className={h === head[0] ? undefined : 'num'}>{t(h)}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={i ? 'num' : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

/**
 * A chart's own colour: categorical slot `hue` (1-8, see --series-* in styles.css), with its track a light tint of it.
 * Each topic keeps one slot everywhere (registrations blue, maintenance orange, sectors aqua ...), so charts are told
 * apart at a glance; without a slot a chart keeps the default --bar colour.
 */
export const hueStyle = (hue) => (hue ? { '--bar': `var(--series-${hue})`, '--bar-track': `color-mix(in srgb, var(--series-${hue}) 16%, var(--surface))` } : undefined);

/** Horizontal bars: one hue, thin marks, direct value labels, zero-based. Rows can link to a filtered list. */
export function Bars({ rows, to, nameOf = (r) => r.name, getValue = (r) => r.n, format = num, empty = 'No assets yet.', hue }) {
  const max = Math.max(1, ...rows.map(getValue));
  if (!rows.length) return <p className="muted">{t(empty)}</p>;
  return (
    <ul className="bars" style={hueStyle(hue)}>
      {rows.map((r, i) => {
        const name = t(nameOf(r));
        const v = getValue(r);
        const inner = (
          <>
            <span className="name" title={name}>{name}</span>
            <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${(v / max) * 100}%`, display: 'block' }} /></span>
            <span className="val">{format(v)}</span>
          </>
        );
        const target = to && v > 0 ? to(r) : null; // some rows (e.g. "no Kebele recorded") have nowhere to go
        return (
          <li key={r.id ?? r.key ?? i} title={`${name}: ${format(v)}`}>
            {target ? <Link to={target} style={{ display: 'contents', color: 'inherit', textDecoration: 'none' }}>{inner}</Link> : inner}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One series over time (e.g. 12 months) as columns, or as a line with a soft area (`kind="area"`).
 * Zero-based, a few clean y ticks, the largest value labelled, every value on hover/focus and in the table.
 */
export function Columns({ rows, getValue, labelOf, title, format = num, kind = 'column', unit = '', hue }) {
  const [hover, setHover] = useState(null);
  const [ref, W] = useWidth();
  const H = 210;
  const pad = { l: 40, r: 12, t: 22, b: 28 };
  const values = rows.map(getValue);
  const max = niceMax(Math.max(0, ...values));
  const plotH = H - pad.t - pad.b;
  const slot = (W - pad.l - pad.r) / Math.max(rows.length, 1);
  const xOf = (i) => pad.l + slot * i + slot / 2;
  const yOf = (v) => pad.t + plotH - (plotH * v) / max;
  const peak = values.indexOf(Math.max(...values));
  const ticks = [0, max / 2, max];
  const short = (v) => (v >= 1000 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : num(v));
  const points = rows.map((r, i) => [xOf(i), yOf(getValue(r))]);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const show = (i) => setHover(i);
  const tip = hover == null ? null : {
    x: (xOf(hover) / W) * 100, y: (yOf(values[hover]) / H) * 100,
    value: `${format(values[hover])}${unit}`, label: labelOf(rows[hover]),
  };
  return (
    <figure className="viz" style={{ margin: 0, ...hueStyle(hue) }}>
      <div className="viz-plot" ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t(title)}: ${rows.map((r, i) => `${labelOf(r)} ${format(values[i])}`).join(', ')}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={yOf(v)} y2={yOf(v)} stroke="var(--line)" strokeWidth="1" />
              <text x={pad.l - 8} y={yOf(v) + 4} textAnchor="end" className="viz-axis">{short(v)}</text>
            </g>
          ))}
          {kind === 'area' ? (
            <>
              <path d={`${line} L${xOf(rows.length - 1)},${yOf(0)} L${xOf(0)},${yOf(0)} Z`} fill="var(--bar)" opacity="0.1" />
              <path d={line} fill="none" stroke="var(--bar)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {hover != null && <line x1={xOf(hover)} x2={xOf(hover)} y1={pad.t} y2={yOf(0)} stroke="var(--line-strong)" strokeWidth="1" />}
              {points.map(([x, y], i) => ((i === hover || i === rows.length - 1)
                ? <circle key={i} cx={x} cy={y} r="4.5" fill="var(--bar)" stroke="var(--surface)" strokeWidth="2" />
                : null))}
            </>
          ) : rows.map((r, i) => {
            const v = values[i];
            const w = Math.min(24, slot * 0.6);
            const x = xOf(i) - w / 2;
            const top = yOf(v);
            const h = yOf(0) - top;
            const rad = Math.min(4, h, w / 2);
            const d = h <= 0 ? '' : `M${x},${yOf(0)} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + w - rad} Q${x + w},${top} ${x + w},${top + rad} V${yOf(0)} Z`;
            return d && <path key={i} d={d} fill="var(--bar)" opacity={hover == null || hover === i ? 1 : 0.45} />;
          })}
          {values[peak] > 0 && hover == null && (
            <text x={xOf(peak)} y={yOf(values[peak]) - 8} textAnchor="middle" className="viz-value">{short(values[peak])}</text>
          )}
          {rows.map((r, i) => ((slot >= 34 || (rows.length - 1 - i) % 2 === 0) && (
            <text key={`l${i}`} x={xOf(i)} y={H - 8} textAnchor="middle" className="viz-axis">{labelOf(r)}</text>
          )))}
          {/* hit areas: the whole column slot, so nobody has to land on a thin mark */}
          {rows.map((r, i) => (
            <rect
              key={`h${i}`} x={xOf(i) - slot / 2} y={pad.t} width={slot} height={plotH} fill="transparent" tabIndex={0}
              aria-label={`${labelOf(r)}: ${format(values[i])}${unit}`}
              onPointerEnter={() => show(i)} onPointerLeave={() => setHover(null)} onFocus={() => show(i)} onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        <Tip tip={tip} />
      </div>
      <TableView head={['Month', title]} rows={rows.map((r, i) => [labelOf(r), `${format(values[i])}${unit}`])} />
    </figure>
  );
}

/** Arc path for a donut segment between two angles (radians, 0 = top, clockwise). */
function arc(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0); const [x1, y1] = p(r1, a1); const [x2, y2] = p(r0, a1); const [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}

/**
 * Part-to-whole at a glance (at most six parts): a thin ring with the total in the middle and a legend with each
 * part's count and share. Parts with nothing in them stay in the legend but draw nothing.
 */
export function Donut({ rows, caption = 'Total', format = num, to }) {
  const [hover, setHover] = useState(null);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const S = 180; const c = S / 2; const r1 = 82; const r0 = 62;
  const gap = total && rows.filter((r) => r.value > 0).length > 1 ? 2 / r1 : 0; // the 2px surface gap
  let a = 0;
  const segs = rows.map((r) => {
    const span = total ? (r.value / total) * Math.PI * 2 : 0;
    const s = { ...r, a0: a + gap / 2, a1: a + span - gap / 2 };
    a += span;
    return s;
  });
  const hv = hover != null ? segs[hover] : null;
  return (
    <figure className="donut" style={{ margin: 0 }}>
      <div className="viz-plot donut-plot">
        <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${t(caption)} ${format(total)}: ${rows.map((r) => `${t(r.label)} ${format(r.value)}`).join(', ')}`}>
          {total === 0 && <circle cx={c} cy={c} r={(r0 + r1) / 2} fill="none" stroke="var(--bar-track)" strokeWidth={r1 - r0} />}
          {segs.map((s, i) => (s.value > 0 && s.a1 > s.a0) && (
            <path
              key={s.key} d={arc(c, c, r0, r1, s.a0, s.a1 >= Math.PI * 2 ? Math.PI * 2 - 0.0001 : s.a1)} fill={s.color} tabIndex={0}
              opacity={hover == null || hover === i ? 1 : 0.4} aria-label={`${t(s.label)}: ${format(s.value)} (${pct(s.value, total)}%)`}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            />
          ))}
          <text x={c} y={c + 2} textAnchor="middle" className="donut-total">{hv ? format(hv.value) : format(total)}</text>
          <text x={c} y={c + 22} textAnchor="middle" className="viz-axis">{hv ? `${t(hv.label)} · ${pct(hv.value, total)}%` : t(caption)}</text>
        </svg>
      </div>
      <ul className="legend-list">
        {rows.map((r, i) => {
          const body = (
            <span className="legend-row">
              <span className="swatch" style={{ background: r.color }} aria-hidden="true" />
              <span className="legend-name">{t(r.label)}</span>
              <span className="legend-val">{format(r.value)}</span>
              <span className="legend-pct">{pct(r.value, total)}%</span>
            </span>
          );
          return (
            <li key={r.key} onPointerEnter={() => r.value && setHover(i)} onPointerLeave={() => setHover(null)} className={hover === i ? 'on' : undefined}>
              {to && r.value > 0 ? <Link to={to(r)}>{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/** One ratio against its whole, as a ring meter: the track is a lighter step of the fill's own colour. */
export function Ring({ value, total, caption, note, tone = 'accent', hue }) {
  const p = total ? Math.min(1, value / total) : 0;
  const S = 96; const r = 40; const len = 2 * Math.PI * r;
  return (
    <div className={`ring ring-${tone}`} style={hueStyle(hue)}>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${t(caption)}: ${Math.round(p * 100)}%`}>
        <circle cx={S / 2} cy={S / 2} r={r} fill="none" className="ring-track" strokeWidth="9" />
        {p > 0 && <circle cx={S / 2} cy={S / 2} r={r} fill="none" className="ring-fill" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${len * p} ${len}`} transform={`rotate(-90 ${S / 2} ${S / 2})`} />}
        <text x={S / 2} y={S / 2 + 6} textAnchor="middle" className="ring-value">{total ? `${Math.round(p * 100)}%` : '—'}</text>
      </svg>
      <div className="ring-caption">{t(caption)}</div>
      {note && <div className="ring-note">{note}</div>}
    </div>
  );
}

/** Ordered stages of one whole as a single stacked bar (e.g. the approval pipeline), with a legend. */
export function StackBar({ rows, format = num, to }) {
  const [hover, setHover] = useState(null);
  const total = rows.reduce((s, r) => s + r.value, 0);
  let x = 0;
  const segs = rows.map((r) => { const s = { ...r, x, w: total ? (r.value / total) * 100 : 0 }; x += s.w; return s; });
  const hv = hover != null ? segs[hover] : null;
  return (
    <div className="stackbar">
      <div className="viz-plot">
        <div className="stackbar-track" role="img" aria-label={rows.map((r) => `${t(r.label)} ${format(r.value)}`).join(', ')}>
          {total === 0 ? <span className="stackbar-empty" /> : segs.map((s, i) => s.value > 0 && (
            <span
              key={s.key} className="stackbar-seg" tabIndex={0} style={{ width: `${s.w}%`, background: s.color, opacity: hover == null || hover === i ? 1 : 0.45 }}
              aria-label={`${t(s.label)}: ${format(s.value)}`}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            />
          ))}
        </div>
        <Tip tip={hv && { x: hv.x + hv.w / 2, y: 0, value: `${format(hv.value)} · ${pct(hv.value, total)}%`, label: t(hv.label) }} />
      </div>
      <ul className="legend-list legend-grid">
        {rows.map((r) => {
          const body = (
            <span className="legend-row">
              <span className="swatch" style={{ background: r.color }} aria-hidden="true" />
              <span className="legend-name">{t(r.label)}</span>
              <span className="legend-val">{format(r.value)}</span>
            </span>
          );
          return <li key={r.key}>{to && r.value > 0 ? <Link to={to(r)}>{body}</Link> : body}</li>;
        })}
      </ul>
    </div>
  );
}

/** A tiny trend line for a stat tile: 2px line, the latest point marked. Decorative; the tile states the value. */
export function Sparkline({ values }) {
  if (!values?.length || values.every((v) => !v)) return null;
  const W = 96; const H = 34; const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [2 + (i * (W - 6)) / Math.max(values.length - 1, 1), H - 4 - ((H - 8) * v) / max]);
  const [lx, ly] = pts.at(-1);
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
      <circle cx={lx} cy={ly} r="3.5" fill="currentColor" />
    </svg>
  );
}

/**
 * A key figure. `feature` makes it the dashboard's headline card (filled, with the figure in yellow); `icon` adds a
 * small icon (a NavIcon name); `spark` adds a trend line from a list of numbers. Each card is tinted with a series
 * colour chosen by its topic (its icon), so the same topic wears the same colour on every dashboard; `hue` overrides.
 */
const TILE_HUE = {
  assets: 1, verification: 1, wrench: 2, map: 3, audit: 3, logout: 4, register: 4, coin: 4, pause: 4,
  search: 5, approvals: 6, performance: 6, import: 7, reports: 7, followups: 7, alert: 8,
};

export function Tile({ value, caption, note, to, tone, feature, icon, spark, hue }) {
  const h = hue ?? TILE_HUE[icon] ?? (feature ? 1 : undefined);
  const body = (
    <>
      <div className="tile-top">
        {icon && <span className="tile-icon" aria-hidden="true"><NavIcon name={icon} /></span>}
        <div className="caption">{t(caption)}</div>
      </div>
      <div className="tile-value">
        <div className="value">{value}</div>
        {spark && <Sparkline values={spark} />}
      </div>
      {note && <div className="note">{t(note)}</div>}
    </>
  );
  const cls = `tile${feature ? ' tile-feature' : ''}${tone ? ` tile-${tone}` : ''}${icon ? ' tile-has-icon' : ''}${h ? ' tile-hued' : ''}`;
  const style = h ? { '--tile': `var(--series-${h})` } : undefined;
  return to ? <Link to={to} className={cls} style={{ textDecoration: 'none', ...style }}>{body}</Link> : <div className={cls} style={style}>{body}</div>;
}
