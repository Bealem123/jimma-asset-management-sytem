import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/500.css';
import '@fontsource-variable/dm-sans';
import '@fontsource/noto-serif-ethiopic/400.css';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { t } from '../i18n.jsx';
import './landing.css';

// The public front page, shown to visitors who are not signed in. Layout: a full-screen photo hero, then panels with
// rounded tops that slide over each other as the page scrolls (position: sticky), each lifting in gently.
//
// Photos: every panel shows the image named in PHOTOS if it exists in frontend/public/landing/, and a colour
// gradient in its place until then (see public/landing/README.txt). Use photographs of Jimma.

const PHOTOS = {
  hero: '/landing/hero.jpg',
  about: '/landing/about.png', // a cut-out with a transparent background, shown without a frame
  register: '/landing/register.jpg',
  inspect: '/landing/machinery.jpg',
  map: '/landing/map.jpg',
  report: '/landing/report.jpg',
  mayor: '/landing/level-mayor.jpg',
  kifle: '/landing/level-kifle-ketema.jpg',
  kebele: '/landing/level-kebele.jpg',
  sector: '/landing/level-sector.jpg',
  closing: '/landing/closing.jpg',
};
const photo = (key) => ({ '--photo': `url(${PHOTOS[key]})` });
/** The whole photo, uncropped: shown under the text on screens too narrow for the panel's full-bleed photo (landing.css). */
const WholePhoto = () => <div className="lp-photo" aria-hidden="true" />;

// Transformed Jimma City night scenes extracted directly from the official transformation video in high quality
const HERO_SLIDES = [
  {
    src: '/landing/hero-corridor-night.jpg',
    title: 'Jimma City Transformed Corridor Boulevard',
  },
  {
    src: '/landing/hero-city-aerial.jpg',
    title: 'Modern Municipal Assets and Night Skyline',
  },
  {
    src: '/landing/hero-lamp-overlook.jpg',
    title: 'Iconic Lotus Streetlamp and Avenue',
  },
  {
    src: '/landing/hero-fountain-night.jpg',
    title: 'Illuminated Central Fountain and Waterfront Park',
  },
  {
    src: '/landing/hero-monument-aerial.jpg',
    title: 'Jimma City Center Roundabout and Public Infrastructure',
  },
];

/**
 * Self-moving, best-quality hero slideshow extracted from the city transformation film.
 * Subtle Ken-Burns pan/zoom gives continuous gentle motion to the background,
 * auto-advancing with a silky smooth cross-fade.
 */
function HeroSlideshow() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="lp-hero-slideshow" aria-hidden="true">
      {HERO_SLIDES.map((slide, idx) => (
        <div
          key={slide.src}
          className={`lp-hero-slide ${idx === current ? 'is-active' : ''}`}
          style={{ backgroundImage: `url(${slide.src})` }}
        />
      ))}
      <div className="lp-hero-dots">
        {HERO_SLIDES.map((_, idx) => (
          <button
            key={idx}
            type="button"
            className={`lp-hero-dot ${idx === current ? 'is-active' : ''}`}
            onClick={() => setCurrent(idx)}
            aria-label={`Go to slide ${idx + 1}`}
            tabIndex={-1}
          />
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    id: 'register', title: 'Register, verify, approve',
    text: 'A Sector Administrator registers the asset, the Kebele Administrator checks it on site with GPS, a photo and its QR label, and the Kifle Ketema Administrator approves it. Nobody takes two steps on the same asset.',
  },
  {
    id: 'inspect', title: 'Inspect and maintain',
    text: 'Inspectors record the technical condition of buildings, roads, vehicles and machinery. A failed inspection becomes a follow-up action, and overdue work is reported to the Kifle Ketema.',
  },
  {
    id: 'map', title: 'Map, QR codes and field work',
    text: 'Every asset has a QR label and a place on the city map. Officers scan it with their phone and keep working offline; their results are sent when the connection returns.',
  },
  {
    id: 'report', title: 'Accountable every month',
    text: 'Each level confirms its monthly report and sends it up the chain to the Mayor, in the Ethiopian or the Gregorian calendar. Every change stays in the audit trail.',
  },
];

const LEVELS = [
  { id: 'mayor', title: 'Lemat Trufat', tags: ['PM Dr. Abiy Ahmed', 'Avocado', 'Food security'], text: 'Prime Minister Dr. Abiy Ahmed visits Lemat Trufat and sees crates of avocados being sorted for market. Every crate, store and vehicle behind this work is a public asset the system keeps on record.' },
  { id: 'kifle', title: 'Kifle Ketema', tags: ['Approval', 'Inspectors', 'Jiren · Hirmata · Gibe'], text: 'Approves registrations, transfers and disposals, and follows the Inspectors and Financial Officers of its area.' },
  { id: 'kebele', title: 'Jimma City Center', tags: ['Site verification', 'Streets & squares', '13 Kebeles'], text: 'From the roundabout monument to every street light, square and public building, the Kebele confirms on site that each asset really exists where the register says.' },
  { id: 'sector', title: 'Sector', tags: ['Registration', 'Maintenance', '13 sectors'], text: 'Registers the assets of its sector, keeps their records up to date and requests transfers, maintenance and disposals.' },
];

const Arrow = () => <span aria-hidden="true" className="lp-arrow">↗</span>;

/** "SCROLL DOWN" written up both edges of a panel, as in the design. */
const Edges = () => (
  <>
    <span className="lp-edge lp-edge-left" aria-hidden="true">{t('Scroll down')}</span>
    <span className="lp-edge lp-edge-right" aria-hidden="true">{t('Scroll down')}</span>
  </>
);

/**
 * Motion: content lifts in when it comes into view, and a panel recedes slightly while the next one slides over it.
 * Nothing moves for people who ask their system for reduced motion.
 */
function useMotion(root) {
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const panels = [...el.querySelectorAll('.lp-stack > .lp-panel')];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // A panel taller than the screen sticks only once its bottom is reached, so the next one never hides its content.
    const place = () => {
      const h = window.innerHeight;
      panels.forEach((p) => p.style.setProperty('--stick', `${Math.min(0, h - p.offsetHeight)}px`));
    };
    let frame = 0;
    const update = () => {
      frame = 0;
      if (reduce) return;
      const h = window.innerHeight;
      panels.forEach((p, i) => {
        const next = panels[i + 1];
        if (!next) return;
        // 0 while the next panel is below the screen, 1 once it covers this one
        const covered = Math.min(1, Math.max(0, 1 - next.getBoundingClientRect().top / h));
        p.style.setProperty('--covered', covered.toFixed(3));
      });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    const onResize = () => { place(); onScroll(); };
    place();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null; // fonts, photos and language changes alter heights
    panels.forEach((p) => ro?.observe(p));

    let io = null;
    const reveals = el.querySelectorAll('.lp-reveal');
    if (!reduce && 'IntersectionObserver' in window) {
      el.classList.add('lp-motion');
      io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      }), { threshold: 0.15 });
      reveals.forEach((r) => io.observe(r));
    }
    return () => {
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);
}

export default function Landing() {
  const root = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useMotion(root);
  // the menu panel closes with Escape, and by itself once the screen is wide enough to show the links in a row
  useEffect(() => {
    if (!menuOpen) return undefined;
    const wide = window.matchMedia('(min-width: 901px)');
    const close = () => setMenuOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onWide = () => { if (wide.matches) close(); };
    window.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => { window.removeEventListener('keydown', onKey); wide.removeEventListener('change', onWide); };
  }, [menuOpen]);
  const year = new Date().getFullYear();
  return (
    <div className="lp" ref={root} id="top">
      <header className={`lp-nav${menuOpen ? ' is-open' : ''}`}>
        <a className="lp-logo" href="#top">JIMMA <b>ASSETS</b></a>
        {/* a row of links on large screens; a drop-down panel opened by the menu button on tablets and phones */}
        <nav className="lp-links" id="lp-menu" aria-label={t('Main')}>
          {/* closes the panel once a link is followed */}
          <div className="lp-links-list" onClick={(e) => { if (e.target.closest('a')) setMenuOpen(false); }}>
            <a className="is-on" href="#top">{t('Home')}</a>
            <a href="#features">{t('Features')}</a>
            <a href="#about">{t('About')}</a>
            <a href="#contact">{t('Contact')}</a>
          </div>
          <LanguageSwitcher className="lp-lang lp-lang-menu" />
        </nav>
        <div className="lp-nav-end">
          <LanguageSwitcher className="lp-lang lp-lang-bar" />
          <Link className="lp-pill lp-pill-light" to="/login">{t('Sign in')} <Arrow /></Link>
          <button
            type="button" className="lp-menu-btn" aria-controls="lp-menu" aria-expanded={menuOpen}
            aria-label={t(menuOpen ? 'Close' : 'Menu')} onClick={() => setMenuOpen((o) => !o)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="lp-stack">
        {/* hero */}
        <section className="lp-panel lp-hero" style={photo('hero')}>
          <HeroSlideshow />
          <div className="lp-shade" />
          <Edges />
          <div className="lp-hero-text">
            <h1 className="lp-serif lp-reveal">{t("Keeping the City's assets working for its people.")}</h1>
            <a className="lp-begin lp-reveal" href="#about"><span className="lp-line" />{t('Begin scrolling')}</a>
          </div>
        </section>

        {/* about */}
        <section className="lp-panel lp-white" id="about">
          <div className="lp-about">
            <div className="lp-reveal">
              <p className="lp-eyebrow"><span className="lp-line" />{t('About the system')}</p>
              <h2 className="lp-serif">{t('One register for everything Jimma City owns, from the Kebele to the Mayor')}</h2>
              <p className="lp-body">
                {t('Land, buildings, vehicles, machinery and equipment are registered once, verified on site and approved through the City\'s own chain of responsibility: 13 sectors in 13 Kebeles, 3 Kifle Ketemas and the Mayor\'s office. Every change is recorded and nothing is silently overwritten.')}
              </p>
              <div className="lp-actions">
                <Link className="lp-pill lp-pill-dark" to="/login">{t('Sign in')} <Arrow /></Link>
                <a className="lp-text-link" href="#contact">{t('Contact')} <Arrow /></a>
              </div>
              <div className="lp-langs">
                <span className="lp-bubbles" aria-hidden="true"><i>EN</i><i>አማ</i><i>OM</i></span>
                <span className="lp-small">English · አማርኛ · Afaan Oromoo</span>
              </div>
            </div>
            <div className="lp-about-photo lp-reveal" style={photo('about')} role="img" aria-label={t('The system on a mobile phone')} />
          </div>
        </section>

        {/* features: full-screen panels that stack */}
        {FEATURES.map((f, i) => (
          <section key={f.id} className="lp-panel lp-feature" id={i === 0 ? 'features' : undefined} style={photo(f.id)} data-tone={f.id}>
            <div className="lp-shade" />
            <Edges />
            <div className="lp-feature-text lp-reveal">
              <h2 className="lp-serif">{t(f.title)}</h2>
              <p>{t(f.text)}</p>
              <div className="lp-actions">
                <Link className="lp-pill lp-pill-light" to="/login">{t('Sign in')} <Arrow /></Link>
                <a className="lp-pill lp-pill-light" href="#levels">{t('How?')}</a>
              </div>
            </div>
            <WholePhoto />
          </section>
        ))}

        {/* every level of the City */}
        <section className="lp-panel lp-white lp-levels" id="levels">
          <div className="lp-levels-head lp-reveal">
            <h2 className="lp-serif">{t('Built for every level of the City')}</h2>
            <Link className="lp-pill lp-pill-dark" to="/login">{t('Sign in')} <span aria-hidden="true">›</span></Link>
          </div>
          <p className="lp-body lp-reveal">{t('Each person sees their own area and the work that belongs to them, nothing more.')}</p>
          <div className="lp-cards">
            {LEVELS.map((l) => (
              <article key={l.id} className="lp-card lp-reveal" style={photo(l.id)} data-tone={l.id}>
                <div className="lp-shade" />
                <div className="lp-card-text">
                  <h3 className="lp-serif">{t(l.title)}</h3>
                  <ul className="lp-tags">{l.tags.map((tag) => <li key={tag}>{t(tag)}</li>)}</ul>
                  <p>{t(l.text)}</p>
                </div>
                <WholePhoto />
              </article>
            ))}
          </div>
        </section>

        {/* closing */}
        <section className="lp-panel lp-closing" style={photo('closing')}>
          <div className="lp-shade" />
          <Edges />
          <div className="lp-feature-text lp-reveal">
            <h2 className="lp-serif lp-big">{t('There are 13 Kebeles, so why keep 13 registers?')}</h2>
            <p>{t('One city, one register: every Kifle Ketema, Kebele and sector working from the same trusted record.')}</p>
            <div className="lp-actions">
              <Link className="lp-pill lp-pill-light" to="/login">{t('Sign in')} <Arrow /></Link>
            </div>
          </div>
          <WholePhoto />
        </section>
      </div>

      <footer className="lp-footer" id="contact">
        <div>
          <p className="lp-logo">JIMMA <b>ASSETS</b></p>
          <p className="lp-small">{t('Jimma City Administration · Smart Asset Management System')}</p>
        </div>
        <div>
          <p className="lp-small">{t('Accounts are created by the City. For access or help, contact your Kifle Ketema or the system administrator.')}</p>
          <p className="lp-small">© {year} {t('Jimma City Administration')}</p>
        </div>
      </footer>
    </div>
  );
}
