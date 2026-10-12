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

// The hero film: "Jimma Zone in Transformation" by the Office of the Prime Minister of Ethiopia, played by YouTube's own
// (privacy-enhanced) player, muted, behind the headline. Only seconds 12-26 loop: night aerials of the city (fountains,
// street lamps, the skyline) between the film's two title cards ("Corridors Development" at ~10 s, "Abajifar Palace
// Renovated" at ~28 s), which would clash with the headline. Change `start`/`end` (seconds) to loop another stretch.
const HERO_VIDEO = { id: 'pgjORbFCwVo', title: 'Jimma Zone in Transformation', start: 12, end: 26 };

const YOUTUBE = 'https://www.youtube-nocookie.com';

const PREPARE = 4.5; // seconds before the end of the loop that the hidden player starts, so its icon has gone by the switch
const ICON = 3500; // ms: YouTube shows its own pause button for about 3 s whenever a player starts or jumps

/**
 * The film fades in only once YouTube's player reports that it is really playing, so its loading spinner or an error
 * screen is never seen. The hero photo (or its gradient) stays underneath, and is all that shows without a
 * connection, with "reduced motion" or "data saver" switched on, or whenever the film cannot play.
 *
 * Seamless loop: YouTube shows its pause button for ~3 s every time a player starts or jumps back. So two players take
 * turns: while one is shown, the other starts the loop hidden, PREPARE seconds early; at the end of the stretch they
 * cross-fade and the one that was shown pauses. If the hidden one is not ready in time, the shown one simply jumps back.
 */
function HeroVideo() {
  const frames = [useRef(null), useRef(null)];
  const [wanted, setWanted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [shown, setShown] = useState(0); // which of the two players is visible
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection?.saveData;
    if (!reduce && !saveData && navigator.onLine !== false) setWanted(true);
  }, []);
  useEffect(() => {
    if (!wanted) return undefined;
    const { start, end } = HERO_VIDEO;
    // the YouTube player API over postMessage: say we are listening, then follow each player's state and time
    const post = (i, msg) => frames[i].current?.contentWindow?.postMessage(JSON.stringify(msg), YOUTUBE);
    const command = (i, func, args = []) => post(i, { event: 'command', func, args });
    const heard = [false, false];
    const hello = setInterval(() => [0, 1].forEach((i) => { if (!heard[i]) post(i, { event: 'listening', id: `hero${i}`, channel: 'widget' }); }), 700);
    const players = [{ state: -1, time: 0 }, { state: -1, time: 0 }];
    let active = 0;
    let preparing = false;
    let revealing = false;
    let warmed = false;
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));

    const onMessage = (e) => {
      if (e.origin !== YOUTUBE) return;
      const i = frames.findIndex((f) => f.current?.contentWindow === e.source);
      if (i < 0) return;
      let d;
      try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      heard[i] = true;
      const p = players[i];
      const state = d?.event === 'onStateChange' ? d.info : d?.info?.playerState;
      if (typeof state === 'number') p.state = state;
      if (typeof d?.info?.currentTime === 'number') p.time = d.info.currentTime;
      const other = 1 - active;
      if (i !== active) {
        // warm-up: the hidden player loads the film once, then waits paused until its turn
        if (!warmed && p.state === 1 && !preparing) { warmed = true; command(i, 'pauseVideo'); }
        return;
      }

      if (p.state === 1 && !revealing) {
        revealing = true;
        later(() => setRevealed(true), ICON); // after the first start's icon has gone
        command(other, 'playVideo'); // warm the other player up
      }
      if (p.time >= end - PREPARE && !preparing) {
        preparing = true;
        command(other, 'seekTo', [start, true]);
        command(other, 'playVideo');
      }
      if (p.time >= end - 0.4 || p.state === 0) {
        const o = players[other];
        if (o.state === 1 && o.time >= start + ICON / 1000 - 0.5) {
          // cross-fade to the player that started early, then pause this one once it is hidden
          const old = active;
          active = other;
          preparing = false;
          setShown(other);
          later(() => command(old, 'pauseVideo'), 1600);
        } else {
          command(active, 'seekTo', [start, true]); // fallback: jump back (the icon shows briefly)
          if (p.state !== 1) command(active, 'playVideo');
          preparing = false;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => { clearInterval(hello); timers.forEach(clearTimeout); window.removeEventListener('message', onMessage); };
  }, [wanted]);
  if (!wanted) return null;
  const { id, start } = HERO_VIDEO;
  const src = (autoplay) => `${YOUTUBE}/embed/${id}?${new URLSearchParams({
    autoplay, mute: '1', start: String(start), enablejsapi: '1', origin: window.location.origin,
    controls: '0', disablekb: '1', playsinline: '1', rel: '0', modestbranding: '1', iv_load_policy: '3',
  })}`;
  return (
    <div className={`lp-video${revealed ? ' is-on' : ''}`} aria-hidden="true">
      {[0, 1].map((i) => (
        <iframe
          key={i} ref={frames[i]} src={src(i === 0 ? '1' : '0')} title={HERO_VIDEO.title} tabIndex={-1}
          className={shown === i ? 'is-shown' : undefined}
          allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin"
        />
      ))}
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
  { id: 'mayor', title: "Mayor's office", tags: ['Whole city', 'Reports', 'Analytics'], text: 'The City at a glance: where its assets stand, which area is falling behind, and the confirmed monthly reports of the Kifle Ketemas.' },
  { id: 'kifle', title: 'Kifle Ketema', tags: ['Approval', 'Inspectors', 'Jiren · Hirmata · Gibe'], text: 'Approves registrations, transfers and disposals, and follows the Inspectors and Financial Officers of its area.' },
  { id: 'kebele', title: 'Kebele', tags: ['Site verification', 'QR scan', '13 Kebeles'], text: 'Confirms on site that each newly registered asset really exists where the register says, and runs physical verification.' },
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
  useMotion(root);
  const year = new Date().getFullYear();
  return (
    <div className="lp" ref={root} id="top">
      <header className="lp-nav">
        <a className="lp-logo" href="#top">JIMMA <b>ASSETS</b></a>
        <nav className="lp-links" aria-label={t('Main')}>
          <a className="is-on" href="#top">{t('Home')}</a>
          <a href="#features">{t('Features')}</a>
          <a href="#about">{t('About')}</a>
          <a href="#contact">{t('Contact')}</a>
        </nav>
        <div className="lp-nav-end">
          <LanguageSwitcher className="lp-lang" />
          <Link className="lp-pill lp-pill-light" to="/login">{t('Sign in')} <Arrow /></Link>
        </div>
      </header>

      <div className="lp-stack">
        {/* hero */}
        <section className="lp-panel lp-hero" style={photo('hero')}>
          <HeroVideo />
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
