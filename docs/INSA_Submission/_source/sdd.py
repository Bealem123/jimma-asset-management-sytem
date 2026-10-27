from common import *

CODE = "JCSAMS-SDD-002"
TITLE = "System and Architecture Design Document"


# ================================================================== diagrams
def fig_context():
    d = Drawing(470, 360)
    # centre
    box(d, 170, 150, 130, 74, "Jimma City Smart Asset Management System\n(web application and REST API)", fill=F_PROC, stroke=TEAL, size=8.6)
    left = [
        (300, "Sector, Kebele and Kifle Ketema\nAdministrators"),
        (232, "Mayor / Executive and\nInternal Auditor"),
        (164, "Financial Officers\nand Inspectors"),
        (96, "Super Administrator"),
        (28, "Citizen or visitor who scans\na QR label (no account)"),
    ]
    for y, t in left:
        entity(d, 4, y, 112, 40, t, 8)
    right = [
        (300, "SMTP e-mail server\n(City or provider)"),
        (232, "SMS gateway\n(HTTP)"),
        (164, "Map tile services\n(OpenStreetMap, Esri)"),
        (96, "Authorised City systems\n(read-only API clients)"),
        (28, "Off-site backup storage\n(operator managed)"),
    ]
    for y, t in right:
        entity(d, 354, y, 112, 40, t, 8)
    # flows left
    arrow(d, 120, 320, 170, 214, "register, verify,\napprove assets", both=True, lx=-6, ly=8)
    arrow(d, 120, 252, 170, 198, "dashboards,\nreports, audit", both=True, lx=-4, ly=4)
    arrow(d, 120, 184, 170, 180, "valuations, income,\ninspections", both=True, lx=-2, ly=8)
    arrow(d, 120, 116, 170, 162, "accounts, master\ndata, settings", both=True, lx=-6, ly=-6)
    arrow(d, 120, 48, 170, 152, "public asset card\n(no money, no names)", lx=-8, ly=-12)
    # flows right
    arrow(d, 300, 214, 354, 320, "notifications\n(e-mail)", lx=6, ly=8)
    arrow(d, 300, 198, 354, 252, "notifications\n(SMS)", lx=6, ly=6)
    arrow(d, 354, 184, 300, 182, "map tiles (browser\nfetches directly)", lx=0, ly=10, dash=[3, 2])
    arrow(d, 354, 116, 300, 162, "asset, location and\nclassification data", both=True, lx=6, ly=-6)
    arrow(d, 300, 152, 354, 48, "database dump\nand file copies", lx=10, ly=-12)
    legend(d, 120, 2, [("entity", "external entity"), ("process", "the system"), ("flow", "data flow"), ("dashed", "fetched by the browser")])
    return d


def fig_architecture():
    d = Drawing(470, 560)
    # client tier
    zone(d, 0, 470, 470, 88, "CLIENT TIER (user devices)")
    box(d, 12, 480, 140, 58, "Desktop / laptop browser\nReact 19 single-page app", fill=F_USER)
    box(d, 165, 480, 140, 58, "Phone browser (installable PWA)\ncamera QR scan, GPS, photos", fill=F_USER)
    box(d, 318, 480, 140, 58, "Service worker + device outbox\napp shell cache; offline\ninspection/verification queue", fill=F_USER, size=8)
    # edge
    zone(d, 0, 400, 470, 60, "EDGE (City data centre, DMZ)")
    box(d, 95, 408, 280, 36, "Reverse proxy (nginx): TLS 1.2/1.3, HTTP to HTTPS redirect,\nforwards to 127.0.0.1:4000, sets X-Forwarded-For", fill=colors.white, size=8)
    arrow(d, 82, 480, 160, 444, "HTTPS", lx=-8)
    arrow(d, 235, 480, 235, 444, "HTTPS", lx=16)
    arrow(d, 388, 480, 310, 444, "HTTPS", lx=10)
    # application tier
    zone(d, 0, 132, 470, 258, "APPLICATION TIER (Node.js 20+, Express 5, single process, runs as an unprivileged service account)")
    box(d, 12, 318, 446, 44, "Security middleware: helmet (CSP, nosniff, frame options, referrer policy, HSTS on HTTPS), Permissions-Policy,\nCORS (own origin), Cache-Control: no-store, rate limits (API, sign-in, public card), JSON body limit 1 MB", fill=colors.white, size=7.8, bold_first=False)
    arrow(d, 235, 408, 235, 362)
    box(d, 12, 262, 214, 46, "Authentication\nJWT (HS256) check, token version, idle timeout,\naccount active, forced password change", size=7.8)
    box(d, 244, 262, 214, 46, "Authorisation\nrole permissions (DB), area scope\n(Kifle Ketema / Kebele / sector), 404 outside", size=7.8)
    box(d, 12, 200, 140, 52, "17 route modules\nassets, requests, verification,\nmonthly reports, users, admin ...", size=7.8)
    box(d, 165, 200, 140, 52, "Domain services (lib)\napproval engine, alerts, money,\nreports, audit, public card", size=7.8)
    box(d, 318, 200, 140, 52, "Validation (zod)\ntypes, lengths, enums, dates,\nunknown fields dropped", size=7.8)
    box(d, 12, 142, 140, 48, "Data access (Knex)\nbound parameters,\ntransactions, migrations", size=7.8)
    box(d, 165, 142, 140, 48, "Scheduler (hourly)\nalerts, report reminders,\ndaily backup", size=7.8)
    box(d, 318, 142, 140, 48, "Static server\nbuilt SPA (frontend/dist),\nservice worker", size=7.8)
    arrow(d, 119, 318, 119, 308); arrow(d, 351, 318, 351, 308)
    arrow(d, 119, 262, 82, 252); arrow(d, 351, 262, 235, 252)
    arrow(d, 152, 226, 165, 226, both=True); arrow(d, 305, 226, 318, 226, both=True)
    arrow(d, 82, 200, 82, 190); arrow(d, 235, 200, 235, 190)
    # data tier
    zone(d, 0, 0, 300, 122, "DATA TIER (same host or private network)")
    cylinder(d, 14, 14, 120, 84, "MySQL 8 (InnoDB, utf8mb4)\n40 tables, port 3306\nlocalhost only")
    box(d, 150, 62, 138, 40, "Upload store\nphotos and documents,\nrandom names", fill=F_STORE, size=7.8)
    box(d, 150, 12, 138, 40, "Backup folder\nSQL dump (gzip) + files,\nverified read-back", fill=F_STORE, size=7.8)
    zone(d, 312, 0, 158, 122, "EXTERNAL SERVICES")
    entity(d, 322, 74, 136, 26, "SMTP e-mail server", 8)
    entity(d, 322, 40, 136, 26, "SMS gateway (HTTP)", 8)
    entity(d, 322, 8, 136, 26, "Off-site backup copy", 8)
    arrow(d, 82, 142, 74, 98, "SQL", lx=-10)
    arrow(d, 210, 142, 219, 102, "files", lx=12)
    arrow(d, 250, 142, 390, 100, "SMTP / HTTPS", lx=20, ly=6)
    poly_arrow(d, [(219, 62), (219, 52)])
    return d


def fig_pipeline():
    d = Drawing(470, 205)
    steps = [
        ("1", "TLS termination\n(reverse proxy)"), ("2", "Security headers\n(helmet, CSP)"), ("3", "Rate limit\nper address"),
        ("4", "Parse JSON\n(max 1 MB)"), ("5", "Authenticate\n(JWT + DB state)"), ("6", "Permission\ncheck (role)"),
        ("7", "Area scope\n(404 outside)"), ("8", "Validate input\n(zod schema)"), ("9", "Business rules +\nDB transaction"),
        ("10", "Audit log\nentry"), ("11", "Response\n(no-store)"), ("12", "Error handler\n(no internals)"),
    ]
    w, h, gap = 66, 46, 12.8
    for i, (n, t) in enumerate(steps):
        row = i // 6
        col = i % 6 if row == 0 else 5 - (i % 6)
        x = 4 + col * (w + gap)
        y = 128 if row == 0 else 30
        fill = F_PROC if n not in ("12",) else colors.HexColor("#FDECEC")
        box(d, x, y, w, h, f"{n}. {t}", fill=fill, size=7.4, bold_first=False)
        if i < 5:
            arrow(d, x + w, y + h / 2, x + w + gap, y + h / 2)
        elif i == 5:
            arrow(d, x + w / 2, y, x + w / 2, 30 + h)
        elif i < 11 and i != 10:
            arrow(d, x, y + h / 2, x - gap, y + h / 2)
    # rejection arrows to error handler
    d.add(String(235, 190, "Any step that fails stops the request and passes to the error handler (12):", fontName="Body-Italic", fontSize=7.6, fillColor=GREY, textAnchor="middle"))
    d.add(String(235, 12, "401 not signed in / session ended   403 no permission   404 outside area or missing   400 invalid input   409 conflict   429 too many requests", fontName="Body", fontSize=7.2, fillColor=GREY, textAnchor="middle"))
    return d


def fig_deployment():
    d = Drawing(470, 330)
    zone(d, 0, 236, 140, 90, "INTERNET / CITY LAN")
    box(d, 12, 250, 116, 52, "Staff browsers and phones\n(HTTPS 443 only)", fill=F_USER, size=8)
    zone(d, 152, 0, 318, 326, "CITY DATA CENTRE: application server (Ubuntu Server 22.04/24.04 LTS recommended)")
    box(d, 166, 250, 140, 52, "nginx :443 / :80\ncertificate for the City domain;\n:80 only redirects", fill=colors.white, size=7.8)
    box(d, 320, 250, 138, 52, "Host firewall\nallow 443, 80, SSH from\nadmin network only", fill=colors.HexColor("#FDF3E6"), size=7.8)
    box(d, 166, 160, 140, 64, "Node.js service :4000\nbound to 127.0.0.1;\nsystemd unit, NODE_ENV=production,\nrestart on failure", size=7.8)
    box(d, 320, 160, 138, 64, "Configuration\nbackend/.env (0600, service\naccount), JWT secret 48+ bytes,\nDB credentials", fill=colors.HexColor("#FDF3E6"), size=7.8)
    cylinder(d, 166, 60, 140, 82, "MySQL 8 :3306\nbound to 127.0.0.1;\napp user with DML rights only")
    box(d, 320, 100, 138, 42, "/var/lib/jcsams/uploads\nnot executable, not web root", fill=F_STORE, size=7.8)
    box(d, 320, 46, 138, 42, "/var/backups/jcsams\ndaily, then copied off-site", fill=F_STORE, size=7.8)
    box(d, 166, 10, 292, 30, "Encrypted disk (LUKS) for database, uploads and backups; OS security updates monthly", fill=colors.white, size=7.8, bold_first=False)
    arrow(d, 128, 276, 166, 276, "443", ly=7)
    arrow(d, 236, 250, 236, 224, "HTTP to\n127.0.0.1:4000", lx=30)
    arrow(d, 236, 160, 236, 142, "SQL", lx=14)
    arrow(d, 306, 180, 320, 125)
    arrow(d, 306, 170, 320, 70)
    return d


def fig_dfd0():
    d = Drawing(470, 330)
    process(d, 175, 120, 120, 92, "0", "Manage Jimma City assets\n(JCSAMS)", 8.6)
    E = {
        "staff": entity(d, 4, 250, 120, 44, "City staff\n(8 roles)"),
        "public": entity(d, 4, 40, 120, 40, "QR label scanner\n(public)"),
        "mail": entity(d, 346, 262, 120, 36, "E-mail / SMS\nservices"),
        "api": entity(d, 346, 150, 120, 40, "City systems\n(API clients)"),
        "backup": entity(d, 346, 40, 120, 40, "Backup storage"),
    }
    arrow(d, 124, 280, 190, 212, "credentials, asset data,\ndocuments, decisions,\ninspection and verification\nresults, monthly reports", lx=-34, ly=10)
    arrow(d, 205, 212, 112, 250, "dashboards, lists,\nasset records, alerts,\nreport status", lx=40, ly=-14)
    arrow(d, 124, 60, 175, 140, "label token", lx=-14, ly=-4)
    arrow(d, 175, 128, 124, 50, "public asset card", lx=6, ly=-10)
    arrow(d, 295, 200, 346, 278, "notification\nmessages", lx=6, ly=4)
    arrow(d, 346, 166, 295, 166, "API key,\nquery", ly=12)
    arrow(d, 295, 152, 346, 158, None)
    d.add(String(320, 135, "asset data (no money)", fontName="Body", fontSize=7.4, fillColor=GREY, textAnchor="middle"))
    arrow(d, 295, 130, 346, 62, "backup\narchive", lx=8, ly=-4)
    legend(d, 100, 6, [("entity", "external entity"), ("process", "process"), ("flow", "data flow")])
    return d


def fig_dfd1():
    d = Drawing(470, 640)
    # external entities
    entity(d, 4, 584, 100, 40, "Sector\nAdministrator", 8)
    entity(d, 186, 588, 100, 34, "Kebele / Kifle Ketema\nAdministrators", 7.8)
    entity(d, 366, 584, 100, 40, "Inspector /\nFinancial Officer", 8)
    entity(d, 4, 8, 100, 36, "Super\nAdministrator", 8)
    entity(d, 186, 8, 100, 36, "Mayor / Internal\nAuditor", 8)
    entity(d, 366, 8, 100, 36, "E-mail / SMS\nservices", 8)
    # processes
    P1 = process(d, 4, 470, 120, 64, "1.0", "Authenticate and\nmanage accounts", 8)
    P2 = process(d, 175, 470, 120, 64, "2.0", "Register and approve\nassets", 8)
    P3 = process(d, 346, 470, 120, 64, "3.0", "Inspect, maintain,\ntransfer, dispose", 8)
    P4 = process(d, 4, 270, 120, 64, "4.0", "Verify physically\n(campaigns, QR scan)", 8)
    P5 = process(d, 346, 270, 120, 64, "5.0", "Record valuations\nand income", 8)
    P6 = process(d, 4, 80, 120, 64, "6.0", "Prepare and decide\nmonthly reports", 8)
    P7 = process(d, 175, 80, 120, 64, "7.0", "Generate alerts and\nnotifications", 8)
    P8 = process(d, 346, 80, 120, 64, "8.0", "Analyse, search and\nexport", 8)
    # data stores (centre column)
    store(d, 160, 400, 150, 24, "D1", "Users, roles, permissions")
    store(d, 160, 362, 150, 24, "D2", "Asset register")
    store(d, 160, 324, 150, 24, "D3", "Asset history records")
    store(d, 160, 286, 150, 24, "D4", "Documents and photos")
    store(d, 160, 248, 150, 24, "D5", "Approval requests")
    store(d, 160, 210, 150, 24, "D6", "Monthly reports")
    store(d, 160, 172, 150, 24, "D7", "Notifications")
    store(d, 160, 134, 150, 24, "D8", "Audit log (insert-only)")
    # entity -> process
    arrow(d, 54, 584, 64, 534, "credentials", lx=-24)
    arrow(d, 80, 590, 190, 534, "asset details,\nphotos, documents", lx=-8, ly=6)
    arrow(d, 236, 588, 236, 534, "verification and\napproval decisions", lx=46)
    arrow(d, 416, 584, 406, 534, "inspection results,\nvaluations", lx=46)
    arrow(d, 54, 44, 64, 80, "accounts,\nsettings", lx=-26)
    arrow(d, 236, 44, 236, 80, None)
    arrow(d, 96, 80, 200, 44, "accepted / returned\nreports", lx=-30, ly=-6)
    arrow(d, 295, 112, 380, 44, "messages", lx=20, ly=-4)
    arrow(d, 346, 92, 270, 44, "lists, CSV,\nindicators", lx=6, ly=-4)
    # process <-> store
    arrow(d, 64, 470, 160, 412, "read/write", lx=-10, ly=8, size=7)
    arrow(d, 235, 470, 235, 424, None)
    arrow(d, 346, 480, 310, 374, None)
    arrow(d, 346, 470, 310, 336, "history,\ncondition", lx=18, ly=-20, size=7)
    arrow(d, 64, 334, 160, 366, "expected vs.\nfound", lx=-30, ly=8, size=7)
    arrow(d, 124, 300, 160, 260, "corrections", lx=-14, ly=-2, size=7)
    arrow(d, 346, 300, 310, 336, None)
    arrow(d, 346, 290, 310, 298, "valuation,\nincome", lx=18, ly=-10, size=7)
    arrow(d, 64, 144, 160, 222, "frozen figures", lx=-24, ly=12, size=7)
    arrow(d, 235, 144, 235, 172, None)
    arrow(d, 175, 120, 160, 146, None)
    arrow(d, 346, 144, 310, 374, None, dash=[3, 2])
    d.add(String(406, 360, "reads D2, D3", fontName="Body", fontSize=7, fillColor=GREY, textAnchor="middle"))
    d.add(String(404, 200, "every change of every process", fontName="Body-Italic", fontSize=7, fillColor=GREY, textAnchor="middle"))
    d.add(String(404, 190, "is also written to D8", fontName="Body-Italic", fontSize=7, fillColor=GREY, textAnchor="middle"))
    arrow(d, 360, 196, 310, 146, None, dash=[2, 2], color=GREY)
    return d


def fig_dfd2():
    d = Drawing(470, 300)
    entity(d, 4, 240, 104, 36, "Sector\nAdministrator", 8)
    entity(d, 182, 248, 104, 36, "Kebele\nAdministrator", 8)
    entity(d, 362, 240, 104, 36, "Kifle Ketema\nAdministrator", 8)
    p1 = process(d, 4, 140, 104, 62, "2.1", "Capture draft\n(validated)", 8)
    p2 = process(d, 126, 140, 104, 62, "2.2", "Submit for\nverification", 8)
    p3 = process(d, 244, 140, 104, 62, "2.3", "Verify on site\n(or send back)", 8)
    p4 = process(d, 362, 140, 104, 62, "2.4", "Approve and\nactivate", 8)
    store(d, 30, 50, 170, 24, "D2", "Asset register (approval_state)")
    store(d, 250, 50, 170, 24, "D4", "Documents and photos")
    store(d, 30, 12, 170, 24, "D8", "Audit log")
    store(d, 250, 12, 170, 24, "D7", "Notifications")
    arrow(d, 56, 240, 56, 202, "asset data,\nphotos", lx=-26)
    arrow(d, 108, 171, 126, 171)
    arrow(d, 230, 171, 244, 171)
    arrow(d, 348, 171, 362, 171)
    arrow(d, 234, 248, 296, 202, "site check\nresult, GPS", lx=26)
    arrow(d, 414, 240, 414, 202, "decision,\nnote", lx=24)
    arrow(d, 56, 140, 80, 74, "DRAFT", lx=-14, size=7)
    arrow(d, 178, 140, 140, 74, "SUBMITTED", lx=4, ly=-2, size=7)
    arrow(d, 296, 140, 300, 74, "REVIEWED", lx=20, size=7)
    arrow(d, 414, 140, 380, 74, "ACTIVE + QR token", lx=10, ly=-2, size=7)
    arrow(d, 296, 140, 160, 74, None, dash=[3, 2])
    arrow(d, 296, 140, 335, 36, None, dash=[3, 2], color=GREY)
    d.add(String(235, 112, "returned: back to 2.1 with a reason", fontName="Body-Italic", fontSize=7.2, fillColor=GREY, textAnchor="middle"))
    return d


def fig_states():
    d = Drawing(470, 150)
    st = [("DRAFT", 6), ("SUBMITTED", 100), ("REVIEWED", 194), ("APPROVED", 288), ("ACTIVE", 382)]
    for name, x in st:
        box(d, x, 70, 82, 32, name, fill=F_USER if name != "ACTIVE" else F_PROC, size=8.6, r=14)
    arrow(d, 88, 86, 100, 86)
    arrow(d, 182, 86, 194, 86)
    arrow(d, 276, 86, 288, 86)
    arrow(d, 370, 86, 382, 86)
    d.add(String(94, 112, "submit", fontName="Body", fontSize=7.4, fillColor=GREY, textAnchor="middle"))
    d.add(String(188, 112, "verify", fontName="Body", fontSize=7.4, fillColor=GREY, textAnchor="middle"))
    d.add(String(282, 112, "approve", fontName="Body", fontSize=7.4, fillColor=GREY, textAnchor="middle"))
    d.add(String(376, 112, "activate", fontName="Body", fontSize=7.4, fillColor=GREY, textAnchor="middle"))
    poly_arrow(d, [(141, 70), (141, 40), (47, 40), (47, 70)], "returned with a reason (Kebele)", lpos=(94, 40))
    poly_arrow(d, [(235, 70), (235, 22), (40, 22), (40, 70)], "returned with a reason (Kifle Ketema)", lpos=(138, 22))
    d.add(String(47, 126, "Sector Administrator", fontName="Body-Italic", fontSize=7.4, fillColor=TEAL, textAnchor="middle"))
    d.add(String(141, 126, "Sector Administrator", fontName="Body-Italic", fontSize=7.4, fillColor=TEAL, textAnchor="middle"))
    d.add(String(235, 126, "Kebele Administrator", fontName="Body-Italic", fontSize=7.4, fillColor=TEAL, textAnchor="middle"))
    d.add(String(329, 126, "Kifle Ketema Administrator", fontName="Body-Italic", fontSize=7.4, fillColor=TEAL, textAnchor="middle"))
    d.add(String(423, 126, "system", fontName="Body-Italic", fontSize=7.4, fillColor=TEAL, textAnchor="middle"))
    return d


def fig_erd():
    d = Drawing(470, 430)

    def ent(x, y, w, name, fields):
        h = 16 + 11 * len(fields)
        d.add(Rect(x, y, w, h, fillColor=colors.white, strokeColor=NAVY, strokeWidth=0.9))
        d.add(Rect(x, y + h - 16, w, 16, fillColor=HEADBG, strokeColor=NAVY, strokeWidth=0.9))
        d.add(String(x + w / 2, y + h - 11.5, name, fontName="Body-Bold", fontSize=8.2, fillColor=NAVY, textAnchor="middle"))
        for i, f in enumerate(fields):
            d.add(String(x + 5, y + h - 27 - i * 11, f, fontName="Body", fontSize=7.3, fillColor=INK))
        return (x, y, w, h)

    ent(4, 356, 100, "kifle_ketemas", ["PK id", "name"])
    ent(4, 280, 100, "kebeles", ["PK id", "name", "FK kifle_ketema_id"])
    ent(4, 200, 100, "sectors", ["PK id", "code, name"])
    ent(4, 112, 100, "users", ["PK id", "username, names", "role, is_active", "token_version", "failed/lock fields"])
    ent(4, 20, 100, "user_* scope", ["FK user_id", "FK kifle_ketema / kebele", "/ sector id"])
    ent(170, 250, 132, "assets", ["PK id, asset_code (AST-)", "FK category, type", "FK sector, department", "FK kifle_ketema, kebele", "condition, status", "approval_state", "acquisition_cost", "public_token", "created/submitted/", "reviewed/approved_by"])
    ent(170, 150, 132, "asset_categories / types", ["PK id", "FK category_id (types)", "name"])
    ent(170, 40, 132, "approval_requests", ["PK id, FK asset_id", "request_type, payload", "status (PENDING ...)", "requested/reviewed/", "decided_by"])
    ent(362, 352, 104, "maintenance / inspection", ["PK id, FK asset_id", "dates, result, cost", "recorded_by"])
    ent(362, 278, 104, "transfers / assignments", ["PK id, FK asset_id", "from / to, dates", "authorised by"])
    ent(362, 204, 104, "valuations / revenues", ["PK id, FK asset_id", "value / amount", "dates, recorded_by"])
    ent(362, 130, 104, "asset_documents", ["PK id, FK asset_id", "doc_type, mime", "stored_name (random)"])
    ent(362, 56, 104, "verification items", ["PK id, FK campaign", "FK asset_id, result", "discrepancy_status"])
    ent(170, 360, 132, "monthly_reports", ["PK id, FK user_id", "period_key, snapshot", "status, version"])
    ent(362, 4, 104, "audit_logs", ["PK id, user, action", "entity, changes (JSON)"])

    def rel(x1, y1, x2, y2, many_at_end=True):
        d.add(Line(x1, y1, x2, y2, strokeColor=GREY, strokeWidth=0.8))
        # crow's foot at (x2, y2)
        import math
        a = math.atan2(y1 - y2, x1 - x2)
        for da in (-0.45, 0, 0.45):
            d.add(Line(x2, y2, x2 + 9 * math.cos(a + da), y2 + 9 * math.sin(a + da), strokeColor=GREY, strokeWidth=0.8))

    rel(54, 356, 54, 314)          # kifle -> kebeles
    rel(104, 296, 170, 330)        # kebele -> assets
    rel(104, 216, 170, 300)        # sector -> assets
    rel(104, 380, 170, 345)        # kifle -> assets
    rel(236, 216, 236, 250)        # category -> assets
    rel(54, 112, 54, 64)           # users -> scope
    rel(104, 150, 170, 270)        # users -> assets (created_by)
    rel(104, 140, 170, 380)        # users -> monthly reports
    rel(236, 250, 236, 101)        # assets -> requests
    for y in (370, 296, 222, 148, 74):
        rel(302, 300, 362, y + 10)
    d.add(String(235, 6, "Crow's foot = many. Every child table also stores who recorded the row and when.", fontName="Body-Italic", fontSize=7.4, fillColor=GREY, textAnchor="middle"))
    return d


def fig_seq_login():
    d = Drawing(470, 360)
    lanes = [("Browser (SPA)", 50), ("Express API", 175), ("Auth / security lib", 300), ("MySQL", 420)]
    for name, x in lanes:
        box(d, x - 48, 326, 96, 26, name, fill=HEADBG, size=8.2)
        d.add(Line(x, 326, x, 10, strokeColor=LINE, strokeWidth=0.9, strokeDashArray=[3, 3]))
    msgs = [
        (50, 175, 306, "POST /api/auth/login {username, password}"),
        (175, 300, 288, "rate limit (20/min per address)"),
        (300, 420, 270, "SELECT user by username"),
        (420, 300, 252, "row (hash, lock state, temp-password expiry)"),
        (300, 300, 234, "bcrypt compare (cost 12); same time if no user"),
        (300, 420, 216, "fail: count++ / lock 15 min after 5; ok: reset"),
        (300, 420, 198, "INSERT audit_logs (LOGIN / LOGIN_FAILED)"),
        (175, 50, 180, "200 {token (JWT, 8 h, tv), user} or 401 / 429 locked"),
        (50, 175, 150, "GET /api/... Authorization: Bearer <token>"),
        (175, 300, 132, "verify signature and expiry"),
        (300, 420, 114, "SELECT user: active? token_version? last_seen?"),
        (300, 175, 96, "401 if idle > 30 min, version changed, inactive"),
        (175, 420, 78, "scoped query (role permissions + area)"),
        (175, 50, 58, "200 JSON, Cache-Control: no-store"),
        (50, 175, 34, "POST /api/auth/logout (token_version + 1)"),
    ]
    for x1, x2, y, t in msgs:
        if x1 == x2:
            poly_arrow(d, [(x1, y + 4), (x1 + 22, y + 4), (x1 + 22, y - 6), (x1 + 2, y - 6)])
            d.add(String(x1 - 6, y + 8, t, fontName="Body", fontSize=7.2, fillColor=INK, textAnchor="end"))
        else:
            arrow(d, x1, y, x2, y, dash=[3, 2] if x2 < x1 else None)
            d.add(String((x1 + x2) / 2, y + 3, t, fontName="Body", fontSize=7.2, fillColor=INK, textAnchor="middle"))
    return d


def fig_seq_scan():
    d = Drawing(470, 250)
    lanes = [("Phone camera /\nbrowser", 50), ("Public card route\n/api/public", 190), ("publicAsset lib", 320), ("MySQL", 425)]
    for name, x in lanes:
        box(d, x - 52, 212, 104, 32, name, fill=HEADBG, size=8)
        d.add(Line(x, 212, x, 10, strokeColor=LINE, strokeWidth=0.9, strokeDashArray=[3, 3]))
    msgs = [
        (50, 190, 192, "GET /a/<token> then /api/public/assets/<token>"),
        (190, 190, 172, "rate limit 120/min"),
        (190, 320, 152, "check token pattern (16 to 32 url-safe chars)"),
        (320, 425, 132, "SELECT asset by public_token"),
        (320, 425, 112, "not found: SELECT retired labels"),
        (320, 190, 92, "safe fields only (no money, names, GPS, serials)"),
        (190, 50, 72, "200 public card / 404 / 410 label replaced"),
        (50, 190, 46, "signed-in staff: in-app scanner -> POST /api/assets/scan"),
        (190, 425, 26, "scope check, INSERT scan_events (who, when, where)"),
    ]
    for x1, x2, y, t in msgs:
        if x1 == x2:
            poly_arrow(d, [(x1, y + 4), (x1 + 22, y + 4), (x1 + 22, y - 6), (x1 + 2, y - 6)])
            d.add(String(x1 + 26, y - 4, t, fontName="Body", fontSize=7.2, fillColor=INK))
        else:
            arrow(d, x1, y, x2, y, dash=[3, 2] if x2 < x1 else None)
            d.add(String((x1 + x2) / 2, y + 3, t, fontName="Body", fontSize=7.2, fillColor=INK, textAnchor="middle"))
    return d


def fig_trust():
    d = Drawing(470, 250)
    zone(d, 0, 0, 120, 246, "UNTRUSTED")
    entity(d, 10, 170, 100, 40, "Anonymous visitor\n(QR card, sign-in page)", 7.8)
    entity(d, 10, 96, 100, 40, "Signed-in staff\nbrowser / phone", 7.8)
    entity(d, 10, 22, 100, 40, "API client with\nAPI key", 7.8)
    d.add(Line(130, 0, 130, 246, strokeColor=colors.HexColor("#C0392B"), strokeWidth=1.4, strokeDashArray=[6, 3]))
    d.add(String(134, 236, "TB1: internet / LAN to proxy (TLS)", fontName="Body-Bold", fontSize=7.4, fillColor=colors.HexColor("#C0392B")))
    zone(d, 140, 0, 180, 226, "APPLICATION HOST")
    box(d, 152, 150, 156, 50, "nginx (TLS)", fill=colors.white, size=8)
    d.add(Line(140, 135, 320, 135, strokeColor=colors.HexColor("#C0392B"), strokeWidth=1.2, strokeDashArray=[6, 3]))
    d.add(String(146, 124, "TB2: proxy to app (loopback only)", fontName="Body-Bold", fontSize=7.4, fillColor=colors.HexColor("#C0392B")))
    box(d, 152, 50, 156, 62, "Node.js API\nauthn, authz, scope,\nvalidation, audit", size=8)
    d.add(Line(330, 0, 330, 226, strokeColor=colors.HexColor("#C0392B"), strokeWidth=1.2, strokeDashArray=[6, 3]))
    d.add(String(334, 236, "TB3: app to data / outside services", fontName="Body-Bold", fontSize=7.4, fillColor=colors.HexColor("#C0392B")))
    cylinder(d, 346, 120, 116, 70, "MySQL\n(localhost)")
    box(d, 346, 64, 116, 40, "Upload store,\nbackups", fill=F_STORE, size=8)
    entity(d, 346, 12, 116, 36, "SMTP / SMS", 8)
    arrow(d, 110, 190, 152, 180)
    arrow(d, 110, 116, 152, 170)
    arrow(d, 110, 42, 152, 160)
    arrow(d, 230, 150, 230, 112)
    arrow(d, 308, 100, 346, 150)
    arrow(d, 308, 84, 346, 84)
    arrow(d, 308, 64, 346, 32)
    return d


def fig_ai():
    d = Drawing(470, 300)
    lanes = [("Browser\n(chat window)", 45), ("Assistant route\n/api/assistant", 160), ("Assistant lib +\nscoped queries", 285), ("AI service\n(Gemini / Ollama)", 415)]
    for name, x in lanes:
        box(d, x - 50, 262, 100, 32, name, fill=HEADBG, size=8)
        d.add(Line(x, 262, x, 10, strokeColor=LINE, strokeWidth=0.9, strokeDashArray=[3, 3]))
    msgs = [
        (45, 160, 244, "POST /chat {messages} + Bearer token"),
        (160, 160, 226, "authenticate, 10/min, schema (no system role)"),
        (160, 285, 206, "question + user (role, area, perms)"),
        (285, 415, 186, "server instructions + guide + question + 4 read-only tools"),
        (415, 285, 166, "tool call, e.g. count_assets {group_by: condition}"),
        (285, 285, 146, "same scoped query as the screens (area, money mask)"),
        (285, 415, 126, "tool result (data only, max 6000 chars)"),
        (415, 285, 106, "answer text (at most 4 rounds)"),
        (285, 160, 86, "answer + lookups used"),
        (160, 160, 66, "audit: ASSISTANT_QUESTION (no question text)"),
        (160, 45, 44, "200 {answer} shown as plain text"),
    ]
    for x1, x2, y, t in msgs:
        if x1 == x2:
            poly_arrow(d, [(x1, y + 4), (x1 + 22, y + 4), (x1 + 22, y - 6), (x1 + 2, y - 6)])
            d.add(String(x1 + 26, y - 4, t, fontName="Body", fontSize=7.2, fillColor=INK))
        else:
            arrow(d, x1, y, x2, y, dash=[3, 2] if x2 < x1 else None)
            d.add(String((x1 + x2) / 2, y + 3, t, fontName="Body", fontSize=7.2, fillColor=INK, textAnchor="middle"))
    return d


# ================================================================== document
def story():
    s = []
    s += cover(CODE, TITLE, "Architecture, key components, data flows and design decisions",
               "This document describes how the Jimma City Smart Asset Management System is built: the parts it is made of, "
               "how they are deployed, how data moves between users, the application, the database and outside services, and "
               "the reasons behind the main design choices. It is written so that the INSA assessment team can plan the "
               "security test of the web application and its API without first reading the source code.")
    s += document_control(
        [["0.1", "2 October 2026", AUTHOR, "First outline: components and deployment."],
         ["0.5", "18 October 2026", AUTHOR, "Data flow diagrams, entity relationships, approval states added after the role review."],
         ["0.9", "24 October 2026", AUTHOR, "Updated for the security work: account lockout, idle timeout, server-side sign-out, temporary password expiry."],
         ["1.0", DATE, AUTHOR, "Issued for the INSA assessment."]],
        related=RELATED)
    s += toc()

    # 1 -----------------------------------------------------------------
    s += H1("Introduction")
    s += H2("Purpose of this document")
    s.append(P("Jimma City Administration owns or controls thousands of assets: offices, market stalls and shops, land, vehicles, "
               "construction machinery, farms, halls and equipment. Until now the records for these assets have been kept on paper "
               "and in separate spreadsheets in each sector office. Nobody could say with confidence how many assets the City has, "
               "where they are, what condition they are in or who is responsible for them."))
    s.append(P("The Jimma City Smart Asset Management System (JCSAMS) replaces those scattered records with one register that every "
               "level of the City administration works on, from the sector office in a Kebele up to the Mayor. This document is the "
               "System and Architecture Design Document (SDD). It explains the architecture of that system, its key components, "
               "its data flows and the decisions that shaped it."))
    s += H2("Intended readers")
    s += table([["Reader", "What they will use this document for"],
                ["INSA assessment team", "Understanding the attack surface: entry points, trust boundaries, where data is stored and how it moves (sections 3, 6, 7 and 9)."],
                ["Jimma City ICT Directorate", "Installing, operating and maintaining the system; planning the production server (section 5)."],
                ["Developers who maintain the system", "Finding where a function lives and how the parts depend on each other (sections 4 and 8)."],
                ["Project sponsors at the Mayor's office", "Checking that the design follows the City's chain of responsibility (sections 2 and 6)."]],
               [5.0, 11.6])
    s += H2("Scope")
    s.append(P("The document covers the version of the system submitted for assessment (release 1.0, October 2026): the web "
               "application used by City staff, the REST API behind it, the public asset card opened by a printed QR label, the "
               "read-only integration API, the MySQL database, the file store for photos and documents, the scheduled jobs and "
               "the connections to e-mail and SMS services."))
    s.append(P("Rent billing, receipts and arrears management are planned for the next phase and are not part of this release. "
               "They will be built on the same asset register and are mentioned here only where the current design prepares for them."))
    s += H2("Definitions and abbreviations")
    s += table([["Term", "Meaning"],
                ["Kifle Ketema", "Sub-city. Jimma has three: Hirmata, Jiren and Gibe."],
                ["Kebele", "The smallest administrative unit. Each Kebele belongs to one Kifle Ketema. The system currently holds 13 Kebeles."],
                ["Sector", "A line office of the City, for example Agriculture, Land, Trade or Construction. Each Kebele has the same 13 working sectors."],
                ["Asset ID", "The unique, system-generated identifier of an asset, in the form AST-000125."],
                ["Public token", "A random 16-character code printed in an asset's QR label. It opens the public asset card and reveals nothing by itself."],
                ["Area scope", "The part of the City a user may see and act on: the whole City, one or more Kifle Ketemas, one Kebele, or one sector in one Kebele."],
                ["Approval state", "Where a newly registered asset stands in the registration chain: DRAFT, SUBMITTED, REVIEWED, APPROVED, ACTIVE."],
                ["DFD", "Data Flow Diagram (Gane and Sarson notation in this document)."],
                ["JWT", "JSON Web Token, the signed session token the browser sends with each request."],
                ["PWA", "Progressive Web App: a web application that can be installed on a phone and opened without a connection."],
                ["SPA", "Single-Page Application: the browser loads the application once and then exchanges only data with the server."],
                ["CSP", "Content Security Policy, an HTTP header that tells the browser which scripts and resources it may load."]],
               [3.4, 13.2])
    s += H2("References")
    s += table([["Reference", "Title"],
                ["JCSAMS-SRS-001", "Software Requirements Specification, version 1.0"],
                ["JCSAMS-TDD-003", "Technical Design and Specification, version 1.0"],
                ["JCSAMS-SEC-005", "Security Documentation, version 1.0"],
                ["ISO/IEC/IEEE 42010:2022", "Systems and software engineering: architecture description"],
                ["OWASP Top 10 (2021), OWASP API Security Top 10 (2023)", "Web application and API security risk lists used for the security design"],
                ["Project discussion record", "Jimma City Asset Management System: Updated Discussion Summary and Conceptual Architecture, 6 October 2026"]],
               [5.6, 11.0])

    # 2 -----------------------------------------------------------------
    s += H1("System overview")
    s += H2("What the system does")
    s.append(P("The system keeps one record for every asset the City owns or controls and follows that asset through its whole "
               "life: acquisition, registration, approval, assignment to an office or person, use, inspection, maintenance, "
               "transfer, physical verification, retirement and disposal. Every change is kept with the name of the person who "
               "made it and the time, and nothing is overwritten without the earlier value being kept."))
    s.append(P("The main functions are:"))
    s += bullets([
        "<b>Asset register.</b> Registration with a unique Asset ID, category and type, sector, location down to the Kebele and GPS point, ownership, responsible officer, condition, status, photos and documents.",
        "<b>Registration chain.</b> A Sector Administrator registers an asset; the Kebele Administrator confirms on site that it exists; the Kifle Ketema Administrator approves it. Only then does the asset become active.",
        "<b>Operations.</b> Maintenance, inspections (by Inspectors only), transfers, assignments, ownership changes, reservations of halls and vehicles, retirement and disposal, each with its own approval rules.",
        "<b>Physical verification.</b> Stock-taking campaigns in which officers scan QR labels and record whether each asset was found, missing or in the wrong place; differences are investigated and corrected with approval.",
        "<b>Money.</b> Acquisition cost, valuations, straight-line depreciation and income per asset. These figures are visible only to roles with the financial permission.",
        "<b>Monthly reports.</b> Each level sends a monthly report to the level directly above it. The system prepares the figures and freezes them when the report is sent.",
        "<b>Oversight.</b> Dashboards for each level, a map of assets, analytics, notifications by e-mail and SMS, and an audit log that only the Super Administrator and the Internal Auditor can read.",
        "<b>AI assistant.</b> A chat window on every page answers how-to questions and looks things up in the user's own area. It can only read.",
    ])
    s += H2("Users and their areas")
    s.append(P("The system has eight roles. Five follow the City's line of command; three are specialist roles that sit beside it. "
               "A user only ever sees the part of the City that belongs to their role and assigned area. Table 1 summarises them; "
               "the full permission matrix is in the Security Documentation (JCSAMS-SEC-005)."))
    s += table([["Role", "Main responsibility", "Area seen"],
                ["Super Administrator", "Accounts of the Kifle Ketema Administrators and specialists, master data, settings, backups, audit log. Does no asset work.", "Whole City"],
                ["Mayor / Executive", "Reads dashboards, analytics and money; receives the monthly reports of the Kifle Ketemas and the Internal Auditor.", "Whole City"],
                ["Kifle Ketema Administrator", "Approves and activates assets and requests; manages the Kebele Administrators; follows the Inspectors.", "One Kifle Ketema"],
                ["Kebele Administrator", "Verifies new assets on site; runs stock-taking; manages the Sector Administrators.", "One Kebele"],
                ["Sector Administrator", "Registers and maintains the assets of one sector; raises requests.", "One sector in one Kebele"],
                ["Internal Auditor", "Independent read-only review of records, money, users and the audit log.", "Whole City"],
                ["Financial Officer", "Records valuations and income.", "Assigned Kifle Ketemas"],
                ["Inspector", "The only role that records inspections; records verification results.", "Assigned Kifle Ketemas"]],
               [3.8, 9.4, 3.4])
    s.append(P("Table 1: Roles and areas", "caption"))
    s += H2("System context")
    s.append(P("Figure 1 places the system among the people and systems it exchanges data with. All staff use the same web "
               "application; what they can do is decided on the server by their role and area. The only part that needs no "
               "account is the public asset card, which a citizen sees when scanning a QR label with an ordinary phone camera. "
               "It answers the question \"whose is this and is it registered?\" and shows no money, no personal names and no exact position."))
    s += figure(fig_context(), "System context diagram")
    s.append(P("Outgoing connections are few and fixed: the SMTP server and the SMS gateway configured by the City, and, when the "
               "AI assistant is switched on, the AI service the City configures (section 6.7). The server never fetches a URL supplied by a user. Map tiles are loaded by the user's browser directly from OpenStreetMap and "
               "Esri; the server is not involved, and the Content Security Policy allows only those two image sources."))

    # 3 -----------------------------------------------------------------
    s += H1("Architecture")
    s += H2("Architectural style")
    s.append(P("JCSAMS is a three-tier web application with a single-page client. We chose this style deliberately and kept the "
               "number of moving parts small, because the system will be run by the City's own ICT staff on one server in the City "
               "data centre:"))
    s += bullets([
        "<b>One application process.</b> A single Node.js process serves both the API and the built web application. There is no message broker, cache server or separate front-end server to secure and monitor. The design still allows a second instance behind the proxy later; the only in-memory state is the rate-limit counters.",
        "<b>A stateless API.</b> The server keeps no session in memory. Each request carries a signed token, and the server re-reads the user from the database on every request, so a deactivated account or a changed role takes effect immediately.",
        "<b>A relational database as the single source of truth.</b> Everything except the uploaded files lives in MySQL, with foreign keys, check constraints and transactions. Backups are one SQL dump plus one folder of files.",
        "<b>Authorisation on the server only.</b> The browser hides menu entries a user cannot use, but that is a convenience. Every request is checked again on the server for the role's permission and the user's area.",
    ])
    s += H2("Architecture diagram")
    s.append(P("Figure 2 shows the tiers and the components inside each tier. Arrows show the direction in which requests are made."))
    s += figure(fig_architecture(), "System architecture: tiers and components")
    s += H2("Client tier")
    s.append(P("The client is a React 19 single-page application built with Vite into static files (HTML, JavaScript, CSS, fonts and "
               "images). It is served by the same Node.js process. The application talks to the server only through JSON requests "
               "under <font name='Mono'>/api</font>. The session token is kept in the browser's session storage, which is cleared "
               "when the browser is closed; it is never placed in a URL or a cookie."))
    s.append(P("On a phone the application can be installed to the home screen. A service worker caches only the application "
               "shell (the page, icons and built files) and never caches <font name='Mono'>/api</font> answers, because those contain "
               "personal and financial data. Inspectors and Kebele staff working in the field can record inspections and verification "
               "results without a connection: the request is kept in an outbox on the device and sent automatically when the "
               "connection returns. The server applies the same checks to a delayed request as to any other."))
    s.append(P("The camera (for QR scanning and photos) and the location (for on-site checks) are the only device features the "
               "application uses. The server's Permissions-Policy header forbids the microphone, payment, USB, serial and Bluetooth APIs."))
    s += H2("Application tier")
    s.append(P("The application tier is a Node.js (version 20 or later) process using the Express 5 framework. Its code is organised "
               "in layers; a request passes through them in the order of Figure 3."))
    s += figure(fig_pipeline(), "Processing of one API request")
    s.append(P("Step 5 does more than check the token signature. It loads the user from the database and refuses the request if the "
               "account is inactive, if the token's version no longer matches the user's (the user signed out, changed the password, "
               "or an administrator ended the sessions), if the user has been idle for more than 30 minutes, or if the user still holds "
               "a temporary password that must be replaced. Step 7 limits every query to the user's area; a record outside it answers "
               "404 Not Found, so its existence is not revealed."))
    s += H2("Data tier")
    s.append(P("MySQL 8 (or MariaDB 10.6 and later) with the InnoDB engine and the utf8mb4 character set holds 40 tables. The schema is "
               "created and upgraded only by numbered migration files (001 to 020 at the time of writing), so every installation has the "
               "same structure. Uploaded photos and documents are stored on disk under random file names, outside the web root, and "
               "are only served through an authenticated, scope-checked route. Backups are a compressed SQL dump plus a copy of the "
               "upload folder; each backup is read back after it is written to confirm it is usable."))

    # 4 -----------------------------------------------------------------
    s += H1("Key components")
    s.append(P("Table 2 lists the components that make up the system, what each is responsible for, and where it lives in the source "
               "code. Paths are relative to the project root."))
    s += table([["Component", "Responsibility", "Location"],
                ["Web client (SPA)", "All screens: dashboards, asset forms, approvals, verification, reports, administration. Three interface languages (English, Amharic, Afaan Oromo).", "frontend/src"],
                ["Service worker and outbox", "Opens the app without a connection; keeps field results until the network returns.", "frontend/public/sw.js, frontend/src/offline.js"],
                ["HTTP server and middleware", "Security headers, CORS, rate limits, body size limit, static files, error handler.", "backend/src/app.js, server.js"],
                ["Authentication", "Sign-in, account lockout, sessions, sign-out, password change, temporary passwords.", "backend/src/routes/auth.js, middleware/auth.js, lib/security.js"],
                ["Authorisation and scope", "Role permissions (editable by the Super Administrator), area scope, who may manage which accounts.", "backend/src/lib/permissions.js, lib/assetGuards.js"],
                ["Asset register", "Create, read, update, search, export; registration chain; photos and documents.", "backend/src/routes/assets.js, lib/assetQuery.js"],
                ["Asset operations", "Acquisition, assignment, ownership change, disposal, QR codes and labels, scanning, bulk import, duplicates.", "backend/src/routes/assetOps.js"],
                ["Approval engine", "Requests for transfer, disposal, retirement, assignment and ownership change; one or two steps; separation of duties.", "backend/src/lib/requests.js, routes/requests.js"],
                ["Physical verification", "Campaigns, results, discrepancies, corrections, CSV report.", "backend/src/routes/verification.js"],
                ["Finance", "Valuations, income, depreciation, finance overview.", "backend/src/lib/money.js, lib/depreciation.js, routes/finance.js"],
                ["Monthly reports", "Preparing frozen figures, sending up the chain, accepting or returning.", "backend/src/lib/monthlyReports.js, routes/monthlyReports.js"],
                ["Alerts and notifications", "21 notification types; in-app always, e-mail and SMS when configured.", "backend/src/lib/alerts.js, notify.js, channels.js"],
                ["Scheduler", "Hourly run of alerts and report reminders; optional daily backup.", "backend/src/lib/scheduler.js"],
                ["Audit trail", "Insert-only log of every change, sign-in, download and export.", "backend/src/lib/audit.js, routes/audit.js"],
                ["Public asset card", "The page a printed QR label opens without signing in.", "backend/src/lib/publicAsset.js, routes/public.js"],
                ["Integration API", "Read-only REST API for other City systems, with API keys and an OpenAPI description.", "backend/src/routes/integration.js"],
                ["AI assistant", "Chat window; server-side instructions; four read-only lookups run with the user's scope; any OpenAI-compatible AI service.", "frontend/src/components/Assistant.jsx, backend/src/routes/assistant.js, lib/assistant.js"],
                ["Administration", "Workflows, permissions, settings, system health, backups, API keys.", "backend/src/routes/admin.js, lib/backup.js"],
                ["Data access and schema", "Knex query builder, connection pool, migrations.", "backend/src/db.js, src/migrations"],
                ["Translations", "Dictionaries for Amharic and Afaan Oromo, served to the client.", "backend/src/i18n"]],
               [3.6, 8.2, 4.8])
    s.append(P("Table 2: Key components", "caption"))
    s += H2("Component dependencies")
    s.append(P("Dependencies run in one direction: route modules call domain services, and domain services call the data-access "
               "layer. No domain service calls a route, and the client never reaches the database or the file store except through "
               "the API. Cross-cutting rules have a single home so that they cannot drift apart: permissions and scope in "
               "<font name='Mono'>permissions.js</font>, input rules in <font name='Mono'>schemas.js</font> and "
               "<font name='Mono'>assetSchemas.js</font>, money rules in <font name='Mono'>money.js</font>, and the audit entry in "
               "<font name='Mono'>audit.js</font>."))
    s += H2("Third-party components")
    s += table([["Package", "Version", "Used for"],
                ["express", "5.2", "HTTP server and routing"],
                ["helmet", "8.3", "Security headers including the Content Security Policy"],
                ["jsonwebtoken", "9.0", "Signing and verifying session tokens (HS256)"],
                ["bcryptjs", "3.0", "Password hashing, cost factor 12"],
                ["knex, mysql2", "3.3, 3.24", "Query builder with bound parameters; MySQL driver"],
                ["zod", "4.6", "Validation of every request body and query"],
                ["multer", "2.4", "Receiving uploads (one file, 10 MB limit)"],
                ["nodemailer", "10.0", "Sending e-mail through the configured SMTP server"],
                ["qrcode", "1.5", "Drawing QR codes for asset labels"],
                ["csv-parse", "7.0", "Reading bulk-import files"],
                ["react, react-dom, react-router-dom", "19.3, 7.18", "User interface and client-side routing"],
                ["leaflet", "1.9", "The asset map"],
                ["html5-qrcode, jsbarcode", "2.3, 3.12", "Camera QR scanning; Code 128 barcodes on labels"]],
               [5.4, 2.4, 8.8])
    s.append(P("All versions are fixed in <font name='Mono'>package-lock.json</font>. On 25 October 2026 "
               "<font name='Mono'>npm audit</font> reported no known vulnerabilities in either the backend or the frontend."))

    # 5 -----------------------------------------------------------------
    s += H1("Deployment architecture")
    s.append(P("The system is designed to run on one Linux server in the City data centre. Figure 4 shows the recommended production "
               "layout. Only the reverse proxy is reachable from the network; the Node.js process and MySQL listen on the loopback "
               "interface."))
    s += figure(fig_deployment(), "Production deployment")
    s += table([["Item", "Minimum", "Recommended"],
                ["Processor", "2 cores", "4 cores"],
                ["Memory", "4 GB", "8 GB"],
                ["Disk", "100 GB", "250 GB SSD, encrypted, plus a separate disk or share for backups"],
                ["Operating system", "Any 64-bit Linux with Node.js 20", "Ubuntu Server 22.04 or 24.04 LTS"],
                ["Software", "Node.js 20+, MySQL 8 or MariaDB 10.6+, nginx", "Same, installed from the distribution's security-supported packages"],
                ["Network", "One public or LAN address, ports 80 and 443", "City domain name with a valid TLS certificate"]],
               [3.4, 5.6, 7.6])
    s.append(P("Table 3: Server requirements", "caption"))
    s.append(P("The environment used for the INSA assessment follows the same layout. Its address, the test accounts for each role and "
               "the test window are given in the covering letter (JCSAMS-LTR-000) and agreed with the assessment team before testing starts."))

    # 6 -----------------------------------------------------------------
    s += H1("Data flow design")
    s.append(P("This section describes how data enters the system, where it is processed and stored, and where it leaves. The diagrams "
               "use the Gane and Sarson notation: rectangles with a shadow are external entities, rounded boxes are processes, and "
               "open-ended rectangles are data stores."))
    s += H2("Context level (level 0)")
    s += figure(fig_dfd0(), "Data flow diagram, level 0")
    s.append(P("At the highest level the system receives credentials, asset data, documents, decisions and field results from City "
               "staff and returns lists, records, dashboards and alerts. Anonymous visitors send only a label token and receive the "
               "public card. City systems send an API key and a query and receive asset, location and classification data without any "
               "money figures. The system sends notification messages to the e-mail and SMS services and backup archives to the "
               "backup storage."))
    s += H2("Main processes (level 1)")
    s += figure(fig_dfd1(), "Data flow diagram, level 1")
    s.append(P("Figure 6 breaks the system into eight processes and eight data stores. The stores are logical groupings of the 40 "
               "physical tables; the mapping is in Table 4."))
    s += table([["Store", "Holds", "Physical tables"],
                ["D1 Users, roles, permissions", "Accounts, password hashes, lock state, areas, role permissions, API keys", "users, user_kifle_ketemas, user_kebeles, user_sectors, role_permissions, api_keys"],
                ["D2 Asset register", "The current record of each asset and the master lists", "assets, asset_categories, asset_types, sectors, departments, kifle_ketemas, kebeles"],
                ["D3 Asset history records", "Everything that happened to an asset", "maintenance_records, inspection_records, asset_transfers, asset_assignments, asset_ownership_history, asset_valuations, asset_revenues, asset_acquisitions, asset_disposals, utilizations, asset_reservations, asset_site_checks, follow_up_actions, scan_events, verification_campaigns, verification_items, asset_retired_labels"],
                ["D4 Documents and photos", "File metadata in the database; the files on disk", "asset_documents, upload folder"],
                ["D5 Approval requests", "Requests and their decisions", "approval_requests, workflow_configs"],
                ["D6 Monthly reports", "Reports with their frozen figures", "monthly_reports, report_schedules"],
                ["D7 Notifications", "Messages per user and their delivery status", "notifications, notification_rules"],
                ["D8 Audit log", "Who did what, when, with old and new values", "audit_logs"]],
               [3.8, 5.0, 7.8])
    s.append(P("Table 4: Logical data stores and physical tables", "caption"))
    s.append(P("Table 5 shows which process creates (C), reads (R), updates (U) or deletes (D) data in each store. A process that is "
               "not allowed to touch a store has an empty cell; this is the same rule the server enforces through permissions."))
    s += table([["Process", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"],
                ["1.0 Authenticate and manage accounts", "CRU", "R", "", "", "", "", "C", "C"],
                ["2.0 Register and approve assets", "R", "CRUD*", "C", "CRUD*", "", "", "C", "C"],
                ["3.0 Inspect, maintain, transfer, dispose", "R", "RU", "CRU", "C", "CRU", "", "C", "C"],
                ["4.0 Verify physically", "R", "RU", "CRU", "C", "", "", "C", "C"],
                ["5.0 Record valuations and income", "R", "RU", "C", "", "", "", "", "C"],
                ["6.0 Prepare and decide monthly reports", "R", "R", "R", "", "R", "CRU", "C", "C"],
                ["7.0 Generate alerts and notifications", "R", "R", "R", "R", "R", "R", "CRU", ""],
                ["8.0 Analyse, search and export", "R", "R", "R", "R", "R", "", "", "C"]],
               [6.0, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3])
    s.append(P("Table 5: Process and data store access (C create, R read, U update, D delete). * Delete only for a draft that was never submitted, by the person who created it.", "caption"))
    s += H2("Asset registration (level 2 of process 2.0)")
    s.append(P("Registration is the flow that matters most for the integrity of the register, so it is drawn in more detail in Figure 7. "
               "Each step is taken by a different person, and the system refuses a step from someone who has already taken an earlier "
               "step on the same asset."))
    s += figure(fig_dfd2(), "Data flow diagram, level 2: asset registration and approval")
    s += figure(fig_states(), "Approval states of a newly registered asset")
    s += H2("Data flow explanation")
    s.append(P("Table 6 describes each important data flow: what is carried, between which parts, and how it is protected. The "
               "identifiers are used in the Security Documentation when describing threats to each flow."))
    s += table([["ID", "Flow", "Data carried", "Protection"],
                ["F1", "Staff browser to API: sign-in", "Username and password", "TLS; rate limit 20 per minute per address; account lock after 5 failures; same answer and timing for unknown users; password never logged."],
                ["F2", "API to browser: session", "Signed JWT (user id, token version, 8-hour expiry)", "TLS; kept in session storage only; no-store caching; invalidated on sign-out, password change, role change or deactivation."],
                ["F3", "Browser to API: asset registration", "Asset details, GPS point, photos, documents", "Role and area check; schema validation; file content check by signature; 10 MB limit; random stored name; audit entry."],
                ["F4", "Kebele Administrator to API: site check", "Found / not found, notes, GPS, photo", "Only for assets of their own Kebele; refused if the same person registered the asset."],
                ["F5", "Kifle Ketema Administrator to API: decision", "Approve or return, reason", "Only for their own Kifle Ketema; refused if the same person reviewed it; state change and audit entry in one transaction."],
                ["F6", "Inspector / Financial Officer to API", "Inspection results; valuations and income", "Only Inspectors may record inspections; only Financial Officers may record money; area of the assigned Kifle Ketemas only; dates cannot be in the future."],
                ["F7", "Field device outbox to API", "Delayed inspection and verification results", "Sent with the user's current token; the same checks as F6; refused results stay on the device and are shown to the user."],
                ["F8", "API to database", "Queries and changes", "Bound parameters through Knex; the application database user has data rights only; MySQL on localhost."],
                ["F9", "API to file store", "Photos and documents", "Outside the web root; served only through an authenticated route that checks the user's area; downloads are logged and sent as attachments."],
                ["F10", "Visitor to public card", "Label token; public card", "Rate limit 120 per minute; token pattern check; only safe fields returned; replaced labels answer \"label replaced\"."],
                ["F11", "API client to integration API", "API key; asset, location and classification data", "Key stored only as a SHA-256 hash; read-only; no money figures; key can be disabled at once."],
                ["F12", "API to e-mail / SMS service", "Notification text, temporary passwords for new accounts", "SMTP with TLS where the server offers it; the server log records only the recipient and message length, never the text."],
                ["F13", "Sender to receiver: monthly report", "Frozen figures, comments, decision", "Visible only to the sender and the direct superior; accepted reports are locked; money only for roles that may see it."],
                ["F14", "Server to backup storage", "SQL dump and file copy", "Written by the server, read back to verify; copying off-site is an operator task on an encrypted medium."],
                ["F15", "Server to AI service and back", "The question, the server's instructions, results of read-only lookups; the answer", "Off unless configured; HTTPS to cloud services or loopback to a local model; lookups scoped to the user and money masked; no write functions; 10 questions/min per person; audit entry without the question text. Free cloud tiers may keep the data: City decision required (SRS OI-8)."]],
               [1.0, 3.6, 4.0, 8.0])
    s.append(P("Table 6: Data flows and their protection", "caption"))
    s += H2("Sequence of a sign-in and an authenticated request")
    s += figure(fig_seq_login(), "Sign-in, an authenticated request and sign-out")
    s += H2("Sequence of a QR label scan")
    s += figure(fig_seq_scan(), "Public QR card and in-app scanning")
    s += H2("AI assistant")
    s.append(P("The assistant is part of process 8.0 (analyse, search and export). The browser sends only the conversation; the "
               "server adds its own instructions, a short guide to the system and four lookup functions, and sends them to the "
               "configured AI service. When the model asks for a lookup, the server runs it as the signed-in user, through the same "
               "scoped queries the screens use, and returns the result to the model as data. The model never reaches the database "
               "and has no function that writes. Figure 11 shows one question."))
    s += figure(fig_ai(), "One question to the AI assistant")

    # 7 -----------------------------------------------------------------
    s += H1("Data design")
    s += H2("Core entities and relationships")
    s.append(P("Figure 12 shows the core entities. The asset sits at the centre; everything that happens to it is a separate child "
               "record, so the asset row holds the current state and the child tables hold the history. Location is modelled as a "
               "hierarchy (Kifle Ketema, Kebele) and is kept separate from classification (category, type) and from organisation "
               "(sector, department)."))
    s += figure(fig_erd(), "Core entity-relationship diagram (simplified)")
    s += H2("Design rules for data")
    s += bullets([
        "<b>One asset, one record.</b> An asset is never duplicated because its use or its revenue changes. Use is recorded in utilizations; income is recorded against the asset with its type.",
        "<b>Nothing is silently overwritten.</b> Transfers, assignments, ownership changes, valuations, condition and status keep every earlier value in their history tables.",
        "<b>The audit log is insert-only.</b> The application has no code path that updates or deletes an audit entry, and the API offers no such operation.",
        "<b>Constraints in the database as well as in the code.</b> Foreign keys, unique keys (Asset ID, username, public token) and check constraints (for example non-negative money) are defined in the migrations, so bad data is refused even if a code check were missed.",
        "<b>Disposed assets are locked.</b> After disposal the record can be read and archived but not changed.",
        "<b>Working labels are marked.</b> Master data that the City has not yet confirmed officially (some sectors and categories) is flagged and shown as a working label.",
    ])
    s += H2("Data classification")
    s += table([["Class", "Examples", "Who can see it"],
                ["Public", "Asset name, category, sector, Kebele, condition, status, photos (public card only)", "Anyone holding the asset's label token"],
                ["Internal", "Full asset record, history, documents other than financial ones", "Staff whose area covers the asset"],
                ["Confidential: financial", "Acquisition cost, valuations, depreciation, income; purchase, invoice and contract documents", "Roles with the financial permission, within their area"],
                ["Confidential: personal", "Names, phone numbers, e-mail addresses, profile photos of staff", "The account's manager in the hierarchy, the Internal Auditor (read-only), the person themselves"],
                ["Secret", "Password hashes, JWT secret, API key hashes, database credentials", "Never returned by the API; held only in the database or the server configuration"]],
               [3.6, 7.6, 5.4])

    # 8 -----------------------------------------------------------------
    s += H1("Design decisions")
    s.append(P("The decisions below shaped the system. Each was discussed with the City project team; the reason is recorded so that a "
               "later change can be judged against it."))
    decisions = [
        ("Asset management first, rent as a later module",
         "The City first proposed a rent revenue system. We found that rent is one use of an asset, and that many assets (an ambulance, an office) earn nothing. Building the asset register first means rent, agriculture and other revenue modules can later use the same asset identity instead of each keeping its own copy."),
        ("One role per level, with an assigned area",
         "The 13 Kebeles do not become 13 roles. There is one Kebele Administrator role, and each account is assigned one Kebele. Adding a Kebele is data, not code."),
        ("Separation of duties in the registration chain",
         "The person who registers an asset cannot verify it, and the person who verifies it cannot approve it. This prevents a single person from creating a fictitious asset or hiding a missing one."),
        ("404 instead of 403 outside the user's area",
         "If a Kebele Administrator asks for an asset in another Kebele, the answer is \"not found\". A \"forbidden\" answer would confirm that the asset exists, which is itself information."),
        ("Re-reading the user on every request",
         "This costs one indexed query per request but means a deactivated account, a role change or a changed permission takes effect immediately rather than when the token expires."),
        ("No money on the public card or in the integration API",
         "Values and income are confidential. Other City systems that need them must ask for a separate, agreed interface."),
        ("A single server process",
         "The City's ICT team will operate the system. A single process with MySQL is something they can run, back up and restore themselves. The cost is that rate-limit counters live in memory; this is documented and acceptable for one server."),
        ("Offline recording, online reading",
         "Field staff in parts of the City with weak coverage must still be able to record inspections. Reading the register offline would mean storing personal and financial data on phones, so it was deliberately left out."),
        ("A read-only AI assistant that works with any provider",
         "The assistant helps staff who are new to computers, in their own language. It is read-only and runs every lookup as the user, so it cannot become a way around the permissions. It uses the common OpenAI-compatible interface so the City can choose a free cloud service now and a model on its own server later, without code changes."),
    ]
    for t, why in decisions:
        s += H2(t)
        s.append(P(why))

    # 9 -----------------------------------------------------------------
    s += H1("Quality attributes")
    s += H2("Security")
    s.append(P("Security is described fully in JCSAMS-SEC-005. Figure 13 shows the trust boundaries the design relies on: every request "
               "crosses TB1 encrypted, only the proxy crosses TB2, and only the application crosses TB3."))
    s += figure(fig_trust(), "Trust boundaries")
    s += H2("Performance")
    s.append(P("Lists are paged on the server and every list query is a single SQL statement with joins; no list issues one query per "
               "row. Columns used for filtering and scope (Kebele, Kifle Ketema, sector, status, approval state, asset code, public token) "
               "are indexed. The system has not yet been load-tested with the City's full volume of assets, photos and history; that test "
               "is planned before go-live and is listed as an open item in the SRS."))
    s += H2("Availability and recovery")
    s.append(P("The Node.js service is restarted automatically by systemd if it stops. A database and file backup can be taken on demand "
               "or daily; each backup is verified by reading it back, and the administration screen warns when the last good backup is "
               "too old. A restore script rebuilds the database from a backup. The recovery point is at most one day with daily "
               "backups; the recovery time on the recommended server is under one hour for the expected data size."))
    s += H2("Maintainability")
    s.append(P("The backend has 265 automated tests in 16 files that run against a separate test database. They cover sign-in and "
               "lockout, access by role and area, the approval chain and separation of duties, validation, uploads, monthly reports, "
               "verification, notifications, backups and the public card. All 265 passed on 25 October 2026. Schema changes are made "
               "only through numbered migrations, and translations are kept in plain JSON dictionaries that the City's language staff can edit."))
    s += H2("Usability and language")
    s.append(P("The interface is available in English, Amharic and Afaan Oromo, chosen at sign-in or from the menu. Monthly reports "
               "follow the Ethiopian calendar by default. The layout adapts to phone screens, and the forms check each field as it "
               "is typed (names accept only letters, phone numbers only digits up to their length, money only valid amounts)."))

    # 10 ----------------------------------------------------------------
    s += H1("Constraints, assumptions and open items")
    s += table([["#", "Item", "Status"],
                ["1", "Which Kifle Ketema each of the 13 Kebeles belongs to must be confirmed by the City. Until it is, assets cannot be registered in an unassigned Kebele.", "Open: City to confirm"],
                ["2", "The official list of asset categories and revenue classifications is still a working list.", "Open: City to confirm"],
                ["3", "Production requires HTTPS with a certificate for the City's domain; without it, phone cameras and location will not work.", "Planned for deployment"],
                ["4", "E-mail and SMS delivery depend on the City providing an SMTP server and an SMS gateway.", "Open: City ICT"],
                ["5", "Load testing with the full City data volume.", "Planned before go-live"],
                ["6", "Two-factor sign-in and single sign-on with other City systems are not in this release.", "Next phase"],
                ["7", "The Amharic and Afaan Oromo translations should be reviewed by the City's language staff before official use.", "Open: City"]],
               [0.8, 12.0, 3.8])
    return s


from figs_sdd import fig_context, fig_dfd0, fig_dfd1, fig_erd, fig_dfd2  # redrawn versions

if __name__ == "__main__":
    out = os.path.join(OUT, "02_SDD_System_Architecture_Design.pdf")
    doc = Doc(out, CODE, TITLE)
    build(doc, story())
    print(out)
