import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { errorHandler } from './middleware/errors.js';
import { noStore, rateLimit } from './lib/security.js';
import authRoutes from './routes/auth.js';
import masterRoutes from './routes/master.js';
import assetOpsRoutes from './routes/assetOps.js';
import assetRoutes from './routes/assets.js';
import requestRoutes from './routes/requests.js';
import reservationRoutes from './routes/reservations.js';
import verificationRoutes from './routes/verification.js';
import notificationRoutes from './routes/notifications.js';
import analyticsRoutes from './routes/analytics.js';
import dashboardRoutes from './routes/dashboard.js';
import auditRoutes from './routes/audit.js';
import monthlyReportRoutes from './routes/monthlyReports.js';
import financeRoutes from './routes/finance.js';
import userRoutes from './routes/users.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import integrationRoutes from './routes/integration.js';
import assistantRoutes from './routes/assistant.js';
import { LANGUAGES, entries, normalizeLang } from './i18n/index.js';
import { SECTOR_FIELDS } from './lib/sectorFields.js';
import {
  ROLE_LABELS, CONDITIONS, STATUSES, APPROVAL_STATES, OWNERSHIP_TYPES, USE_TYPES, MAINTENANCE_STATUSES, MAINTENANCE_KINDS, DOC_TYPES, DOC_RELATED,
  ACQUISITION_METHODS, DISPOSAL_METHODS, LABEL_REPLACE_REASONS, REVENUE_TYPES, INSPECTION_RESULTS, REQUEST_TYPES, REQUEST_STATUSES, RESERVATION_STATUSES,
  VERIFICATION_RESULTS, DISCREPANCY_STATUSES, NOTIFICATION_TYPES, PERMISSIONS,
} from './lib/constants.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  // "Use HTTPS only" (upgrade-insecure-requests, HSTS) belongs to a site served over HTTPS. On a plain-HTTP address
  // such as a computer on the office Wi-Fi it would make a phone fetch the page's scripts over HTTPS, which fail, and
  // the page stays blank. (localhost is unaffected: browsers treat it as secure.)
  const httpsSite = (process.env.PUBLIC_URL || '').startsWith('https://');
  app.use(helmet({
    hsts: httpsSite,
    // OpenStreetMap blocks tile requests that carry no referrer, so send the site's origin (and nothing more) to other sites
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // the map page loads OpenStreetMap tiles and Esri satellite imagery, and the front page embeds its hero film from
    // YouTube (privacy-enhanced player); everything else stays same-origin
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'frame-src': ['https://www.youtube-nocookie.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://server.arcgisonline.com'],
        'connect-src': ["'self'"],
        'worker-src': ["'self'", 'blob:'],
        'upgrade-insecure-requests': httpsSite ? [] : null,
      },
    },
  }));
  // the browser features this site may use: the camera (QR scanner, photos) and the location (on-site checks), nothing else
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()');
    next();
  });
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json({ limit: '1mb' }));
  // request budgets per address (generous for a person, tight for a script); the tests send far more than a person
  const perMinute = (name, normal) => Number(process.env[name] || (config.isTest ? 1e9 : normal));
  app.use('/api', noStore, rateLimit({ windowMs: 60_000, max: perMinute('API_RATE_PER_MINUTE', 600) }));
  app.use('/api/auth/login', rateLimit({ windowMs: 60_000, max: perMinute('LOGIN_RATE_PER_MINUTE', 20), message: 'Too many sign-in attempts. Please wait a minute.' }));
  app.use('/api/public', rateLimit({ windowMs: 60_000, max: perMinute('PUBLIC_RATE_PER_MINUTE', 120) }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  // Enumerations the UI needs, so labels and allowed values live in one place.
  app.get('/api/enums', (req, res) => res.json({
    roles: ROLE_LABELS, conditions: CONDITIONS, statuses: STATUSES, approval_states: APPROVAL_STATES,
    ownership_types: OWNERSHIP_TYPES, use_types: USE_TYPES, maintenance_statuses: MAINTENANCE_STATUSES, maintenance_kinds: MAINTENANCE_KINDS,
    doc_types: DOC_TYPES, doc_related: DOC_RELATED, acquisition_methods: ACQUISITION_METHODS, disposal_methods: DISPOSAL_METHODS, label_replace_reasons: LABEL_REPLACE_REASONS,
    revenue_types: REVENUE_TYPES, inspection_results: INSPECTION_RESULTS, request_types: REQUEST_TYPES, request_statuses: REQUEST_STATUSES,
    reservation_statuses: RESERVATION_STATUSES, verification_results: VERIFICATION_RESULTS, discrepancy_statuses: DISCREPANCY_STATUSES,
    permissions: PERMISSIONS,
    jimma_bounds: config.jimmaBounds, // south, west, north, east: the map stays inside Jimma City
    sector_fields: SECTOR_FIELDS, // what each sector records about its own assets (by sector code)
    notification_types: Object.fromEntries(Object.entries(NOTIFICATION_TYPES).map(([k, v]) => [k, v.label])),
  }));

  // Public: the interface is translated before sign-in too.
  app.get('/api/i18n', (req, res) => res.json(Object.values(LANGUAGES)));
  app.get('/api/i18n/:lang', (req, res) => {
    const lang = normalizeLang(req.params.lang);
    res.set('Cache-Control', 'no-cache').json({ lang, entries: entries(lang) });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/master', masterRoutes);
  // assetOps first: its fixed paths (/map, /scan, /import ...) must win over /:id in assets.js
  app.use('/api/assets', assetOpsRoutes);
  app.use('/api/assets', assetRoutes);
  app.use('/api/requests', requestRoutes);
  app.use('/api/reservations', reservationRoutes);
  app.use('/api/verification', verificationRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/monthly-reports', monthlyReportRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/integration/v1', integrationRoutes);
  app.use('/api/assistant', assistantRoutes); // the AI assistant (read-only, the user's own area)
  app.use('/api/public', publicRoutes); // no sign-in: the asset card a printed QR code opens
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // In production the built React app is served by this same server.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    // every page address gets the app; a missing file (a name with an extension, e.g. /landing/x.jpg) gets a plain 404,
    // never the app's page, which a browser or the offline cache would otherwise keep as that file
    app.get(/^(?!\/api)(?!.*\/[^/]*\.[^/]*$).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
