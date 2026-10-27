# Jimma City Smart Asset Management System

One central register of everything Jimma City owns or controls, built from the 36-group feature checklist for a city-wide smart asset system. Rent management and the other revenue modules are built **on top of** this register later (see the parent folder's `README.md`).

Built with **Node.js (Express) + MySQL + React**. The web app is also installable on a phone and works offline for field data collection.

## What is built, by checklist group

| # | Group | Status | What you get |
|---|---|---|---|
| 1 | Asset registration | Built | Unique Asset ID (`AST-000125`), name, category, type, serial and registration number, specifications, photos and documents, acquisition, submit for approval before the asset becomes active |
| 2 | Classification | Built | Category → type, plus sector, department and function/use. Administrators add and change them; the structure grows without code changes |
| 3 | Location | Built | Jimma City → Kifle Ketema → Kebele → exact place/building, GPS coordinates, search by location, transfers with the old location kept. **See "Kebeles" below** |
| 4 | Ownership and responsibility | Built | Legal owner, responsible sector/department/office/officer, current holder: three separate things, each with history; ownership changes recorded with their legal basis |
| 5 | Condition | Built | Excellent → Critical, updated by inspections, every earlier value kept, damaged/critical lists |
| 6 | Status | Built | Planned, Registered, Active, Inactive, Under maintenance, Damaged, Lost, Transferred, Leased, Rented, Retired, Disposed; every change recorded with a reason |
| 7 | Lifecycle | Built | Acquire → register → approve → activate → assign → use → inspect → maintain → transfer → retire → dispose, with the full history on the asset page |
| 8 | Acquisition / procurement | Built | Method (purchase, allocation, donation, transfer, construction), procurement/contract/invoice references, supplier, approval, cost, date; an acquired asset enters the registration workflow in one step |
| 9 | Assignment / allocation | Built | To sector, department, office or employee, with date, reason, who is responsible; history; "who holds what now" view |
| 10 | Reservation | Built | Request, approve, conflict prevention (no double booking), availability view, history |
| 11 | Transfer | Built | Old and new location and department, reason, authoriser, documents, history; configurable approval |
| 12 | Maintenance | Built | Records, type/kind, cost, provider, status (planned → in progress → completed), next date, due-soon and overdue alerts, cost totals |
| 13 | Inspection | Built | Result (passed/failed), condition found, evidence photos, notes, updates the asset's condition; a failed inspection creates a follow-up action |
| 14 | Physical verification | Built | Verification campaigns snapshot "what the register says", officers confirm found/missing/wrong place/duplicate (usually by scanning), discrepancies are investigated, corrected with approval, history preserved, each campaign exported as CSV |
| 15 | Retirement and disposal | Built | Reason, method, date, value, buyer/recipient, documents, approval (two-step by default), locks the record |
| 16 | Financial | Built | Acquisition cost, valuation history, straight-line depreciation, maintenance and repair costs, rent/lease/other income recorded per asset, money figures in each area's monthly report; **hidden from roles without the financial permission**. Billing, receipts and arrears are the next phase |
| 17 | Documents and photos | Built | 12 document types, linked to the asset or to a specific maintenance/inspection/transfer/disposal, expiry dates with alerts, permission-checked downloads (logged), purchase/invoice/contract files hidden from people who cannot see money |
| 18 | QR code / barcode | Built | QR generated per asset, printable labels (QR + Code 128 barcode), scan with the phone camera, scan opens the asset, usable in inspection and verification, every scan logged with who and when. USB/Bluetooth barcode readers work by typing into the Scan box |
| 19 | GIS / map | Built | Map of assets coloured by condition, filter by sector, Kifle Ketema, Kebele, category, status, condition; click for details. Uses OpenStreetMap tiles (needs internet) |
| 20 | Users and hierarchy | Built | Users belong to sectors, departments, Kifle Ketemas, Kebeles; activate/deactivate; per-user history; e-mail and phone |
| 21 | Roles and permissions | Built | 8 roles (Super Administrator, Mayor/Executive, Kifle Ketema Administrator, Kebele Administrator, Sector Administrator, and the specialists Internal Auditor, Financial Officer, Inspector; see "Roles" below). **A Super Administrator can change what each role may do**; the assigned area limits what each user can see |
| 22 | Approval workflows | Built | Asset registration (draft → submitted → reviewed → approved → active) and configurable approval for transfer, disposal, retirement, assignment and ownership change (none / one approver / review then approve). Nobody approves their own request |
| 23 | Dashboard | Built | City-wide counts by status, condition, sector, category, Kifle Ketema, Kebele; financial and maintenance summary; pending approvals; verification discrepancies |
| 24 | Search and filtering | Built | By ID, name, serial, category, type, sector, department, Kifle Ketema, Kebele, status, condition, responsible person, location, ownership, any combination; CSV export |
| 25 | Monthly reports | Built | Reporting follows the chain of responsibility only: each level sends its monthly report to the level directly above (Sector → Kebele → Kifle Ketema → Mayor; Financial Officer and Inspector → Kifle Ketema; Internal Auditor → Mayor), which accepts it or returns it with a reason. The figures are prepared by the system and frozen when sent; Ethiopian or Gregorian months |
| 26 | Alerts and notifications | Built | 14 alert types (maintenance due/overdue, inspection due, expiring document, ending lease, pending approval, rejected request, critical condition, missing asset, verification discrepancy, transfer, disposal, reservation). Always in the system; e-mail and SMS when configured; rules configurable |
| 27 | History and audit trail | Built | Who did what and when, old and new values, insert-only, searchable, per-asset timeline |
| 28 | Security | Built | Hashed passwords, rate-limited sign-in, sessions that end when a password changes or an account is deactivated, role and area enforcement on every request, protected files, financial data restriction, API keys stored hashed |
| 29 | Data management | Built | Bulk CSV import (whole file checked first, nothing imported if any row is wrong), duplicate detection (on entry, in import, and a duplicate check for data cleaning), required-field and relationship validation, archive of disposed assets |
| 30 | Mobile | Built (web app) | Installable on a phone, camera QR scanning, GPS capture, photo upload, **offline recording of inspections and verification results that is sent when the connection returns**. Not a native app, and data is not browsable offline (see limits) |
| 31 | Analytics and decision support | Built (rule-based) | Decision indicators, sector and geographic comparison, trends, high-maintenance assets, lifecycle cost, replacement candidates, under-used assets, value analysis |
| 32 | API and integration | Built | Read-only REST API with per-system API keys and an OpenAPI description (assets, locations, sectors, categories; no financial figures) |
| 33 | System administration | Built | Users, roles, permissions, master data, approval workflows, notification rules, settings, system health, backups, API keys, audit log |
| 34 | Scalability and performance | Designed | Indexed queries, paging, no per-row queries in lists. **Not load-tested with a full city's data** |
| 35 | Backup and disaster recovery | Built | Database dump and file copy, on demand or daily (`AUTO_BACKUP=true`), read-back verification, restore script, health warnings when a backup is stale. Copying backups off-site is an operational step |
| 36 | AI / predictive / IoT | **Not built** | Only rule-based indicators (group 31). Prediction, computer vision, sensor and vehicle-GPS integration need a history of inspection/maintenance data and hardware decisions first |

### Kebeles

The 13 Kebele names supplied on 7 October 2026 are in the system: **Jiren, Ginjo, Ginjo Guduru, Mendera Kochi, Awetu Mendera, Bosa Addis Ketema, Bosa Kito, Hirmata Mentina, Mentina, Hirmata, Hirmata Merkato, Becho Bore, Seto Semero**.

Which of the 3 Kifle Ketemas (Hirmata, Jiren, Gibe) each Kebele belongs to has **not** been given, so the Kebeles are listed **without** a Kifle Ketema and marked "working label". Several names suggest a Kifle Ketema (for example the "Hirmata …" ones), but names are not proof, so nothing was guessed. Until each Kebele is linked (**Master data → Kebeles → Edit**), assets cannot be registered in it. Linking takes seconds and needs no code change.

## Languages: English, Amharic (አማርኛ), Afaan Oromo

Everyone can pick a language on the sign-in page or from the menu (bottom left). The choice is remembered on the account and on the device. What changes:

- the whole interface (menus, forms, buttons, messages, validation errors, tables), the numbers' labels and statuses, the master-list names (sectors, categories, Kifle Ketemas, the 13 Kebeles, asset types, roles);
- in-system notifications and most audit-trail and history entries are translated when shown (the rest of an entry, such as a status code inside a sentence, may still appear in English).

Data that people typed (asset names, locations, notes, supplier names) is never translated.

**Changing or correcting a translation.** The dictionaries are `backend/src/i18n/am.json` and `om.json`: each line is `"English text": "translation"`. Keep `{placeholders}` exactly as they are. Restart the server after editing. A text with no translation simply shows in English, so the system keeps working while translations are improved. `npm test` checks that no translation is empty and that placeholders match.

**Adding a new language.** Add it to `LANGUAGES` in `backend/src/i18n/index.js` and in `frontend/src/i18n.jsx`, add `xx.json`, and allow the code in `backend/src/routes/auth.js`.

**Please review the translations.** They were prepared by an AI assistant, and technical and legal terms (for example *ownership change*, *disposal*, *depreciation*, *separation of duties*) should be checked and, where the City has official terms, replaced. This matters most for Afaan Oromo and for anything that appears in official reports.

## Roles

The City uses **8 roles**: the 5 of the hierarchy, and 3 specialist roles beside it.

| Role | Does | Sees |
|---|---|---|
| Super Administrator | **Creates and manages the 3 Kifle Ketema Administrators, the Mayor / Executive accounts and the 3 specialist roles below**; oversees everything (assets, users, where each monthly report stands, approvals, audit log); master data, permissions, workflows, backups. Does **no day-to-day asset work** (no registering, editing or approving assets) | Whole city |
| Mayor / Executive | Read, analytics, money; **receives the monthly reports of the Kifle Ketema Administrators and the Internal Auditor**. **One active account for the City**: to replace the person, deactivate the old account, then create the new one | Whole city |
| Kifle Ketema Administrator | Oversees its Kebeles; **approves and activates** registered assets and decides requests (does not register); **creates and manages the Kebele Administrators of its Kifle Ketema**; sees (not changes) the Sector Administrators there; **follows the Inspectors of its Kifle Ketema** (their accounts, their inspections, overdue inspections, and alerts when one is overdue) | One Kifle Ketema |
| Kebele Administrator | Manages and monitors its Kebele; **verifies newly registered assets physically** (does not register); runs physical verification; reports missing, damaged, transferred or wrongly recorded assets; **creates and manages the Sector Administrators of its Kebele** | One Kebele |
| Sector Administrator | Manages one sector inside one Kebele: **registers assets**, keeps their records, requests transfers/maintenance/disposal, acts on follow-ups, reservations, analytics. Does not verify, approve or inspect (it owns the assets, so the Inspector inspects them) | One sector in one Kebele |
| Internal Auditor | Checks the records independently: read, analytics, money, **audit log**, the stock-taking (verification) results and every user account with its history, all read-only; sends its monthly report directly to the Mayor. Changes nothing. **One active account for the City**, replaced like the Mayor's | Whole city |
| Financial Officer | Money figures, **records valuations and income**; sends its monthly report to its Kifle Ketema Administrator | One or more Kifle Ketemas |
| Inspector | **The only role that records inspections** (technical condition), and records verification results. Followed by the Kifle Ketema Administrator | One or more Kifle Ketemas |

The Super Administrator creates the specialist accounts (*Users → Auditors, financial officers and inspectors*). There is one Internal Auditor; there can be several Financial Officers and Inspectors (the recommended start is 3 of each, one per Kifle Ketema). A Financial Officer or Inspector covers every Kebele in the Kifle Ketemas assigned to it. **Every Kifle Ketema needs at least one Inspector**, or nobody can record inspections there; the Super Administrator's and the Kifle Ketema Administrator's dashboards warn when one has none.

These are the defaults; a Super Administrator can change them (System → Roles and permissions). A user with no assigned area sees nothing.

### The standard accounts: 186 administrators and 8 specialists

```
SUPER ADMIN  ->  KIFLE KETEMA  ->  KEBELE  ->  SECTOR
```

| Accounts | Role | Scope | Username |
|---|---|---|---|
| 1 | Super Administrator | Entire Jimma City | `superadmin` |
| 3 | Kifle Ketema Administrator | one per Kifle Ketema (Hirmata, Jiren, Gibe) | `kifle.<name>` |
| 13 | Kebele Administrator | one per Kebele | `kebele.<name>` |
| 169 | Sector Administrator | one per Sector in each Kebele: **13 Kebeles × 13 sectors** | `sector.<code>.<kebele>` |

Total Sector Administrators = Kebeles × Sectors. It does not depend on how the Kebeles are shared between the Kifle Ketemas.

Beside the hierarchy, the same command creates the specialist accounts, so every one of the 8 roles has an account:

| Accounts | Role | Scope | Username |
|---|---|---|---|
| 1 | Mayor / Executive | Entire Jimma City | `mayor` |
| 1 | Internal Auditor | Entire Jimma City | `auditor` |
| 3 | Financial Officer | one per Kifle Ketema | `finance.<kifle ketema>` |
| 3 | Inspector | one per Kifle Ketema | `inspector.<kifle ketema>` |

That is 194 accounts on a new system. A Mayor or Internal Auditor is not created when the City already has an active one, and a Financial Officer or Inspector is not created for a Kifle Ketema that already has an active one.

**Which Kebele belongs to which Kifle Ketema is data, not code.** The Super Administrator sets it in *Master data → Kebeles → Edit*, following the official city structure. The Kifle Ketemas may have different numbers of Kebeles. Until a Kebele is assigned, no asset can be registered in it. Moving a Kebele to another Kifle Ketema moves its assets with it, and a Kebele that holds assets cannot be left without one.

**Registration chain.** The Sector Administrator registers an asset and submits it → the Kebele Administrator verifies that it physically exists at the recorded place (or sends it back) → the Kifle Ketema Administrator approves and activates it (or sends it back) → the asset is ACTIVE → the Super Administrator monitors city-wide. Nobody can take two steps on the same asset (separation of duties). Only the Sector Administrator can register; the Super Administrator oversees and changes no asset.

**Four dashboards.** Signing in shows the dashboard of your level, limited to your area: the Super Administrator's *city-wide control* (assets by Kifle Ketema/sector/Kebele, pending approvals, transfers and disposals, set-up gaps, governance shortcuts); the Kifle Ketema Administrator's *oversight and approval* (its Kebeles, what waits for its approval); the Kebele Administrator's *physical verification* (what waits for its check, discrepancies, the 13 sector areas); the Sector Administrator's *registration* (Register asset, drafts and returned assets, what is awaiting verification and approval, inspections due). Other roles see the general overview.

**Who creates whom.** Each level creates and manages only the level directly below it: the Super Administrator the 3 Kifle Ketema Administrators, a Kifle Ketema Administrator the Kebele Administrators of its own Kifle Ketema, a Kebele Administrator the Sector Administrators of its own Kebele. Each level sees only the accounts it creates (including those its predecessor in the post created); only the Internal Auditor sees every account, read-only. Sector Administrators have no user management. Beside the hierarchy, the Super Administrator also creates the Mayor / Executive, Internal Auditor, Financial Officer and Inspector accounts. Each area has exactly one administrator: a second Kebele Administrator for a Kebele, or a second Sector Administrator for the same sector in a Kebele, is refused until the first account is deactivated.

**Every asset** records its sector, Kifle Ketema, Kebele, category, ownership, responsible officer and department, current holder, location, condition and status, and an administrator sees, creates, changes, verifies, approves, transfers and reports only inside their own part of this tree.

Create all of these accounts with `npm run provision-admins` in `backend` (`-- --dry-run` lists them without creating anything). Each account gets a random temporary password, written to `backend/credentials/admin-accounts-<date>.csv` (a later run writes a new file next to it, never over it). **Hand each person their own row, then delete the file** (the folder is git-ignored). At first sign-in the person must choose a new password before anything else works; a password set by an administrator later, or typed when creating an account, is temporary in the same way. Running the command again creates only what is missing and never changes an existing password. If a Super Administrator already exists, no second one is created.

## Monthly reports (the reporting chain)

Creating accounts is the Super Administrator's job; **reporting** follows the line of responsibility. Everyone except the Mayor has a boss who receives their monthly report:

```
Mayor / Executive
 ├── Internal Auditor            (independent: reports directly to the Mayor, not to the areas it audits)
 └── Kifle Ketema Administrator
       ├── Kebele Administrator
       │     └── Sector Administrator
       ├── Financial Officer
       └── Inspector
```

| Who sends | To whom | Due (days after the month ends) |
|---|---|---|
| Sector Administrator | Kebele Administrator of its Kebele | 5 |
| Kebele Administrator, Financial Officer, Inspector | Kifle Ketema Administrator of their Kifle Ketema | 10 |
| Kifle Ketema Administrator, Internal Auditor | Mayor / Executive | 15 |

- **The system prepares the figures** of the person's area (where the assets stand, what happened during the month, the money for those who may see it, an Inspector's own inspections, the Auditor's view of the audit trail, and for a boss how many of the team's reports came in). The person adds comments, ticks "I confirm" and sends. The figures are frozen when the report is sent.
- **The boss accepts the report or returns it** with a reason; a returned report is corrected and sent again (version 2, 3 ...). An accepted report is locked. Each report is seen only by its sender and the person it is sent to. The Mayor sees the Kifle Ketema reports, not each sector's. The Super Administrator follows where every report stands (sent, late, accepted, returned) but can neither open one nor decide.
- **A boss may send before the whole team has**, but must then explain in the comments what is missing; the report lists who has not sent.
- **Reminders**: three days before a deadline, then "late" to the person and to their boss. Both appear in the notifications and, when configured, by e-mail or SMS (System → Notification rules).
- **Calendar**: months follow the **Ethiopian calendar** by default (Super Administrator: System → Settings → *Calendar of the monthly reports*; Gregorian is the other choice). In Amharic and Afaan Oromo every month, deadline and date is shown **in both calendars**; in English it is shown in the Gregorian calendar (an Ethiopian reporting month by its dates, for example *June 8 – July 7, 2026*). Pagume is too short to report on alone, so the report of Nehase covers Nehase and Pagume.

## Design decisions (from the project documents)

- **One register, not 13 systems.** The 13 sectors are classifications inside one platform. Sector modules (Rent first) are added later on the same register.
- **Asset, use and revenue classification are separate.** Revenue is recorded on a *use*, not on the asset. An ambulance or an office needs no revenue source.
- **Separation of duties.** The person who asked cannot approve; for two-step approvals the reviewer cannot also give the final approval; the person who recorded a verification finding cannot approve its correction. (Turn off with `SEPARATION_OF_DUTIES=false` only for a one-person pilot.)
- **Nothing is silently overwritten.** Transfers, assignments, ownership changes, valuations, conditions and status changes keep what came before.
- **Working labels are marked.** Sectors, Kifle Ketemas, Kebeles and categories show "Working label" until the City confirms them.

## Run it

Requirements: Node.js 20+, MySQL 8 (or MariaDB 10.6+).

```bash
npm run setup                       # install backend and frontend dependencies

# 1. Create a database and user in MySQL (names are up to you):
#      CREATE DATABASE jimma_ams CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
#      CREATE USER 'jimma_ams'@'localhost' IDENTIFIED BY '<password>';
#      GRANT ALL ON jimma_ams.* TO 'jimma_ams'@'localhost';
# 2. Copy backend/.env.example to backend/.env and fill in the DB password and a long random JWT_SECRET.

npm run migrate                     # create / update the tables (safe to run again after an upgrade)
npm run seed                        # Kifle Ketemas, 13 Kebeles, 13 working sectors, categories, default workflows and alert rules
npm --prefix backend run create-admin -- admin "Your Name"   # first Super Administrator (password printed once)
npm --prefix backend run reset-password -- admin            # a forgotten password: a temporary one is printed once

npm run build                       # build the React app
npm start                           # http://localhost:4000  (API and UI together)
```

**Upgrading from the first version:** `npm run migrate` then `npm run seed`. Existing data is kept. The new tables are added and the 13 Kebeles are listed.

**Development mode** (hot reload): `npm run dev:api` in one terminal and `npm run dev:ui` in another, then open http://localhost:5173.

### Phones, camera and offline

- The camera (QR scanning) and "use my location" only work on **HTTPS** pages (or `localhost`). Put the system behind HTTPS before field use.
- Set `PUBLIC_URL` (in `backend/.env`) so a printed QR code opens the asset when scanned with an ordinary phone camera. Without it the QR code holds just the Asset ID and is read by the in-app scanner.
- In the phone browser choose "Install app" / "Add to home screen".
- Inspections and verification results recorded with no connection are saved on the phone and sent automatically when it is back online. A banner shows what is waiting. Searching and reading records needs a connection.

### E-mail and SMS

Set `SMTP_HOST` (and `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) for e-mail. For SMS, point `SMS_GATEWAY_URL` at any HTTP gateway that accepts `{"to": "...", "message": "..."}`. Without these, notifications still appear in the system. Users need an e-mail address or phone number in their profile.

### AI assistant

A chat button at the bottom right of every page answers "how do I ..." questions and looks things up in the register
("What is waiting for me?", "How many vehicles in Jiren are in poor condition?", "Show AST-000125"). It can only read,
and only what the signed-in person could already see; it never changes anything. It answers in the person's language.

Switch it on in `backend/.env` with any OpenAI-compatible service, then restart the server:

```
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai   # Google Gemini, free key: https://aistudio.google.com/apikey
AI_API_KEY=<your key>
AI_MODEL=gemini-3.5-flash
```

Groq (free) and Ollama on the City's own server (no key, data stays in Jimma) are in `.env.example`. On free cloud tiers
the provider may keep what is sent: get the City's agreement before real data is used. Details: `docs/SECURITY.md`.

### Backups

```bash
npm --prefix backend run backup                # database + uploaded files into backend/backups (or BACKUP_DIR)
npm --prefix backend run restore -- <db-backup.sql.gz> --yes
```

Set `AUTO_BACKUP=true` for a daily backup while the server runs, and `MYSQLDUMP_PATH` if `mysqldump` is not on the PATH. System → Backups shows the history and checks that each backup reads back correctly. **Copy the backup folder to another disk or site**: a backup on the same machine does not protect against losing the machine. Restore from a backup at least once a year to prove it works.

## Tests

```bash
npm test      # 265 API tests in 16 files against a separate database (jimma_ams_test)
```

Create the test database once (`CREATE DATABASE jimma_ams_test …`, grant the same user) and set `DB_NAME_TEST` in `.env`. The test runner refuses to wipe any database other than `DB_NAME_TEST`, and tests never reach a real SMS gateway, mail server or AI service whatever `.env` holds (`backend/test/env.js`, which every test file imports first).

The tests cover sign-in, who can see and change what, the approval workflows and separation of duties, acquisition and duplicates, assignment and ownership history, reservations and conflicts, verification (found / wrong place / missing / corrected), alerts and notifications (including e-mail and SMS), QR codes and scanning, the map data, bulk import, monthly reports up the chain, analytics, depreciation, backups, API keys, session ending, financial privacy, documents, the audit log and injection attempts.

## Project layout

```
backend/    Express API, knex migrations (001, 002), scripts, tests
  src/routes/      assets, assetOps (acquisition, assignment, QR, import ...), requests, reservations, verification,
                   notifications, analytics, dashboard, monthly-reports, admin, integration, users, master, audit, auth
  src/lib/         permissions, requests (approval engine), notify / alerts / channels, backup, depreciation, schemas
frontend/   React (Vite) web app and service worker
```

## Security notes

- Passwords are hashed (bcrypt). Sign-in is rate-limited per username and address. Tokens last 8 hours, are kept in `sessionStorage`, and stop working the moment the password changes, the role changes or the account is deactivated.
- Every request re-reads the user from the database, so changes to a role or to its permissions take effect immediately.
- Assets outside a user's area return **404**, not 403, so their existence is not revealed.
- Financial figures, purchase/invoice/contract documents and the money figures in monthly reports are limited to roles with the financial permission.
- Uploads: allow-listed types only (no HTML or SVG), 10 MB limit, random file names, `nosniff`, download as attachment only, every download logged.
- API keys are shown once and stored only as a hash; the integration API is read-only and never returns money figures.
- CSV exports neutralise spreadsheet formulas.
- For production: serve over HTTPS, set `FRONTEND_ORIGIN` if the UI is on another origin, keep `.env` out of version control, store the backups off the server, and encrypt the server disk (data at rest is not encrypted by the application).

## Limits and not built yet (by design)

- **AI, predictive maintenance, computer vision, IoT/sensor and vehicle-GPS integration, digital twin** (group 36): not built. The analytics page uses transparent rules, not prediction.
- **Rent management, billing, receipts, arrears and other revenue sector modules**: the next phase, built on this register. Income can already be recorded against an asset.
- **Offline reading**: only recording is offline. The register cannot be browsed without a connection.
- **Statuses and conditions are fixed lists** (the rules depend on them), not administrator-editable. Categories, types, sectors, departments, Kifle Ketemas and Kebeles are editable.
- **Ethiopian calendar**: dates are shown in the Gregorian calendar (the interface itself is available in English, Amharic and Afaan Oromo).
- **Translations need review by native speakers.** They were prepared by an AI assistant, not by professional translators: have the City's language staff read them before official use (see "Languages").
- **E-mail and SMS notification text** is sent in English; the in-system notifications follow the user's language.
- **Load testing**: not done with a city's full volume of assets, photos and history.
- **Two-step sign-in (MFA)**, single sign-on with another City system, and a native mobile app: not built.

## Needs confirmation from Jimma City

Which Kifle Ketema each of the 13 Kebeles belongs to; the official Kebele spellings; the official asset categories; the official revenue classifications (and the meaning of "Assura / Kote"); which assets may be rented or leased; who approves rental contracts; default useful lives for depreciation; the legal audit-trail retention period; who in each office holds each role. See the parent folder's `README.md`.
# jimma-asset-management-sytem
