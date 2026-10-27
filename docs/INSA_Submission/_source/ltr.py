from common import *
from reportlab.platypus import SimpleDocTemplate

CODE = "JCSAMS-LTR-000"


def letterhead(c, d):
    W, H = A4
    c.saveState()
    if os.path.exists(LOGO):
        c.drawImage(LOGO, 2.2 * cm, H - 3.5 * cm, width=2.2 * cm, height=2.2 * cm, mask="auto")
    c.setFont("Head", 14); c.setFillColor(NAVY)
    c.drawString(4.8 * cm, H - 2.0 * cm, "Jimma City Administration")
    c.setFont("Body", 10.5); c.setFillColor(GREY)
    c.drawString(4.8 * cm, H - 2.55 * cm, "Jimma City Smart Asset Management System project (developed by Banmen Technologies)")
    c.drawString(4.8 * cm, H - 3.05 * cm, "Jimma, Oromia, Ethiopia")
    c.setStrokeColor(TEAL); c.setLineWidth(1.6)
    c.line(2.2 * cm, H - 3.9 * cm, W - 2.2 * cm, H - 3.9 * cm)
    c.setFont("Body", 8.3); c.setFillColor(GREY)
    c.drawString(2.2 * cm, 1.2 * cm, f"{CODE}  |  Covering letter for the INSA security assessment  |  Page {c.getPageNumber()}")
    c.restoreState()


def story(n):
    s = []
    s += kv_table([("Ref. No.", "_______________________"), ("Date", DATE)], 2.6, 6.0)
    s.append(Spacer(1, 4))
    s.append(P("To:<br/><b>Information Network Security Administration (INSA)</b><br/>Cyber Security Audit and Assessment Directorate<br/>Addis Ababa", "bodyL"))
    s.append(Spacer(1, 6))
    s.append(P("<b>Subject: Request for a security assessment of the Jimma City Smart Asset Management System (web application and API)</b>", "bodyL"))
    s.append(Spacer(1, 4))
    s.append(P("Dear Sir or Madam,"))
    s.append(P("Jimma City Administration has had the Jimma City Smart Asset Management System developed by <b>Banmen Technologies</b>, "
               "under the project lead <b>Bealem Sintayehu</b>. It is a web application that will hold "
               "the single register of the City's public assets: land, buildings, shops and market stalls, vehicles, machinery and "
               "equipment. It replaces the paper and spreadsheet records kept separately by each sector office. The system will be "
               "used by about 194 City officials at Kifle Ketema, Kebele and sector level, and by the Office of the Mayor."))
    s.append(P("Because the system will hold the City's asset values, income figures and the personal details of its staff, and because "
               "approvals in it will carry official weight, we ask INSA to carry out a security assessment (penetration test) of the "
               "web application and its API before we put it into production. We have registered the request on the Hibir platform and "
               "uploaded the documents listed below."))
    s.append(P("<b>Enclosed documents</b>", "bodyL"))
    s += table([["No.", "Document", "Reference", "Pages"],
                ["1", "Software Requirements Specification (SRS)", "JCSAMS-SRS-001 v1.0", n["01"]],
                ["2", "System and Architecture Design Document (SDD), with system architecture diagram, key components, data flow diagrams and data flow explanation", "JCSAMS-SDD-002 v1.0", n["02"]],
                ["3", "Technical Design and Specification", "JCSAMS-TDD-003 v1.0", n["03"]],
                ["4", "User Guide", "JCSAMS-UG-004 v1.0", n["04"]],
                ["5", "Security Documentation, with threat model, controls and test evidence", "JCSAMS-SEC-005 v1.0", n["05"]]],
               [1.1, 9.6, 3.9, 1.6])
    s.append(P("<b>Scope we request</b>", "bodyL"))
    s += bullets([
        "The web application, with all eight user roles, and the REST API behind it, including the public QR asset card, the read-only integration API and the read-only AI assistant.",
        "Authentication, session management, authorisation between roles and between administrative areas, input handling, and file upload and download.",
        "The TLS and HTTP security configuration of the test server.",
    ])
    s.append(P("Denial-of-service testing and social engineering are not requested. Testing will be done on a dedicated test installation "
               "that contains no production data."))
    s.append(P("<b>Test environment and contacts</b>", "bodyL"))
    s.append(P("The address of the test installation, one test account for each role and the agreed test window will be handed to the "
               "assessment team directly and not through this letter. We will keep the test environment unchanged during the test and "
               "will respond to every finding in writing, fix the confirmed ones and ask for a re-test."))
    s += kv_table([("Developer", f"<b>Banmen Technologies</b><br/>Project lead: {AUTHOR}<br/>E-mail: sintayehubealem411@gmail.com<br/>Phone: ______________________"),
                   ("System owner", "ICT Directorate, Jimma City Administration<br/>Contact person: ______________________<br/>Phone: ______________________")], 3.2, 13.4)
    s.append(P("We thank INSA for its support in keeping the City's information systems secure, and we look forward to working with your team."))
    s.append(Spacer(1, 8))
    s.append(P("Respectfully,", "bodyL"))
    s.append(Spacer(1, 26))
    s.append(P("______________________________<br/>Name: ______________________<br/>Position: ______________________<br/>Jimma City Administration<br/>(signature and official stamp)", "bodyL"))
    s.append(Spacer(1, 10))
    s.append(P("CC: Office of the Mayor, Jimma City Administration; ICT Directorate, Jimma City Administration", "small"))
    return s


if __name__ == "__main__":
    import glob, pymupdf
    n = {os.path.basename(f)[:2]: str(pymupdf.open(f).page_count) for f in glob.glob(os.path.join(OUT, "0[1-5]_*.pdf"))}
    out = os.path.join(OUT, "00_Official_Letter_to_INSA.pdf")
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=2.2 * cm, rightMargin=2.2 * cm, topMargin=4.4 * cm, bottomMargin=2.0 * cm,
                            title="Request for a security assessment - Jimma City Smart Asset Management System", author=AUTHOR)
    doc.build(story(n), onFirstPage=letterhead, onLaterPages=letterhead)
    print(out, n)
