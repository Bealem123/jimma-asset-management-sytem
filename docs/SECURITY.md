# Security: Jimma City Smart Asset Management System

This document is for the security auditors (INSA / Hibir platform assessment) and for the people who run the system.
Part 1 lists the controls built into the application, mapped to the OWASP Top 10 (2021). Part 2 is what the
server and its operators must do; an audit tests the system as deployed, and several findings are only prevented
there. Part 3 lists what was tested and how to repeat the checks.

---

## Part 1. Controls in the application (OWASP Top 10, 2021)

### A01 Broken Access Control
- Every API route requires a signed-in user (`backend/src/middleware/auth.js`), except the sign-in, the
  translations and the public asset card a QR code opens (`/api/public`, which shows no money and no personal data).
- Role permissions are checked on the server for every action (`backend/src/lib/permissions.js`); the menus in the
  browser only hide what the server would refuse anyway.
- Area scope: every query for assets and their records is limited to the user's Kifle Ketema / Kebele / sector
  (`applyScope`). A record outside the user's area answers **404**, so its existence is not revealed (no IDOR).
- Account management: each level sees and manages only the accounts it creates; the Internal Auditor reads all, read-only.
- Separation of duties in the approval chain: the person who submits a registration cannot review or approve it.
- A disposed asset's record is locked; only a never-submitted draft can be deleted, by its registrar.
- CORS allows only the application's own origin (`FRONTEND_ORIGIN`).

### A02 Cryptographic Failures
- Passwords are stored as **bcrypt** hashes, cost 12 (`backend/src/lib/security.js`); never in clear, never returned.
- Sessions are signed JWTs (HS256) with a secret of at least 16 characters, required at start-up (`JWT_SECRET`).
- API keys for integrations are stored as SHA-256 hashes only.
- All API answers carry `Cache-Control: no-store`, so personal and financial data is not kept by browsers or proxies.
- Transport encryption (HTTPS) and HSTS: see Part 2. HSTS is switched on automatically when `PUBLIC_URL` is `https://`.

### A03 Injection
- All database access goes through Knex with bound parameters. The few raw SQL fragments only insert column or
  table names fixed in the code, never user input.
- Every request body and query is validated against a schema (zod) before use: types, lengths, allowed values, dates,
  money, names. Unknown fields are dropped (no mass assignment).
- Free-text search escapes `%` and `_` (`likePattern`), so a search cannot become a wildcard query.
- CSV export neutralises spreadsheet formulas (`=`, `+`, `-`, `@` at the start of a cell).
- Output: the React interface escapes all text; no HTML is built from user input. A strict Content Security Policy
  (no inline scripts, `object-src 'none'`, `frame-ancestors 'self'`) blocks script injection even if text slipped through.

### A04 Insecure Design
- Approval workflows (registration, transfer, disposal, ownership) need different people at each step.
- Rate limits per address: 600 API requests a minute, 20 sign-in attempts a minute, 120 public-card views a minute
  (configurable: `API_RATE_PER_MINUTE`, `LOGIN_RATE_PER_MINUTE`, `PUBLIC_RATE_PER_MINUTE`).
- Request bodies are limited to 1 MB; uploads to 10 MB and one file.

### A05 Security Misconfiguration
- Security headers on every answer (helmet): Content-Security-Policy, X-Content-Type-Options `nosniff`,
  X-Frame-Options `SAMEORIGIN`, Referrer-Policy `strict-origin-when-cross-origin`, Cross-Origin-Opener-Policy,
  Cross-Origin-Resource-Policy, and a Permissions-Policy that allows only the camera (QR scanner, photos) and the
  location (on-site checks) on this site.
- `X-Powered-By` is removed; error answers never contain stack traces, SQL or file paths (generic
  "Internal server error." with the detail written to the server log only).
- No directory listing; uploaded files are only reachable through an authenticated, scope-checked route.

### A06 Vulnerable and Outdated Components
- `npm audit` reports **0 known vulnerabilities** in the backend and the frontend (checked 2026-10-25, after updating
  zod and nodemailer). Re-run before every release: `npm audit --omit=dev` in `backend` and `frontend`.

### A07 Identification and Authentication Failures
- Password rule (server and forms): at least 8 characters with upper- and lower-case letters, a number and a symbol.
- **Account lockout**: 5 wrong passwords in a row lock the account for 15 minutes, from whatever address; the lock is
  recorded in the audit log. A name that does not exist gets the same answer after the same number of tries, and the
  same "Wrong username or password." message, so accounts cannot be discovered (no user enumeration).
- Sign-in takes the same time whether the user exists or not.
- Temporary passwords (new accounts, resets) are random, meet the password rule, and must be replaced at the first
  sign-in; until then the account can do nothing else. A temporary password **expires after 7 days**
  (`TEMP_PASSWORD_DAYS`); after that only a new one from the administrator opens the account.
- **Session end**: a session ends after 30 minutes without activity (`SESSION_IDLE_MINUTES`) on the server, and the
  screen signs itself out too; a session lasts at most 8 hours (`JWT_EXPIRES_IN`). **Sign out ends the session on the
  server**: the token stops working at once. Changing or resetting a password, deactivating an account or changing its
  role ends all of that user's sessions.
- The session token is kept in the browser's session storage (cleared when the browser closes), never in a URL.

### A08 Software and Data Integrity Failures
- Uploaded files are checked by **content** (their first bytes), not only by name and declared type: a script or web
  page renamed "deed.pdf" or "photo.png" is refused. Files are stored under random names and always downloaded as
  attachments.
- Dependencies are locked (`package-lock.json`).

### A09 Security Logging and Monitoring Failures
- Secrets are never written to the server log: when e-mail or SMS is not configured, the log notes only the recipient
  and the message length, never the message (an account message carries a temporary password).
- The audit log records sign-ins, failed sign-ins, account locks, sign-outs, every change to an asset, account,
  permission and setting, every approval decision, every document upload, download and removal, and every export, with
  the user, time and what changed. Only the Super Administrator and the Internal Auditor can read it.

### A10 Server-Side Request Forgery
- The server never fetches a URL given by a user. The only outgoing connections are to the configured e-mail/SMS
  services and, when it is switched on, the configured AI service.

### The AI assistant
- Off unless `AI_BASE_URL` and `AI_MODEL` are set (and `AI_API_KEY` for a cloud service). It works with any
  OpenAI-compatible chat API: Google Gemini, Groq, OpenRouter, or Ollama on the City's own server.
- **Read-only.** It has four lookups (find assets, count assets, one asset, my waiting work) and nothing that writes.
  Every lookup runs with the signed-in user's own permissions and area, through the same scoped queries as the screens,
  so it can never see more than the user; money is removed for roles without the financial permission.
- **Its instructions are the server's.** The browser may send only the user's and the assistant's own turns (at most
  12, each at most 2000 characters); a "system" message from the browser is refused. Text found in records is passed to
  the model as data, and the instructions tell it to ignore instructions inside data. Even a manipulated model can only
  call the read-only lookups above.
- 10 questions a minute per person (`AI_RATE_PER_MINUTE`); 45-second time limit per call to the AI service.
- The audit log notes each use and which lookups were made, not the question. The provider's error texts are not logged.
- **Privacy.** Questions and the lookup results for them are sent to the AI service. On free cloud tiers the provider
  may keep and use them. Use a paid tier with no data use, or a local model (Ollama), before real City data is used,
  and record the City's decision.

---

## Part 2. Deployment checklist (the server and its operators)

| # | Item | How |
|---|------|-----|
| 1 | **HTTPS only**, TLS 1.2 or 1.3, a valid certificate | Put the app behind nginx (or similar) with a certificate for the City's domain; redirect HTTP to HTTPS. Set `PUBLIC_URL=https://…` so HSTS is sent. |
| 2 | Strong secrets | `JWT_SECRET`: 64 random characters (`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`). Database password: long and random. Never commit `.env`. |
| 3 | Database least privilege | The app's MySQL user gets only SELECT, INSERT, UPDATE, DELETE (and CREATE/ALTER only while migrating) on its own database; MySQL listens on localhost only. |
| 4 | Firewall | Open only 443 (and 80 for the redirect). Port 4000 (Node) and 3306 (MySQL) must not be reachable from outside. |
| 5 | Run as a service account | Node runs as a dedicated, unprivileged user (systemd or pm2), restarted on failure. `NODE_ENV=production`. |
| 6 | Upload folder | Outside the web root, not executable, owned by the service account, on an encrypted disk. |
| 7 | Backups | `npm run backup` daily; copies kept off the server and encrypted; a restore tested every quarter. |
| 8 | Updates | OS security updates monthly; `npm audit` before every release. |
| 9 | Logs | Keep the server log (Node and nginx) at least 6 months; the audit log is kept in the database. |
| 10 | Default and test accounts | None in production: provision the real accounts, remove any test data, and make sure every temporary password has been replaced. |
| 11 | Remove development servers | Do not expose the Vite development server (port 5173) in production; serve the built `frontend/dist` through the Node server or nginx. |

Example nginx server block (adapt the names and paths):

```nginx
server {
    listen 443 ssl http2;
    server_name assets.jimma.gov.et;
    ssl_certificate     /etc/ssl/jimma/fullchain.pem;
    ssl_certificate_key /etc/ssl/jimma/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    server_tokens off;
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
server { listen 80; server_name assets.jimma.gov.et; return 301 https://$host$request_uri; }
```

When nginx runs on the same machine, the app already trusts its `X-Forwarded-For` (loopback only), so rate limits and
the audit log see each visitor's real address. On another machine, change `trust proxy` in `backend/src/app.js` to
that proxy's address.

---

## Part 3. Verification

- Automated tests (`npm test` in `backend`) cover access control by role and area, IDOR (404 outside the area),
  input validation, password rules, account lockout and its message, sign-out invalidation, idle timeout, security
  headers, upload content checks, CSV formula neutralisation and the approval separation of duties.
- Before the audit, run an automated scanner (for example OWASP ZAP baseline) against the HTTPS address, and
  `npm audit` in both folders.
- Report a vulnerability to the system owner (Jimma City Administration, ICT office); do not test against
  production data without written permission.
