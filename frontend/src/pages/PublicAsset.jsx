import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { date, label } from '../format.js';
import { Badge } from '../components/ui.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { t } from '../i18n.jsx';

// What a printed QR code opens on any phone, without signing in: the asset, its photos and the public facts about it.
// The server leaves out money, people's names, the GPS position, identification numbers and the history.

const STAGE = {
  ACTIVE: ['Verified and in the register', 'GOOD'],
  APPROVED: ['Approved, being put into operation', 'GOOD'],
  REVIEWED: ['Verified on site, waiting for approval', 'PENDING'],
  SUBMITTED: ['Registered, waiting for verification on site', 'PENDING'],
  DRAFT: ['Registration not finished', 'DRAFT'],
};

function Facts({ title, rows }) {
  const shown = rows.filter(([, v]) => v != null && v !== '');
  if (!shown.length) return null;
  return (
    <section className="card pa-card">
      <h2>{t(title)}</h2>
      <dl className="dl">
        {shown.map(([term, v]) => <div key={term} style={{ display: 'contents' }}><dt>{t(term)}</dt><dd>{v}</dd></div>)}
      </dl>
    </section>
  );
}

export default function PublicAsset() {
  const { token } = useParams();
  const [card, setCard] = useState(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(0);

  useEffect(() => {
    fetch(`/api/public/assets/${encodeURIComponent(token)}`)
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 404 ? 'No asset matches this label.' : r.status === 410 ? 'This label has been cancelled: the asset now carries a new label.' : 'The asset could not be loaded. Try again.'); return r.json(); })
      .then(setCard)
      .catch((e) => setError(e.message));
  }, [token]);

  const a = card?.asset;
  const photos = card?.photos || [];
  const photoUrl = (p) => `/api/public/assets/${encodeURIComponent(token)}/photos/${p.id}`;
  const [stageText, stageTone] = STAGE[a?.approval_state] || [a?.approval_state, 'DRAFT'];
  const value = (d) => (d.type === 'number' ? `${Number(d.value).toLocaleString('en-US')}${d.unit ? ` ${d.unit}` : ''}`
    : d.type === 'date' ? date(d.value) : d.type === 'select' ? t(d.value) : d.value);

  return (
    <div className="pa">
      <header className="pa-top">
        <Link to="/" className="pa-brand">
          <img src="/brand/logo-256.png" alt="" width="40" height="40" />
          <span><strong>{t('Jimma City')}</strong><small>{t('Public asset record')}</small></span>
        </Link>
        <LanguageSwitcher />
      </header>

      <main className="pa-main">
        {error && <div className="alert alert-error" role="alert">{t(error)}</div>}
        {!card && !error && <p className="muted" role="status">{t('Loading…')}</p>}
        {a && (
          <>
            <section className="pa-hero">
              {photos.length > 0 ? (
                <div className="pa-gallery">
                  <a href={photoUrl(photos[shown])} target="_blank" rel="noreferrer" className="pa-photo">
                    <img src={photoUrl(photos[shown])} alt={t('Photo of {name}', { name: a.name })} />
                  </a>
                  {photos.length > 1 && (
                    <div className="pa-thumbs" role="list" aria-label={t('Photos')}>
                      {photos.map((p, i) => (
                        <button key={p.id} type="button" role="listitem" className={i === shown ? 'is-on' : undefined} onClick={() => setShown(i)} aria-label={t('Photo {n} of {total}', { n: i + 1, total: photos.length })}>
                          <img src={photoUrl(p)} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : <div className="pa-photo pa-nophoto" aria-hidden="true">📷</div>}
              <div className="pa-title">
                <p className="pa-code">{a.asset_code}</p>
                <h1>{a.name}</h1>
                <p className="muted">{[a.asset_type_name || a.category_name, a.kebele_name || a.kifle_ketema_name].filter(Boolean).map((x) => t(x)).join(' · ')}</p>
                <div className="pa-badges">
                  <Badge value={stageTone} text={stageText} />
                  <Badge value={a.status} />
                  <Badge value={a.condition} text={t('Condition: {c}', { c: label(a.condition) })} />
                  {a.archived && <Badge value="DRAFT" text="Archived" />}
                </div>
              </div>
            </section>

            <div className="pa-grid">
              <Facts title="What it is" rows={[
                ['Category', t(a.category_name)], ['Type', a.asset_type_name && t(a.asset_type_name)], ['Function / use', a.function_use],
                ['Registration / plate number', a.registration_number], ['Description', a.description],
              ]} />
              <Facts title="Where it belongs" rows={[
                ['Kifle Ketema', t(a.kifle_ketema_name)], ['Kebele', a.kebele_name && t(a.kebele_name)], ['Building / facility / place', a.location_detail],
              ]} />
              <Facts title="Who is responsible" rows={[
                ['Owner', a.owner_name], ['Ownership', label(a.ownership_type)], ['Responsible sector', t(a.sector_name)],
                ['Responsible office', a.responsible_office], ['Registered on', date(a.registered_on)],
                ['Reservation', a.is_reservable ? t('Can be reserved through the City') : null],
              ]} />
              {card.sector_details.length > 0 && (
                <Facts title={t('{sector} details', { sector: t(a.sector_name) })} rows={card.sector_details.map((d) => [d.label, value(d)])} />
              )}
            </div>

            <p className="muted small pa-note">
              {t('This page shows the public facts about a City asset. Money, people\'s names and other confidential records are only for City staff.')}{' '}
              <Link to={`/scan/${a.asset_code}`}>{t('City staff: sign in for the full record')}</Link>
            </p>
          </>
        )}
      </main>
      <footer className="pa-foot muted small">{t('Jimma City Administration · Smart Asset Management System')}</footer>
    </div>
  );
}
