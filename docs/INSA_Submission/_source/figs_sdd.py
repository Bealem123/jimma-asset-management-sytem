"""Redrawn SDD figures (cleaner routing). Imported at the end of sdd.py so these replace the first drafts."""
from common import *


def _lbl(d, x, y, text, size=7.3, anchor="middle", color=GREY, font="Body"):
    for i, ln in enumerate(text.split("\n")):
        d.add(String(x, y - i * size * 1.2, ln, fontName=font, fontSize=size, fillColor=color, textAnchor=anchor))


def fig_context():
    d = Drawing(470, 370)
    box(d, 186, 140, 98, 96, "Jimma City Smart Asset Management System\n(web app and REST API)", fill=F_PROC, stroke=TEAL, size=8.4)
    left = [(312, "Sector, Kebele and Kifle Ketema Administrators"), (246, "Mayor / Executive and Internal Auditor"),
            (180, "Financial Officers and Inspectors"), (114, "Super Administrator"), (40, "Citizen who scans a QR label (no account)")]
    right = [(312, "SMTP e-mail server"), (246, "SMS gateway (HTTP)"), (180, "Map tile services (OpenStreetMap, Esri)"),
             (114, "Authorised City systems (read-only API)"), (40, "Off-site backup storage")]
    for y, t in left:
        entity(d, 2, y, 96, 40, t, 7.8)
    for y, t in right:
        entity(d, 372, y, 96, 40, t, 7.8)
    # left side: each entity's flow ends on the box's left edge at its own height
    ly = {312: 224, 246: 206, 180: 188, 114: 170, 40: 150}
    labels_l = {312: "register, verify,\napprove assets", 246: "dashboards,\nreports, audit log", 180: "valuations, income,\ninspections",
                114: "accounts, master\ndata, settings", 40: "label token,\npublic card"}
    lx = {312: 166, 246: 152, 180: 152, 114: 152, 40: 166}
    for y, t in left:
        x = lx[y]
        d.add(Line(98, y + 20, x, y + 20, strokeColor=NAVY, strokeWidth=0.85))
        d.add(Line(x, y + 20, x, ly[y], strokeColor=NAVY, strokeWidth=0.85))
        arrow(d, x, ly[y], 186, ly[y])
        arrow(d, x, y + 20, 98, y + 20)
        _lbl(d, 128, y + 30, labels_l[y], size=7)
    # right side
    ry = {312: 224, 246: 206, 180: 188, 114: 170, 40: 150}
    rx = {312: 304, 246: 318, 180: 318, 114: 318, 40: 304}
    labels_r = {312: "e-mail\nnotifications", 246: "SMS\nnotifications", 180: "tiles (fetched by\nthe browser)", 114: "asset and\nlocation data", 40: "database dump,\nfile copies"}
    for y, t in right:
        x = rx[y]
        dash = [3, 2] if y == 180 else None
        d.add(Line(284, ry[y], x, ry[y], strokeColor=NAVY, strokeWidth=0.85, strokeDashArray=dash))
        d.add(Line(x, ry[y], x, y + 20, strokeColor=NAVY, strokeWidth=0.85, strokeDashArray=dash))
        if y == 180:
            arrow(d, 372, y + 20, x, y + 20, dash=dash)
        else:
            arrow(d, x, y + 20, 372, y + 20, both=(y == 114))
        _lbl(d, 348, y + 30, labels_r[y], size=7)
    legend(d, 110, 4, [("entity", "external entity"), ("box", "the system"), ("flow", "data flow"), ("dashed", "fetched by the browser")])
    return d


def fig_dfd0():
    d = Drawing(470, 290)
    process(d, 180, 40, 110, 210, "0", "Manage Jimma City assets (JCSAMS)", 8.6)
    entity(d, 2, 176, 100, 70, "City staff\n(8 roles)", 8.4)
    entity(d, 2, 44, 100, 46, "QR label scanner\n(public, no account)", 8)
    entity(d, 368, 206, 100, 40, "E-mail and SMS\nservices", 8)
    entity(d, 368, 120, 100, 52, "City systems\n(API clients)", 8)
    entity(d, 368, 40, 100, 40, "Backup storage", 8)
    arrow(d, 102, 228, 180, 228)
    _lbl(d, 141, 268, "credentials, asset data,\ndocuments, decisions,\nfield results, reports", 7)
    arrow(d, 180, 194, 102, 194)
    _lbl(d, 141, 184, "lists, records,\ndashboards, alerts", 7)
    arrow(d, 102, 76, 180, 76)
    _lbl(d, 141, 82, "label token", 7)
    arrow(d, 180, 58, 102, 58)
    _lbl(d, 141, 48, "public asset card", 7)
    arrow(d, 290, 226, 368, 226)
    _lbl(d, 329, 232, "notification messages", 7)
    arrow(d, 368, 160, 290, 160)
    _lbl(d, 329, 166, "API key, query", 7)
    arrow(d, 290, 132, 368, 132)
    _lbl(d, 329, 122, "asset data (no money)", 7)
    arrow(d, 290, 60, 368, 60)
    _lbl(d, 329, 66, "backup archive", 7)
    legend(d, 120, 4, [("entity", "external entity"), ("process", "process"), ("flow", "data flow")])
    return d


def fig_dfd1():
    d = Drawing(470, 640)
    W_P, XL, XR, XS, W_S = 112, 34, 324, 179, 112
    rows = {1: 488, 2: 372, 3: 256, 4: 140}
    H = 60
    # top entities
    entity(d, 0, 588, 104, 36, "Sector\nAdministrator", 8)
    entity(d, 183, 588, 104, 36, "Kebele / Kifle Ketema\nAdministrators", 7.8)
    entity(d, 366, 588, 104, 36, "Inspector /\nFinancial Officer", 8)
    # bottom entities
    entity(d, 0, 4, 104, 36, "Super\nAdministrator", 8)
    entity(d, 183, 4, 104, 36, "Mayor / Internal\nAuditor", 8)
    entity(d, 366, 4, 104, 36, "E-mail / SMS\nservices", 8)
    # processes
    process(d, XL, rows[1], W_P, H, "2.0", "Register and approve assets", 8)
    process(d, XR, rows[1], W_P, H, "3.0", "Inspect, maintain, transfer, dispose", 8)
    process(d, XL, rows[2], W_P, H, "4.0", "Verify physically (campaigns, QR scan)", 8)
    process(d, XR, rows[2], W_P, H, "5.0", "Record valuations and income", 8)
    process(d, XL, rows[3], W_P, H, "1.0", "Authenticate and manage accounts", 8)
    process(d, XR, rows[3], W_P, H, "7.0", "Generate alerts and notifications", 8)
    process(d, XL, rows[4], W_P, H, "6.0", "Prepare and decide monthly reports", 8)
    process(d, XR, rows[4], W_P, H, "8.0", "Analyse, search and export", 8)
    # stores: two per row, aligned with the processes
    st = {
        "D2": (rows[1] + 34, "Asset register"), "D4": (rows[1] + 4, "Documents, photos"),
        "D3": (rows[2] + 34, "Asset history"), "D5": (rows[2] + 4, "Approval requests"),
        "D1": (rows[3] + 34, "Users and roles"), "D7": (rows[3] + 4, "Notifications"),
        "D6": (rows[4] + 34, "Monthly reports"), "D8": (rows[4] + 4, "Audit log"),
    }
    for k, (y, t) in st.items():
        store(d, XS, y, W_S, 22, k, t, 7.8)
    mid = lambda k: st[k][0] + 11
    L_end, R_start = XL + W_P, XR
    # process <-> store (short horizontal flows)
    arrow(d, L_end, mid("D2"), XS, mid("D2"), both=True)
    arrow(d, L_end, mid("D4"), XS, mid("D4"))
    arrow(d, R_start, mid("D2"), XS + W_S, mid("D2"), both=True)
    arrow(d, R_start, mid("D4"), XS + W_S, mid("D4"))
    arrow(d, L_end, mid("D3"), XS, mid("D3"), both=True)
    arrow(d, L_end, mid("D5"), XS, mid("D5"))
    arrow(d, R_start, mid("D3"), XS + W_S, mid("D3"))
    arrow(d, L_end, mid("D1"), XS, mid("D1"), both=True)
    arrow(d, R_start, mid("D7"), XS + W_S, mid("D7"))
    arrow(d, L_end, mid("D6"), XS, mid("D6"), both=True)
    arrow(d, XS + W_S, mid("D8"), R_start, mid("D8"))
    # top entities -> processes
    arrow(d, 52, 588, 52, rows[1] + H)
    _lbl(d, 56, 572, "asset details,\nphotos, documents", 7, anchor="start")
    # Kebele / Kifle: one line down to 2.0 and a lane on the left down to 4.0
    d.add(Line(205, 588, 205, 566, strokeColor=NAVY, strokeWidth=0.85))
    d.add(Line(205, 566, 130, 566, strokeColor=NAVY, strokeWidth=0.85))
    arrow(d, 130, 566, 130, rows[1] + H)
    d.add(Line(130, 566, 16, 566, strokeColor=NAVY, strokeWidth=0.85))
    d.add(Line(16, 566, 16, rows[2] + 30, strokeColor=NAVY, strokeWidth=0.85))
    arrow(d, 16, rows[2] + 30, XL, rows[2] + 30)
    _lbl(d, 168, 558, "site checks,\ndecisions", 7)
    _lbl(d, 12, 470, "campaigns,\nresults", 6.8, anchor="end") if False else _lbl(d, 18, 452, "stock-\ntaking", 6.8, anchor="start")
    # Inspector / Financial Officer: down to 3.0 and a lane on the right down to 5.0
    arrow(d, 400, 588, 400, rows[1] + H)
    _lbl(d, 404, 572, "inspection\nresults", 7, anchor="start")
    d.add(Line(452, 588, 452, rows[2] + 30, strokeColor=NAVY, strokeWidth=0.85))
    arrow(d, 452, rows[2] + 30, XR + W_P, rows[2] + 30)
    _lbl(d, 450, 452, "valua-\ntions,\nincome", 6.8, anchor="end")
    # Super Administrator: up the left lane to 1.0
    d.add(Line(16, 40, 16, rows[3] + 30, strokeColor=NAVY, strokeWidth=0.85))
    arrow(d, 16, rows[3] + 30, XL, rows[3] + 30)
    _lbl(d, 18, 112, "accounts,\nsettings", 6.8, anchor="start")
    # 6.0 <-> Mayor / Auditor (reports and decisions)
    arrow(d, 90, rows[4], 90, 112, both=False) if False else None
    d.add(Line(90, rows[4], 90, 96, strokeColor=NAVY, strokeWidth=0.85))
    d.add(Line(90, 96, 214, 96, strokeColor=NAVY, strokeWidth=0.85))
    arrow(d, 214, 96, 214, 40, both=False)
    arrow(d, 236, 40, 236, 86)
    d.add(Line(236, 86, 110, 86, strokeColor=NAVY, strokeWidth=0.85))
    arrow(d, 110, 86, 110, rows[4])
    _lbl(d, 152, 102, "reports", 7)
    _lbl(d, 150, 76, "accept / return", 7)
    # 8.0 -> Mayor / Auditor
    d.add(Line(360, rows[4], 360, 70, strokeColor=NAVY, strokeWidth=0.85))
    d.add(Line(360, 70, 262, 70, strokeColor=NAVY, strokeWidth=0.85))
    arrow(d, 262, 70, 262, 40)
    _lbl(d, 310, 60, "dashboards, CSV,\nindicators", 7)
    # 7.0 -> e-mail / SMS: right lane down
    d.add(Line(XR + W_P, rows[3] + 30, 452, rows[3] + 30, strokeColor=NAVY, strokeWidth=0.85))
    arrow(d, 452, rows[3] + 30, 452, 40)
    _lbl(d, 450, 200, "mes-\nsages", 6.8, anchor="end")
    # notes
    _lbl(d, 235, 128, "Every process also writes D8. Processes 6.0, 7.0 and 8.0 read D2 and D3.", 7, font="Body-Italic")
    return d


def fig_erd():
    d = Drawing(470, 445)

    def ent(x, y, w, name, fields):
        h = 20 + 11 * len(fields)
        d.add(Rect(x, y, w, h, fillColor=colors.white, strokeColor=NAVY, strokeWidth=0.9))
        d.add(Rect(x, y + h - 16, w, 16, fillColor=HEADBG, strokeColor=NAVY, strokeWidth=0.9))
        d.add(String(x + w / 2, y + h - 11.5, name, fontName="Body-Bold", fontSize=8.2, fillColor=NAVY, textAnchor="middle"))
        for i, f in enumerate(fields):
            d.add(String(x + 5, y + h - 28 - i * 11, f, fontName="Body", fontSize=7.3, fillColor=INK))
        return (x, y, w, h)

    ent(4, 392, 104, "kifle_ketemas", ["PK id", "name"])
    ent(4, 318, 104, "kebeles", ["PK id", "name", "FK kifle_ketema_id"])
    ent(4, 244, 104, "sectors / departments", ["PK id", "code, name", "FK sector_id (dept.)"])
    ent(4, 170, 104, "categories / types", ["PK id", "name", "FK category_id (type)"])
    ent(4, 72, 104, "users", ["PK id", "username, names", "role, is_active", "token_version", "lock / expiry fields"])
    ent(4, 4, 104, "user area links", ["FK user_id", "FK kifle_ketema_id /", "kebele_id / sector_id"])
    ent(172, 230, 128, "assets", ["PK id", "UK asset_code (AST-)", "FK category, type", "FK sector, department", "FK kifle_ketema, kebele", "condition, status", "approval_state", "acquisition_cost", "UK public_token", "FK created/submitted/..._by"])
    ent(172, 380, 128, "monthly_reports", ["PK id, FK user_id", "period_key, snapshot", "status, version"])
    ent(172, 120, 128, "approval_requests", ["PK id, FK asset_id", "request_type, payload", "status", "FK requested_by", "FK reviewed/decided_by"])
    ent(172, 30, 128, "audit_logs", ["PK id, FK user_id", "action, entity, changes"])
    kids = [(380, "maintenance / inspection"), (312, "transfers / assignments"), (244, "valuations / revenues"),
            (176, "asset_documents"), (108, "verification_items")]
    for y, n in kids:
        ent(362, y, 104, n, ["PK id", "FK asset_id", "dates, recorded_by"])

    import math

    def rel(x1, y1, x2, y2):
        d.add(Line(x1, y1, x2, y2, strokeColor=GREY, strokeWidth=0.8))
        a = math.atan2(y1 - y2, x1 - x2)
        for da in (-0.45, 0, 0.45):
            d.add(Line(x2, y2, x2 + 9 * math.cos(a + da), y2 + 9 * math.sin(a + da), strokeColor=GREY, strokeWidth=0.8))
        d.add(Line(x1 + 6 * math.cos(a + math.pi) - 3 * math.sin(a), y1 + 6 * math.sin(a + math.pi) + 3 * math.cos(a),
                   x1 + 6 * math.cos(a + math.pi) + 3 * math.sin(a), y1 + 6 * math.sin(a + math.pi) - 3 * math.cos(a), strokeColor=GREY, strokeWidth=0.8))

    rel(56, 392, 56, 371)
    rel(108, 410, 172, 345)
    rel(108, 345, 172, 330)
    rel(108, 270, 172, 305)
    rel(108, 196, 172, 270)
    rel(56, 72, 56, 57)
    rel(108, 130, 172, 250)
    rel(108, 110, 172, 160)
    rel(108, 95, 172, 55)
    rel(108, 140, 172, 400)
    rel(236, 230, 236, 195)
    for y, _ in kids:
        rel(300, 300, 362, y + 26)
    _lbl(d, 116, 12, "Crow's foot = many; bar = one.  UK = unique key.  Every child table also records who added the row and when.", 7.2, anchor="start", font="Body-Italic")
    return d


def fig_dfd2():
    d = Drawing(470, 312)
    entity(d, 4, 240, 104, 36, "Sector\nAdministrator", 8)
    entity(d, 182, 248, 104, 36, "Kebele\nAdministrator", 8)
    entity(d, 362, 240, 104, 36, "Kifle Ketema\nAdministrator", 8)
    process(d, 4, 140, 104, 62, "2.1", "Capture draft\n(validated)", 8)
    process(d, 126, 140, 104, 62, "2.2", "Submit for\nverification", 8)
    process(d, 244, 140, 104, 62, "2.3", "Verify on site\n(or send back)", 8)
    process(d, 362, 140, 104, 62, "2.4", "Approve and\nactivate", 8)
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
    _lbl(d, 235, 302, "Dashed: a returned asset goes back to DRAFT with a reason, and the next person is notified (D7). Every step is written to D8.", 7.2, font="Body-Italic")
    return d
