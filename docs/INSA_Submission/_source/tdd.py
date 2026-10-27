from common import *

CODE = "JCSAMS-TDD-003"
TITLE = "Technical Design and Specification"


def api(group, rows):
    data = [["Method", "Path", "Who may call it", "Purpose"]]
    for m, p, who, what in rows:
        data.append([f"<font name='Mono' size='8'>{m}</font>", f"<font name='Mono' size='8'>{p}</font>", who, what])
    return [P(group, "h3")] + table(data, [1.5, 5.3, 4.0, 5.8])


def story():
    s = []
    s += cover(CODE, TITLE, "Technology, code structure, API, database, configuration and build",
               "This document gives the technical detail behind the design: the technology used and why, how the code is organised, "
               "every API endpoint, the database tables, the validation and error rules, the configuration settings, and how the "
               "system is built, tested and installed. It is meant for the assessment team and for the engineers who will maintain the system.")
    s += document_control(
        [["0.3", "10 October 2026", AUTHOR, "Stack, structure and database sections."],
         ["0.7", "20 October 2026", AUTHOR, "API reference completed; validation and error model."],
         ["1.0", DATE, AUTHOR, "Issued for the INSA assessment; matches migration 020, the AI assistant and the 265-test suite."]],
        related=RELATED)
    s += toc()

    # 1 ----------------------------------------------------------------
    s += H1("Introduction")
    s += H2("Purpose and audience")
    s.append(P("The System and Architecture Design Document (JCSAMS-SDD-002) explains how the system is put together. This document "
               "goes one level down. It lists the actual endpoints, tables, settings and commands, so that a tester can find every "
               "entry point and a maintainer can find every moving part. Where a value is configurable, the default is given."))
    s += H2("Conventions")
    s += bullets([
        "Paths in <font name='Mono'>monospace</font> are relative to the project root unless they start with <font name='Mono'>/api</font>, in which case they are URL paths.",
        "<font name='Mono'>:id</font> in a path is a numeric record identifier; <font name='Mono'>:token</font> is an asset's public token.",
        "\"Signed in\" means a valid session token in the <font name='Mono'>Authorization: Bearer</font> header. \"In area\" means the record must be inside the caller's assigned area, otherwise the answer is 404.",
    ])

    # 2 ----------------------------------------------------------------
    s += H1("Technology stack")
    s += table([["Layer", "Technology", "Version", "Why it was chosen"],
                ["Runtime", "Node.js", "20 LTS or later (tested on 20 and 26)", "One language (JavaScript) for client and server; long-term support releases; small footprint on one server."],
                ["Web framework", "Express", "5.2", "Mature and widely understood; Express 5 forwards errors from async handlers to the error handler, which removes a common class of unhandled-error bugs."],
                ["Database", "MySQL / MariaDB", "8.0+ / 10.6+", "Already known to the City's ICT staff; transactional (InnoDB); supports CHECK constraints and utf8mb4 for Amharic and Afaan Oromo text."],
                ["Query builder", "Knex", "3.3", "Bound parameters everywhere; schema migrations in version-controlled files."],
                ["Validation", "zod", "4.6", "Declarative schemas with per-field error messages; unknown fields are dropped."],
                ["Security headers", "helmet", "8.3", "Standard, maintained set of HTTP security headers including CSP."],
                ["Tokens", "jsonwebtoken", "9.0", "HS256 session tokens; no server-side session store needed."],
                ["Passwords", "bcryptjs", "3.0", "bcrypt in pure JavaScript; no native build on the server."],
                ["Uploads", "multer", "2.4", "Size and count limits enforced while streaming to disk."],
                ["Client", "React + React Router", "19.3 / 7.18", "Component model suited to the many forms; client-side routing for a fast single-page application."],
                ["Build", "Vite", "current", "Fast production build with hashed file names; no inline scripts (compatible with the strict CSP)."],
                ["Maps, QR, barcodes", "Leaflet; html5-qrcode; qrcode; JsBarcode", "1.9; 2.3; 1.5; 3.12", "Open-source, no paid service keys."],
                ["Testing", "node:test (built into Node.js)", "-", "No extra test framework to maintain; runs the real API against a real test database."]],
               [2.6, 3.2, 2.8, 8.0])

    # 3 ----------------------------------------------------------------
    s += H1("Source code organisation")
    s.append(code("""jimma-asset-management-system/
  package.json               root scripts: setup, migrate, seed, build, start, test
  backend/
    src/
      server.js              starts the HTTP server and the scheduler
      app.js                 middleware order, route mounting, static files
      config.js              reads and checks environment settings at start-up
      db.js                  Knex connection pool
      middleware/            auth.js (session check), errors.js (error model)
      routes/                18 route modules (one per functional area)
      lib/                   30 domain modules (rules shared by routes)
      migrations/            001 ... 020, applied in order
      scripts/               migrate, seed, create-admin, reset-password,
                             provision-admins, backup, restore
      i18n/                  am.json, om.json (translations), index.js
    test/                    16 test files, helpers.js, env.js
    .env.example             every setting with its default
  frontend/
    public/                  sw.js (service worker), manifest, icons, images
    src/
      main.jsx, App.jsx      start-up, routing, menus per role, layout
      api.js                 the only place that calls the server
      auth.jsx               session state, idle sign-out
      offline.js             outbox for field results
      i18n.jsx               language switching and translation lookup
      components/            shared UI: forms, tables, dialogs, charts, scanner
      pages/                 30 pages (dashboards, assets, approvals, ...)
  docs/                      SECURITY.md and this submission"""))
    s += H2("Backend modules")
    s += table([["Module (backend/src/lib)", "Responsibility"],
                ["permissions.js", "Loads role permissions from the database (cached, invalidated on change), resolves each user's area, decides which account roles a user manages."],
                ["assetGuards.js", "<font name='Mono'>guardAsset</font> middleware: loads an asset only if it is in the caller's area and the caller has the permission; refuses changes to disposed assets."],
                ["assetQuery.js", "Builds the scoped, filtered, paged asset query used by the list, export, map and dashboards."],
                ["schemas.js, assetSchemas.js", "All input rules: names, phones, e-mail, passwords, money, dates, coordinates, enumerations, asset fields."],
                ["requests.js, workflow.js", "The approval engine for transfers, disposals, retirements, assignments and ownership changes; one- or two-step workflows; separation of duties."],
                ["money.js, depreciation.js", "Recording valuations and income with their checks; straight-line depreciation."],
                ["monthlyReports.js, calendar.js", "Who reports to whom, preparing and freezing figures, deadlines, Ethiopian calendar conversion."],
                ["alerts.js, notify.js, channels.js", "Finding due and overdue items, creating notifications without duplicates, sending e-mail and SMS."],
                ["audit.js", "Writing audit entries with old and new values."],
                ["security.js", "Rate limiter, no-store header, bcrypt cost, lockout and idle values, temporary password generation and expiry, file signature checks."],
                ["publicAsset.js", "Public token creation and lookup; the fields allowed on the public card; retired labels."],
                ["backup.js, scheduler.js", "Database dump and file copy, verification, restore support; hourly job runner."],
                ["provision.js", "Creating the standard set of 194 accounts with temporary passwords."],
                ["assistant.js, assistantGuide.js", "The AI assistant: connection to the configured OpenAI-compatible service, the four read-only lookups (search_assets, count_assets, get_asset, my_work) run with the user's scope, the server-side instructions and the built-in guide; one automatic retry when the service is overloaded (503); answers reduced to plain text."],
                ["inspections.js, siteCheck.js, sectorFields.js, photos.js, csv.js, constants.js, jimma.js", "Inspection rules, on-site checks, sector-specific fields, image handling, safe CSV writing, enumerations, Jimma City boundary."]],
               [5.4, 11.2])

    # 4 ----------------------------------------------------------------
    s += H1("Request handling")
    s += H2("Middleware order")
    s.append(P("The order in <font name='Mono'>backend/src/app.js</font> matters for security; it is listed here exactly as built."))
    s += numbered([
        "<font name='Mono'>trust proxy = loopback</font>: the client address is taken from X-Forwarded-For only when the request comes from a proxy on the same machine.",
        "<font name='Mono'>x-powered-by</font> disabled.",
        "helmet with a custom Content Security Policy (section 4.2) and HSTS when <font name='Mono'>PUBLIC_URL</font> starts with https.",
        "Permissions-Policy header: camera and geolocation for this site only; microphone, payment, USB, serial and Bluetooth off.",
        "CORS: only <font name='Mono'>FRONTEND_ORIGIN</font> may call the API from a browser.",
        "JSON body parser limited to 1 MB.",
        "For <font name='Mono'>/api</font>: Cache-Control no-store, then a rate limit of 600 requests per minute per address.",
        "For <font name='Mono'>/api/auth/login</font>: 20 per minute per address. For <font name='Mono'>/api/public</font>: 120 per minute per address.",
        "Public endpoints: health, enumerations, translations.",
        "Route modules. Each module applies <font name='Mono'>authenticate</font> (except the public card) and then its permission and area checks.",
        "404 for any other <font name='Mono'>/api</font> path; static files and the single-page application for everything else.",
        "Error handler (section 7).",
    ])
    s += H2("Security headers as sent")
    s += table([["Header", "Value"],
                ["Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https: 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com; connect-src 'self'; font-src 'self' https: data:; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; script-src-attr 'none'; upgrade-insecure-requests (HTTPS only)"],
                ["Strict-Transport-Security", "max-age=31536000; includeSubDomains (only when PUBLIC_URL is https)"],
                ["X-Content-Type-Options", "nosniff"],
                ["X-Frame-Options", "SAMEORIGIN"],
                ["Referrer-Policy", "strict-origin-when-cross-origin"],
                ["Cross-Origin-Opener-Policy / -Resource-Policy", "same-origin / same-origin"],
                ["Permissions-Policy", "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()"],
                ["Cache-Control (API)", "no-store; Pragma: no-cache"]],
               [4.6, 12.0])
    s += H2("Authentication")
    s.append(P("A session token is a JWT signed with HS256 using <font name='Mono'>JWT_SECRET</font> (at least 16 characters, refused at "
               "start-up otherwise; 48 random bytes recommended). It carries only the user id (<font name='Mono'>sub</font>), the "
               "token version (<font name='Mono'>tv</font>) and the expiry (8 hours by default). On every request the server:"))
    s += numbered([
        "verifies the signature and expiry;",
        "loads the user; refuses if the account is inactive;",
        "compares the token version with <font name='Mono'>users.token_version</font>; sign-out, password change, role change, deactivation and \"end sessions\" all increase it;",
        "refuses if <font name='Mono'>users.last_seen_at</font> is more than <font name='Mono'>SESSION_IDLE_MINUTES</font> (30) ago, otherwise updates it at most once a minute;",
        "loads the user's area and the role's permissions;",
        "refuses everything outside <font name='Mono'>/api/auth/</font> while the user must still replace a temporary password.",
    ])
    s.append(P("Sign-in counts failures in <font name='Mono'>users.failed_logins</font>; at 5 the account gets "
               "<font name='Mono'>locked_until</font> = now + 15 minutes. Unknown usernames are counted in memory with the same limits, "
               "and a dummy bcrypt comparison keeps the response time the same, so the two cases cannot be told apart."))

    # 5 ----------------------------------------------------------------
    s += H1("API reference")
    s.append(P("All endpoints are under <font name='Mono'>/api</font> and exchange JSON unless stated otherwise. The route modules contain 130 handlers and "
               "<font name='Mono'>app.js</font> adds 4 public ones; all are listed below, grouped by area. \"In area\" applies to every endpoint that takes an asset or user identifier."))
    s += api("Public (no sign-in)", [
        ("GET", "/api/health", "Anyone", "Liveness check: {ok: true}."),
        ("GET", "/api/enums", "Anyone", "Allowed values for statuses, conditions, roles and other lists."),
        ("GET", "/api/i18n, /api/i18n/:lang", "Anyone", "Available languages; one language's dictionary."),
        ("GET", "/api/public/assets/:token", "Anyone (120/min)", "Public asset card. 404 unknown, 410 label replaced."),
        ("GET", "/api/public/assets/:token/photos/:id", "Anyone (120/min)", "A photo of that asset only."),
    ])
    s += api("Authentication (/api/auth)", [
        ("POST", "/login", "Anyone (20/min)", "Sign in; returns token and user."),
        ("GET", "/me", "Signed in", "Current user, permissions and area."),
        ("POST", "/logout", "Signed in", "Ends the session on the server."),
        ("POST", "/change-password", "Signed in", "Requires the current password; ends other sessions."),
        ("POST", "/language", "Signed in", "Saves the interface language."),
        ("PUT / DELETE", "/photo", "Signed in", "Sets or removes one's own profile photo."),
        ("GET", "/photo/:id", "Signed in, may see that user", "A user's profile photo."),
    ])
    s += api("Assets (/api/assets)", [
        ("GET", "/", "Signed in", "Scoped, filtered, paged list."),
        ("GET", "/export.csv", "asset.export", "The same list as CSV (formula-safe)."),
        ("POST", "/", "asset.create", "Register an asset (Sector Administrator, own sector and Kebele)."),
        ("GET", "/:id", "In area", "Full record; money fields only with financial.view."),
        ("PATCH", "/:id", "asset.edit, in area", "Change details; not when disposed."),
        ("DELETE", "/:id", "Creator, draft only", "Delete a never-submitted draft."),
        ("POST", "/:id/workflow", "Per step", "Submit, verify (asset.review), approve (asset.approve), return."),
        ("POST", "/:id/status", "asset.edit, in area", "Change status with a reason."),
        ("POST", "/:id/utilizations, /:id/utilizations/:uid/end", "asset.edit", "Record or end a use of the asset."),
        ("POST / PATCH", "/:id/maintenance, /:id/maintenance/:mid", "maintenance.record", "Record and update maintenance."),
        ("POST", "/:id/inspections", "inspection.record", "Record an inspection (Inspectors)."),
        ("POST", "/:id/follow-ups, /:id/follow-ups/:fid/close, /reopen", "Per rule", "Follow-up actions after failed inspections."),
        ("POST", "/:id/transfers", "request.create", "Raise a transfer request."),
        ("POST", "/:id/valuations", "financial.edit", "Record a valuation."),
        ("POST", "/:id/documents", "asset.edit", "Upload a document or photo (multipart, 10 MB)."),
        ("GET", "/:id/documents/:did/download", "In area; money documents need financial.view", "Download as attachment; logged."),
        ("PATCH / DELETE", "/:id/documents/:did", "asset.edit", "Change or remove a document; logged."),
        ("GET", "/:id/photo", "In area", "The asset's main photo."),
    ])
    s += api("Asset operations (/api/assets)", [
        ("GET", "/map", "Signed in", "Assets with coordinates for the map, scoped."),
        ("GET", "/:id/qr.svg, /:id/qr.png", "In area", "QR code image for the label."),
        ("POST", "/:id/label/replace", "asset.edit", "Replace a lost or damaged label; the old token stops working."),
        ("POST", "/scan", "Signed in", "Resolve a scanned code to an asset in area; logs the scan."),
        ("GET", "/:id/scans", "In area", "Scan history."),
        ("PUT", "/:id/acquisition", "asset.edit", "Acquisition and procurement details."),
        ("POST", "/:id/assignments, /:id/ownership-change, /:id/disposal", "request.create", "Raise the corresponding request."),
        ("GET", "/assignments/current", "Signed in", "Who holds what now, scoped."),
        ("POST", "/:id/revenues", "financial.edit", "Record income."),
        ("POST", "/:id/archive, /:id/unarchive", "asset.edit", "Archive a disposed asset or bring it back to the list."),
        ("GET", "/follow-ups/open", "Signed in", "Open follow-up actions, scoped."),
        ("GET", "/duplicates/scan", "asset.export", "Probable duplicate records."),
        ("GET / POST", "/import/template.csv, /import", "import.run", "CSV template; bulk import (all rows checked first)."),
    ])
    s += api("Requests and reservations", [
        ("GET", "/api/requests", "Signed in", "Requests in area, filtered by status and type."),
        ("POST", "/api/requests/:id/review", "request.review", "First step (Kebele)."),
        ("POST", "/api/requests/:id/approve, /reject", "request.decide", "Final decision (Kifle Ketema)."),
        ("POST", "/api/requests/:id/cancel", "Requester", "Withdraw a pending request."),
        ("GET", "/api/reservations, /availability", "Signed in", "Reservations; free periods for an asset."),
        ("POST", "/api/reservations", "reservation.request", "Request a reservation; overlap refused."),
        ("POST", "/api/reservations/:id/approve, /reject, /cancel", "reservation.decide / requester", "Decide or withdraw."),
    ])
    s += api("Physical verification (/api/verification)", [
        ("GET / POST", "/", "Signed in / verification.manage", "List campaigns; open a campaign for one's area."),
        ("GET", "/:id", "In area", "Campaign with items and results."),
        ("POST", "/:id/record", "verification.record", "Record Found / Missing / Wrong location / Duplicate."),
        ("POST", "/items/:itemId/resolve", "verification.manage", "Correct or dismiss a discrepancy (not by the person who found it)."),
        ("POST", "/:id/close", "verification.manage", "Close the campaign."),
        ("GET", "/:id/report.csv", "In area", "Expected versus found, as CSV."),
    ])
    s += api("Finance, analytics, dashboard", [
        ("GET", "/api/finance/overview, /valuations, /revenues, /backlog, /assets-search", "financial.view", "Money views, scoped."),
        ("POST", "/api/finance/valuations, /revenues", "financial.edit", "Record from the finance page."),
        ("GET", "/api/analytics", "analytics.view", "Rule-based indicators, scoped."),
        ("GET", "/api/dashboard, /queue, /inspectors, /performance", "Signed in (per role)", "Dashboard figures, work queue, Inspector follow-up, performance by area."),
    ])
    s += api("Monthly reports (/api/monthly-reports)", [
        ("GET", "/, /reminder, /team", "Signed in", "Own reports; current reminder; team status for a superior."),
        ("GET", "/preview/:periodKey", "Signed in", "Figures the system would freeze."),
        ("POST", "/:periodKey/submit", "Signed in, has a superior", "Send the report (freezes the figures)."),
        ("GET", "/report/:id", "Sender or receiver", "One report."),
        ("POST", "/report/:id/accept, /return", "Receiver", "Decide; return needs a reason."),
    ])
    s += api("Notifications (/api/notifications)", [
        ("GET", "/, /count", "Signed in", "Own notifications; unread count."),
        ("POST", "/:id/read, /read-all", "Signed in", "Mark own notifications read."),
        ("GET / PUT", "/rules, /rules/:type", "system.manage", "Notification rules."),
        ("POST", "/run", "system.manage", "Run the alert job now."),
    ])
    s += api("Users (/api/users)", [
        ("GET", "/", "Account managers; Internal Auditor", "Only accounts the caller manages (all, read-only, for the Auditor)."),
        ("POST", "/", "user.manage*", "Create an account of the role the caller manages; returns the temporary password once."),
        ("GET / PATCH", "/:id", "Manager of that account", "Read or change (role, area, active, reset password)."),
        ("GET", "/:id/history", "Manager; Internal Auditor", "Account history."),
        ("POST", "/:id/end-sessions", "Manager of that account", "End all sessions of that user."),
        ("PUT / DELETE", "/:id/photo", "Manager of that account", "Set or remove that user's photo."),
    ])
    s += api("AI assistant (/api/assistant)", [
        ("GET", "/status", "Signed in", "Whether the assistant is switched on."),
        ("POST", "/chat", "Signed in (10/min per person)", "{messages: [{role: user|assistant, content}]}, at most 12 turns of 2000 characters; returns {answer}. Read-only lookups in the caller's area."),
    ])
    s += api("Master data, administration, audit, integration", [
        ("GET", "/api/master/lookups, /api/master/:resource", "Signed in", "Lists for forms (Kifle Ketemas, Kebeles, sectors, ...)."),
        ("POST / PATCH", "/api/master/:resource, /:resource/:id", "master.manage", "Add or change master data."),
        ("GET", "/api/admin/health", "system.manage", "Database, disk, last backup, configuration warnings."),
        ("GET / PUT", "/api/admin/workflows, /permissions/:role, /settings", "system.manage", "Workflows, role permissions, settings."),
        ("GET / POST", "/api/admin/backups, /backups/:id/verify", "system.manage", "Backup history, new backup, verify."),
        ("GET / POST", "/api/admin/api-keys, /api-keys/:id/disable", "system.manage", "Create (key shown once) and disable API keys."),
        ("GET", "/api/audit", "audit.view", "Audit log, searchable."),
        ("GET", "/api/integration/v1/openapi.json, /assets, /assets/:code, /locations, /sectors, /categories", "X-API-Key", "Read-only data for City systems; no money."),
    ])
    s += H2("Response format")
    s.append(P("A successful call returns the resource or a list object. A list returns <font name='Mono'>{rows, total, page, page_size}</font>. "
               "Errors always have the shape below; <font name='Mono'>details</font> is present only for field errors."))
    s.append(code('{\n  "error": "Please correct the highlighted fields.",\n  "details": { "phone": "Enter a valid phone number (e.g. +251 911 223 344 or 0911 223 344)." }\n}'))

    # 6 ----------------------------------------------------------------
    s += H1("Database")
    s += H2("General rules")
    s += bullets([
        "Engine InnoDB, character set utf8mb4, collation utf8mb4_unicode_ci (Amharic and Afaan Oromo text).",
        "Every table has an auto-increment primary key <font name='Mono'>id</font> except pure link tables and settings.",
        "Foreign keys are declared for every reference. Unique keys: <font name='Mono'>assets.asset_code</font>, <font name='Mono'>assets.public_token</font>, <font name='Mono'>users.username</font>, <font name='Mono'>api_keys.key_hash</font>, master data names within their parent.",
        "CHECK constraints (migration 012) keep money non-negative, coordinates inside valid ranges, dates in order and quantities positive.",
        "Times are stored in UTC and shown in the user's time zone (East Africa Time).",
    ])
    s += H2("Tables")
    s += table([["Table", "Purpose", "Key columns"],
                ["users", "Accounts", "username (UK), first/father/grandfather name, role, is_active, password_hash, must_change_password, temp_password_expires_at, token_version, failed_logins, locked_until, last_seen_at, phone, email, language, photo"],
                ["user_kifle_ketemas, user_kebeles, user_sectors", "A user's area", "user_id, kifle_ketema_id / kebele_id / sector_id"],
                ["role_permissions", "Changes to the default permissions", "role, permission, allowed"],
                ["kifle_ketemas, kebeles, sectors, departments, asset_categories, asset_types", "Master data", "name, parent reference, working-label flag"],
                ["assets", "The register", "asset_code (UK), name, category/type, sector/department, kifle_ketema/kebele, location_detail, latitude, longitude, ownership, responsible_officer, current_holder, condition, status, approval_state, acquisition_date, acquisition_cost, current_valuation, useful_life_years, salvage_value, public_token (UK), details (JSON, sector fields), created_by, submitted_by, reviewed_by, approved_by, disposed_at, archived_at"],
                ["utilizations", "How an asset is used", "use_type, user_party, start/end, generates_revenue"],
                ["maintenance_records", "Maintenance", "date, kind, cost, provider, status, next date"],
                ["inspection_records", "Inspections", "date, result, condition_found, next date, recorded_by"],
                ["follow_up_actions", "Actions after failed inspections", "description, due_date, status, resolution"],
                ["asset_transfers, asset_assignments, asset_ownership_history", "Movement and responsibility history", "from/to, dates, reason, authorised_by, basis"],
                ["asset_acquisitions, asset_disposals", "Start and end of life", "method, references, supplier, value, recipient"],
                ["asset_valuations, asset_revenues", "Money", "value / amount, dates, method, payer, reference"],
                ["asset_reservations", "Bookings", "requester, start_at, end_at, status"],
                ["asset_documents", "Files", "doc_type, title, original_name, stored_name (random), mime_type, size_bytes, related record"],
                ["asset_site_checks", "On-site confirmation during registration", "result, latitude, longitude, photo, checked_by"],
                ["approval_requests, workflow_configs", "Requests and their rules", "request_type, payload (JSON), status, requested/reviewed/decided by and at; steps"],
                ["verification_campaigns, verification_items", "Stock-taking", "expected vs found location and condition, result, discrepancy_status, resolution"],
                ["scan_events, asset_retired_labels", "Label scans; replaced labels", "context, user, coordinates; old token"],
                ["notifications, notification_rules", "Messages and their rules", "type, title, link, dedupe_key, is_read, email/sms status; enabled, lead_days, email, sms"],
                ["monthly_reports, report_schedules", "Reporting", "period_key, user_id, role, status, snapshot (JSON), version, decided_by"],
                ["audit_logs", "Audit trail (insert-only)", "user_id, username, action, entity, entity_id, asset_id, summary, changes (JSON), created_at"],
                ["api_keys", "Integration keys", "name, key_prefix, key_hash (SHA-256), is_active, last_used_at"],
                ["backups, system_settings", "Operations", "filename, size, status, verified_at; key, value"]],
               [4.4, 3.6, 8.6])
    s += H2("Migrations")
    s += table([["No.", "Migration", "No.", "Migration"],
                ["001", "Base schema", "011", "Public token for QR cards"],
                ["002", "Smart-city tables (acquisition, verification, notifications ...)", "012", "CHECK constraints"],
                ["003", "User language", "013", "Retired labels"],
                ["004", "Forced password change", "014", "Approval state timestamps"],
                ["005", "On-site checks", "015", "Requests through the Kebele"],
                ["006", "Monthly reports", "016", "Follow-up checks"],
                ["007", "Reporting through the chain", "017", "Area centres for the map"],
                ["008", "Profile photos", "018", "Name parts (first, father, grandfather)"],
                ["009", "Sector details", "019", "Session security (lockout, idle, token version)"],
                ["010", "Asset type \"other\"", "020", "Temporary password expiry"]],
               [1.2, 7.1, 1.2, 7.1])

    # 7 ----------------------------------------------------------------
    s += H1("Validation and error handling")
    s += H2("Input rules")
    s += table([["Kind of field", "Rule (server)", "Behaviour in the form"],
                ["Person's name", "Letters of any script (Latin, Ethiopic), spaces, full stop, apostrophe, hyphen; no digits; 1 to 80 characters per name part", "Other characters cannot be typed"],
                ["Username", "Made by the system: the first name in lower case; if taken, first name and father's name; then a number", "Not typed by the user"],
                ["Phone", "Optional +, 9 to 15 digits, no letters", "Digits only; stops at 10 digits for 09/07 and 12 for +251"],
                ["E-mail", "Standard address format, at most 254 characters", "Checked when leaving the field"],
                ["Password", "8 to 128 characters with upper, lower, digit and symbol", "Strength shown while typing"],
                ["Money (ETB)", "Non-negative, at most two decimals, upper limit per field", "Digits and one decimal point only"],
                ["Dates", "Valid calendar date; not in the future where it records something that happened; end after start", "Date picker"],
                ["Coordinates", "Inside the Jimma City boundary", "Filled from the phone's GPS or the map"],
                ["Enumerations", "One of the allowed values", "Drop-down lists"],
                ["Free text", "Trimmed; maximum length per field (typically 200 or 2000)", "Counter near the limit"],
                ["Files", "PDF, JPG, PNG, WebP, DOC(X), XLS(X); content must match the type; 10 MB; one file per request", "Picker limited to these types"]],
               [3.0, 7.6, 6.0])
    s += H2("HTTP status codes")
    s += table([["Code", "When"],
                ["400", "Invalid input (with per-field details), malformed JSON, file too large, a referenced value does not exist."],
                ["401", "Not signed in, token invalid or expired, session ended (sign-out, password change, idle), account inactive."],
                ["403", "Signed in but the role lacks the permission; temporary password must be replaced first; temporary password expired; account deactivated (at sign-in)."],
                ["404", "Record does not exist or is outside the caller's area; unknown API path."],
                ["409", "Conflict: duplicate unique value, record in use, reservation overlap, invalid state change."],
                ["410", "A replaced QR label was scanned."],
                ["429", "Rate limit exceeded or account temporarily locked; Retry-After header is sent."],
                ["500", "Unexpected error. The body is only \"Internal server error.\"; the detail goes to the server log."]],
               [1.6, 15.0])

    # 8 ----------------------------------------------------------------
    s += H1("Configuration")
    s.append(P("All settings are environment variables, read from <font name='Mono'>backend/.env</font> at start-up. The file must be "
               "readable only by the service account and must never be committed to version control."))
    s += table([["Variable", "Default", "Meaning"],
                ["PORT", "4000", "Port the Node.js process listens on (bind to 127.0.0.1 behind the proxy)."],
                ["DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME", "127.0.0.1, 3306, -, -, jimma_ams", "Database connection."],
                ["DB_NAME_TEST", "jimma_ams_test", "The only database the tests are allowed to empty."],
                ["JWT_SECRET", "(required)", "Token signing secret; at least 16 characters, 48 random bytes recommended."],
                ["JWT_EXPIRES_IN", "8h", "Maximum session length."],
                ["SESSION_IDLE_MINUTES", "30", "Inactivity after which a session ends."],
                ["TEMP_PASSWORD_DAYS", "7", "Validity of a temporary password."],
                ["API_RATE_PER_MINUTE, LOGIN_RATE_PER_MINUTE, PUBLIC_RATE_PER_MINUTE", "600, 20, 120", "Rate limits per address."],
                ["SEPARATION_OF_DUTIES", "true", "Must stay true in production; false only for a one-person pilot."],
                ["PUBLIC_URL", "(none)", "Public https address; turns on HSTS and puts card links in QR codes."],
                ["FRONTEND_ORIGIN", "http://localhost:5173", "Allowed browser origin for CORS (development)."],
                ["UPLOAD_DIR", "uploads", "Folder for files; outside the web root."],
                ["SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM", "(none)", "E-mail; disabled when SMTP_HOST is empty."],
                ["SMS_GATEWAY_URL, SMS_GATEWAY_TOKEN", "(none)", "SMS; disabled when empty."],
                ["BACKUP_DIR, MYSQLDUMP_PATH, AUTO_BACKUP", "backups, mysqldump, false", "Backups."],
                ["AI_BASE_URL, AI_API_KEY, AI_MODEL", "(none)", "AI assistant service (OpenAI-compatible); the assistant is off when not set. Examples in .env.example: Gemini, Groq, Ollama."],
                ["AI_REASONING_EFFORT", "(none)", "none, low, medium or high: how long a \"thinking\" model (Gemini) reasons before answering. low is used with Gemini (answers in about 3 to 8 seconds)."],
                ["AI_RATE_PER_MINUTE", "10", "Questions a minute per person."]],
               [6.2, 3.6, 6.8])

    # 9 ----------------------------------------------------------------
    s += H1("Background jobs")
    s.append(P("The scheduler starts 30 seconds after the server and then runs every hour. Each run is safe to repeat: notifications "
               "carry a de-duplication key so the same alert is not sent twice."))
    s += table([["Job", "What it does"],
                ["Alerts", "Finds maintenance and inspections due within their lead time or overdue, expiring documents and leases, critical assets, and creates notifications by the rules."],
                ["Monthly report reminders", "Three days before each deadline, and after it, notifies the sender and their superior."],
                ["Inspector coverage", "Warns when a Kifle Ketema has no active Inspector."],
                ["Daily backup (optional)", "With AUTO_BACKUP=true, takes one database and file backup per day and verifies it."]],
               [4.0, 12.6])

    # 10 ---------------------------------------------------------------
    s += H1("Front-end design")
    s += bullets([
        "<b>Routing.</b> React Router; each role's menu is defined in <font name='Mono'>App.jsx</font>. A page a role cannot use is not in its menu, and the server refuses it anyway.",
        "<b>Server access.</b> All calls go through <font name='Mono'>api.js</font>, which adds the token, turns error answers into readable messages, and signs the user out on 401.",
        "<b>Session.</b> The token is kept in sessionStorage. The client also signs the user out after the idle time, so an unattended screen does not stay open.",
        "<b>Forms.</b> A shared form system (<font name='Mono'>components/ui.jsx</font>) applies the input rules while typing and shows server field errors next to the field.",
        "<b>Offline.</b> <font name='Mono'>offline.js</font> keeps inspection and verification results in a device outbox when the network is down and sends them when it returns; the service worker caches only the application shell.",
        "<b>Languages.</b> Texts are looked up through <font name='Mono'>t()</font> in dictionaries served by the backend; untranslated texts fall back to English.",
        "<b>No inline scripts.</b> The build produces only external script files, so the CSP can forbid inline scripts entirely.",
    ])

    # 11 ---------------------------------------------------------------
    s += H1("Build, installation and operation")
    s += H2("Installation")
    s.append(code("""# 1. prerequisites: Node.js 20+, MySQL 8, nginx
# 2. database and user (in MySQL)
CREATE DATABASE jimma_ams CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'jimma_ams'@'localhost' IDENTIFIED BY '<long random password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON jimma_ams.* TO 'jimma_ams'@'localhost';
# 3. application
npm run setup                     # install backend and frontend packages
cp backend/.env.example backend/.env && chmod 600 backend/.env   # then edit
npm run migrate                   # create / upgrade tables
npm run seed                      # Kifle Ketemas, Kebeles, sectors, categories, rules
npm --prefix backend run create-admin -- admin "First Name"      # first Super Administrator
npm run build                     # build the web client
npm start                         # or run as a systemd service"""))
    s.append(P("After migration, CREATE, ALTER, INDEX and REFERENCES can be revoked from the application user and granted again only "
               "for upgrades."))
    s += H2("Operations commands")
    s += table([["Command (in backend)", "Use"],
                ["npm run migrate", "Apply new migrations after an upgrade (safe to repeat)."],
                ["npm run provision-admins [-- --dry-run]", "Create the standard 194 accounts; temporary passwords go to a CSV file that must be handed out and deleted."],
                ["npm run reset-password -- <username>", "Print a new temporary password once (for a locked-out administrator)."],
                ["npm run backup", "Database and files backup now."],
                ["npm run restore -- <file.sql.gz> --yes", "Restore the database from a backup."],
                ["npm test", "Run the 265 tests against DB_NAME_TEST."]],
               [6.2, 10.4])
    s += H2("Testing strategy")
    s.append(P("The tests start the real Express application in-process and call it over HTTP with the same requests a browser would "
               "send, against a real MySQL test database that is migrated and filled with fixtures before each file. This tests the "
               "permission checks, the area scope, the validation and the database constraints together, which is where security "
               "mistakes usually hide. Tests run one file at a time to keep them independent. The full suite takes about 25 minutes "
               "on a development laptop; it passed completely (265 of 265) on 25 October 2026."))
    s += H2("Coding conventions")
    s += bullets([
        "Every route that changes data parses its input with a zod schema first and writes an audit entry.",
        "Rules used by more than one route live in <font name='Mono'>lib/</font>, never copied.",
        "No string concatenation into SQL; the few raw fragments contain only column or table names fixed in the code.",
        "Comments explain why, not what; messages to users are complete sentences and translatable.",
    ])
    return s


if __name__ == "__main__":
    out = os.path.join(OUT, "03_TDD_Technical_Specification.pdf")
    build(Doc(out, CODE, TITLE), story())
    print(out)
