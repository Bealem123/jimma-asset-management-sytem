"""One hand-over PDF per INSA test account, plus an overview without passwords.
Reads backend/credentials/insa-test-accounts.json (written by npm run insa:setup) and deletes it afterwards."""
import json, os, datetime
from common import *
from reportlab.platypus import SimpleDocTemplate

SRC = os.path.join(ROOT, "backend", "credentials", "insa-test-accounts.json")
DEST = os.path.join(ROOT, "backend", "credentials", "insa-test-accounts")
os.makedirs(DEST, exist_ok=True)

CAN = {
    "SUPER_ADMIN": (["Create and manage Kifle Ketema Administrator, Mayor, Internal Auditor, Financial Officer and Inspector accounts",
                     "Master data, workflows, role permissions, notification rules, settings, backups, API keys", "Read the audit log"],
                    ["Register, edit, verify or approve assets", "See money figures", "Open monthly reports"]),
    "EXECUTIVE": (["Read the whole City: dashboards, analytics, performance, money", "Accept or return the monthly reports sent to the Mayor"],
                  ["Change any asset or account", "Read the audit log", "System administration"]),
    "AUDITOR": (["Read everything, including money, the audit log and every user account with its history", "Send a monthly report to the Mayor"],
                ["Change anything at all (all access is read-only)"]),
    "KIFLE_ADMIN": (["Approve and activate assets, decide requests, approve verification corrections in its own Kifle Ketema",
                     "Create and manage the Kebele Administrators of its Kifle Ketema", "Follow the Inspectors of its Kifle Ketema"],
                    ["Register or edit assets", "See or act on the other Kifle Ketemas (answer 404)", "Approve an asset it verified itself"]),
    "KEBELE_ADMIN": (["Verify newly registered assets on site, review requests, run stock-taking in its own Kebele",
                      "Create and manage the Sector Administrators of its Kebele"],
                     ["Approve or activate assets", "See other Kebeles (answer 404)", "Verify an asset it registered itself"]),
    "SECTOR_ADMIN": (["Register and maintain the assets of its sector in its Kebele; raise transfer, disposal and other requests"],
                     ["Verify, approve or inspect assets", "Manage user accounts", "See other sectors or Kebeles (answer 404)"]),
    "FINANCIAL_OFFICER": (["See money and record valuations and income for assets in its Kifle Ketema"],
                          ["Register, edit or approve assets", "Act outside its Kifle Ketema (answer 404)"]),
    "INSPECTOR": (["Record inspections (the only role that can) and stock-taking results in its Kifle Ketema"],
                  ["See money figures", "Register, edit or approve assets", "Act outside its Kifle Ketema (answer 404)"]),
}

data = json.load(open(SRC, encoding="utf-8"))
created = datetime.datetime.fromisoformat(data["created_at"].replace("Z", "+00:00"))
valid_until = (created + datetime.timedelta(days=data["valid_days"])).strftime("%d %B %Y")
issued = created.strftime("%d %B %Y")
accounts = data["accounts"]
N = len(accounts)


def page(c, d):
    W, H = A4
    c.saveState()
    c.setFillColor(colors.HexColor("#B42318")); c.rect(0, H - 1.1 * cm, W, 1.1 * cm, stroke=0, fill=1)
    c.setFont("Body-Bold", 10); c.setFillColor(colors.white)
    c.drawString(2.2 * cm, H - 0.72 * cm, "CONFIDENTIAL: test account credentials")
    c.drawRightString(W - 2.2 * cm, H - 0.72 * cm, "INSA security assessment")
    c.setFont("Body", 8.3); c.setFillColor(GREY)
    c.drawString(2.2 * cm, 1.1 * cm, f"{SYSTEM}  |  test copy  |  issued by Banmen Technologies, {issued}")
    c.restoreState()


def sheet(i, a):
    st = []
    if os.path.exists(LOGO):
        img = Image(LOGO, width=1.8 * cm, height=1.8 * cm); img.hAlign = "LEFT"; st.append(img)
    st.append(Spacer(1, 4))
    st.append(Paragraph(f"Test account {i} of {N}", ParagraphStyle("k", fontName="Body-Bold", fontSize=10, textColor=TEAL, leading=13)))
    st.append(Paragraph(a["role_label"], ParagraphStyle("t", fontName="Head", fontSize=22, leading=26, textColor=NAVY, spaceAfter=4)))
    st.append(Paragraph(a["area"], ParagraphStyle("a", fontName="Body", fontSize=12, leading=15, textColor=GREY, spaceAfter=14)))

    cred = Table([
        [Paragraph("Username", ss["cellb"]), Paragraph(f"<font name='Mono' size='13'>{a['username']}</font>", ss["cell"])],
        [Paragraph("Temporary password", ss["cellb"]), Paragraph(f"<font name='Mono' size='15'><b>{a['password']}</b></font>", ss["cell"])],
        [Paragraph("Valid until", ss["cellb"]), Paragraph(f"{valid_until} (the temporary password stops working after this date)", ss["cell"])],
        [Paragraph("Test address", ss["cellb"]), Paragraph("_______________________________________________<br/><font size='8'>given by Banmen Technologies with this sheet</font>", ss["cell"])],
    ], colWidths=[4.4 * cm, 12.2 * cm], hAlign="LEFT")
    cred.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1.2, NAVY), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                              ("BACKGROUND", (0, 0), (0, -1), SHADE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                              ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    st += [cred, Spacer(1, 12)]

    st.append(P("<b>First sign-in.</b> Open the test address, sign in with the username and temporary password above, then choose your own "
                "password (at least 8 characters with an upper-case letter, a lower-case letter, a number and a symbol). Until you do, the "
                "account can do nothing else. After 5 wrong passwords the account locks for 15 minutes; a session ends after 30 minutes "
                "without activity.", "bodyL"))
    can, cannot = CAN[a["role"]]
    st.append(P("<b>This role is designed to be able to:</b>", "bodyL"))
    st += bullets(can)
    st.append(P("<b>This role must be refused when it tries to:</b>", "bodyL"))
    st += bullets(cannot)
    st.append(P("Any action outside these lines that succeeds is a finding. Full permission matrix: JCSAMS-SEC-005, Table 4.", "small"))
    st.append(Spacer(1, 8))
    st.append(note("<b>Test copy only.</b> This account exists only in the separate test installation (database jimma_ams_insa). All assets "
                   "in it are fictitious and the Kebele to Kifle Ketema mapping is test data. The account gives no access to the real system. "
                   "Keep this sheet confidential and destroy it when the assessment ends."))
    st.append(Spacer(1, 10))
    sig = Table([["Issued by (Banmen Technologies)", "Received by (INSA assessment team)"],
                 ["Name: Bealem Sintayehu", "Name: ______________________"],
                 ["Signature: ______________________", "Signature: ______________________"],
                 [f"Date: {issued}", "Date: ______________________"]], colWidths=[8.3 * cm, 8.3 * cm], hAlign="LEFT")
    sig.setStyle(TableStyle([("FONT", (0, 0), (-1, 0), "Body-Bold", 9.5), ("FONT", (0, 1), (-1, -1), "Body", 9.5),
                             ("TEXTCOLOR", (0, 0), (-1, -1), INK), ("TOPPADDING", (0, 0), (-1, -1), 4), ("LINEABOVE", (0, 0), (-1, 0), 0.8, NAVY)]))
    st.append(sig)
    return st


def build_one(path, story):
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=2.2 * cm, rightMargin=2.2 * cm, topMargin=1.8 * cm, bottomMargin=1.8 * cm,
                            title="INSA test account", author="Banmen Technologies")
    doc.build(story, onFirstPage=page, onLaterPages=page)


for i, a in enumerate(accounts, 1):
    build_one(os.path.join(DEST, f"{i:02d}_{a['username']}.pdf"), sheet(i, a))

# overview without passwords
ov = [Paragraph("INSA test accounts: overview", ss["h1"]),
      P(f"{N} test accounts in the separate test copy of the {SYSTEM}, issued {issued}, valid until {valid_until}. "
        "Each account has its own sheet with its temporary password, handed over individually. This overview contains no passwords.", "bodyL")]
ov += table([["#", "Username", "Role", "Area"]] + [[str(i), f"<font name='Mono'>{a['username']}</font>", a["role_label"], a["area"]] for i, a in enumerate(accounts, 1)],
            [0.8, 4.8, 4.4, 6.6])
ov.append(P("<b>Pairs for testing access between areas.</b> insa.sector.ginjo / insa.kebele.ginjo / insa.kifle.jiren work in Jiren; "
            "insa.sector.hirmata / insa.kebele.hirmata / insa.kifle.hirmata work in Hirmata. Each should get 404 for the other area's records. "
            "Fictitious assets: 5 in Ginjo (Construction: 3 active, 1 waiting for verification, 1 draft) and 3 in Hirmata (Business & Trade: "
            "2 active, 1 waiting for verification), with a valuation, a failed inspection and planned maintenance.", "bodyL"))
ov.append(P("The copy can be reset to this starting state at any time with <font name='Mono'>npm run insa:setup</font> (this issues new passwords).", "bodyL"))
build_one(os.path.join(DEST, "00_Overview_no_passwords.pdf"), ov)

os.remove(SRC)
print(DEST, sorted(os.listdir(DEST)))
