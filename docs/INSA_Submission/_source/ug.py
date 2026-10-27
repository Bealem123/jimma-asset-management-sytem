from common import *

CODE = "JCSAMS-UG-004"
TITLE = "User Guide"


def task(title, steps, tip=None):
    st = [H3(title)] + numbered(steps)
    if tip:
        st.append(note(tip))
    return st


def story():
    s = []
    s += cover(CODE, TITLE, "How each role uses the system, step by step",
               "This guide is for the City staff who use the Jimma City Smart Asset Management System every day. It explains how to "
               "sign in, how the screen is organised, and the tasks of each of the eight roles, in the order people normally do them. "
               "It also tells the assessment team what each role is expected to be able to do, which helps when testing what it must not do.")
    s += document_control(
        [["0.5", "20 October 2026", AUTHOR, "Tasks for the five administrator roles."],
         ["0.9", "24 October 2026", AUTHOR, "Specialist roles, phones, offline work, monthly reports, troubleshooting."],
         ["1.0", DATE, AUTHOR, "Issued with the INSA submission."]],
        related=RELATED)
    s += toc()

    # 1 ----------------------------------------------------------------
    s += H1("Getting started")
    s += H2("What you need")
    s += bullets([
        "A computer or phone with a current browser: Chrome, Edge, Firefox or Safari.",
        "The system's address, which the ICT Directorate gives you (for example https://assets.jimma.gov.et).",
        "Your username and temporary password, which your administrator gives you in person. Nobody from the City will ever ask you for your password by phone or message.",
    ])
    s += H2("Signing in for the first time")
    s += numbered([
        "Open the system's address. Choose your language at the top of the sign-in page: English, አማርኛ or Afaan Oromoo.",
        "Enter your username and the temporary password, then select <b>Sign in</b>.",
        "The system asks you to choose your own password. It must have at least 8 characters, with an upper-case letter, a lower-case letter, a number and a symbol, for example <font name='Mono'>Jimma#2026a</font> (do not use this example).",
        "Enter the new password twice and save. From now on, use only your own password.",
    ])
    s.append(note("<b>Good to know.</b> A temporary password works for 7 days. If you wait longer, ask your administrator for a new one. "
                  "After 5 wrong passwords in a row your account is locked for 15 minutes; wait and try again, or ask your administrator."))
    s += H2("The screen")
    s += bullets([
        "<b>Side menu (left).</b> Only the pages your role uses. At the bottom: <b>My account</b> and <b>Sign out</b>. On a phone, open it with the menu button at the top left.",
        "<b>Top bar.</b> Your name, role and area; the language selector; search; the bell for notifications (the number shows how many are unread).",
        "<b>Dashboard.</b> The first page after signing in. It shows what needs your attention in your area.",
        "<b>Lists.</b> Use the filters above a list to narrow it. The icons at the end of a row open (eye), edit (pencil) or remove (bin) a record, when you are allowed to.",
        "<b>Forms.</b> A field that does not accept a character simply ignores it (for example, numbers in a name). A red message under a field explains what to correct.",
    ])
    s += H2("Signing out and sessions")
    s.append(P("Select <b>Sign out</b> at the bottom of the menu when you finish, especially on a shared computer. If you leave the system "
               "without activity for 30 minutes it signs you out by itself, and you sign in again. If your password is changed or your "
               "account is changed by your administrator, you are also signed out."))
    s += H2("Using a phone")
    s += bullets([
        "In the phone's browser, choose <b>Install app</b> or <b>Add to home screen</b> to open the system like an app.",
        "The camera (to scan QR labels and take photos) and the location (to record where you are) work only when the address starts with https. Allow them when the phone asks.",
        "Inspections and verification results can be recorded without a connection. A banner shows how many are waiting; they are sent automatically when the connection returns. Do not clear the browser's data while results are waiting.",
    ])
    s += H2("Your account")
    s.append(P("Under <b>My account</b> you can change your password, choose your language and add a profile photo so colleagues recognise "
               "you. Your name, role and area are set by your administrator."))

    # 2 ----------------------------------------------------------------
    s += H1("How the work flows")
    s.append(P("Most work in the system follows the City's chain of responsibility. Knowing the chain makes it clear why a task sometimes "
               "waits for someone else."))
    s += table([["Flow", "Steps (who)"],
                ["New asset", "Register and submit (Sector Administrator) → verify on site (Kebele Administrator) → approve and activate (Kifle Ketema Administrator)"],
                ["Transfer, disposal, retirement, assignment, ownership change", "Request (Sector Administrator) → review (Kebele Administrator) → decide (Kifle Ketema Administrator)"],
                ["Inspection", "Inspect and record (Inspector) → follow-up for a failed inspection (responsible office) → check and close (Inspector or administrator)"],
                ["Stock-taking", "Open campaign (Kebele or Kifle Ketema Administrator) → record findings (Inspector, Kebele Administrator) → correct discrepancies (administrator, not the finder)"],
                ["Monthly report", "Sector → Kebele → Kifle Ketema → Mayor; Financial Officer and Inspector → Kifle Ketema; Internal Auditor → Mayor"],
                ["Accounts", "Super Administrator → Kifle Ketema Administrators and specialists; Kifle Ketema → Kebele Administrators; Kebele → Sector Administrators"]],
               [4.6, 12.0])
    s.append(P("Nobody takes two steps on the same item. If you registered an asset, someone else verifies it; if you verified it, someone "
               "else approves it. The system refuses the second step and tells you why."))

    # 3 ----------------------------------------------------------------
    s += H1("Sector Administrator")
    s.append(P("You keep the records of your sector's assets in your Kebele. You register new assets, keep their details up to date, and "
               "ask for transfers, maintenance and disposal. Inspections are done by the Inspector, not by you."))
    s += task("Register a new asset", [
        "Select <b>Register asset</b> in the menu.",
        "Fill in the steps: what the asset is (name, category, type), where it is (place, GPS point: select <b>Use my current location</b> when you are at the asset), who is responsible, its condition, and how it was acquired. Your sector and Kebele are filled in for you.",
        "Add photos and documents (ownership, purchase, invoice ...). PDF, JPG, PNG, Word and Excel files up to 10 MB are accepted.",
        "Use the arrow buttons to move between steps. On the last step, tick <b>Send it to the Kebele Administrator for verification as soon as it is registered</b>, then select <b>Register asset</b>. Without the tick the asset is kept as a draft that only you can see, and you can send it later from its page.",
        "The asset receives its Asset ID (for example AST-000125) and waits for the Kebele Administrator.",
    ], "If the system says a similar asset already exists, open it first. Register a second record only if it really is a different asset.")
    s += task("Correct a returned asset", [
        "A returned asset appears on your dashboard under <b>Returned</b>, with the reason.",
        "Open it, select the edit (pencil) icon, correct what the reason asks for, and submit again.",
    ])
    s += task("Keep an asset up to date", [
        "Open <b>Assets</b>, find the asset with the search box or filters, and open it.",
        "Use the tabs on the asset page to record maintenance, uses, documents and status changes. Each change asks for a reason and is kept in the history.",
    ])
    s += task("Ask for a transfer, assignment, ownership change, retirement or disposal", [
        "Open the asset and choose the action.",
        "Fill in the details and the reason, attach supporting documents, and send.",
        "Follow the request under <b>Approvals → Requests</b>. You are notified when it is reviewed and decided.",
    ])
    s += task("Act on a follow-up", [
        "Open <b>Follow-ups</b>. Each one says what an inspection found and what must be done.",
        "When the work is done, select <b>Mark done</b> and add a short note. The Inspector or administrator checks it and selects <b>Confirm done</b>, or sends it back.",
    ])
    s += task("Print QR labels", [
        "Open the asset and choose <b>Print label</b> in its QR label section.",
        "Print on label paper and stick the label on the asset where it can be scanned. If a label is lost or damaged, choose <b>Replace label</b>; the old label stops working.",
    ])

    # 4 ----------------------------------------------------------------
    s += H1("Kebele Administrator")
    s.append(P("You make sure the register matches what is really there in your Kebele. You confirm newly registered assets on site, "
               "review requests from the sectors, run stock-taking, and manage the Sector Administrator accounts of your Kebele."))
    s += task("Verify a newly registered asset on site", [
        "Open <b>Approvals</b>. Assets waiting for your check are listed with their place.",
        "Go to the asset, open it on your phone and compare what you see with the record.",
        "If it is correct, select <b>Verify on site</b>; allow the location and add a photo taken on site. If something is wrong or the asset is not there, select <b>Send back</b> and write the reason.",
    ])
    s += task("Review a request", [
        "Open <b>Approvals → Requests</b>.",
        "Read the request and its documents. Select <b>Review</b> to pass it to the Kifle Ketema Administrator, or <b>Reject</b> with a reason.",
    ])
    s += task("Run a stock-taking (verification) campaign", [
        "Open <b>Verification</b> and select <b>Start a stock-taking</b>. Give it a name and a due date. The system takes a snapshot of what the register says.",
        "With the campaign open, select <b>Scan the label</b> for each asset and use <b>Record what you found</b>: Found, Missing, Wrong location or Duplicate.",
        "Differences appear as discrepancies. Investigate them; a correction is approved by someone other than the person who found the difference.",
        "Close the campaign and download its report (CSV).",
    ])
    s += task("Create a Sector Administrator account", [
        "Open <b>Users</b> and select the add-user icon.",
        "Enter the person's first name, father's name (grandfather's name is optional), phone and e-mail, and choose the sector. The username is created from the first name.",
        "Save. The system shows a temporary password once. Give it to the person yourself.",
    ], "Each sector in a Kebele has one Sector Administrator. To replace a person, deactivate the old account first.")

    # 5 ----------------------------------------------------------------
    s += H1("Kifle Ketema Administrator")
    s.append(P("You approve and activate assets and decide requests for the Kebeles of your Kifle Ketema. You manage the Kebele "
               "Administrators and follow the work of the Inspectors. You do not register or edit assets yourself."))
    s += task("Approve an asset", [
        "Open <b>Approvals</b>. Assets confirmed on site by the Kebele are waiting for you.",
        "Check the record, the photos and the site evidence. Select <b>Approve</b> to make the asset active, or <b>Send back</b> with a reason.",
    ])
    s += task("Decide a request", [
        "Open <b>Approvals → Requests</b>. Requests reviewed by a Kebele are waiting for you.",
        "Select <b>Approve</b> or <b>Reject</b>. A rejection needs a reason. The requester is notified.",
    ])
    s += task("Follow the Inspectors", [
        "Your dashboard shows the Inspectors of your Kifle Ketema, their recent inspections and overdue inspections.",
        "If your Kifle Ketema has no active Inspector, the dashboard warns you: ask the Super Administrator to create one, because nobody else can record inspections.",
    ])
    s += task("Manage Kebele Administrators", [
        "Open <b>Users</b>. You see the Kebele Administrators of your Kifle Ketema.",
        "Use the add-user icon to create one, the pencil to change details or set a new temporary password, and <b>Deactivate user</b> to switch an account off.",
    ])
    s += task("Decide the monthly reports of your team", [
        "Open <b>Monthly reports</b>. Reports from your Kebele Administrators, Financial Officer and Inspector are listed with their status.",
        "Open a report, read it, and select <b>Accept</b>, or <b>Return</b> with a reason.",
    ])

    # 6 ----------------------------------------------------------------
    s += H1("Inspector")
    s.append(P("You are the only role that records inspections. You also record findings during stock-taking. You work in the Kifle "
               "Ketemas assigned to you, usually on a phone."))
    s += task("Record an inspection", [
        "Select <b>Scan QR code</b> and point the camera at the asset's label. The asset opens. (Without a label, search for it in <b>Assets</b>.)",
        "Select <b>Record inspection</b>. Choose Passed or Failed, the condition you found, write notes and take photos.",
        "Save. The asset's condition is updated. A failed inspection creates a follow-up for the responsible office.",
    ], "No connection? Record anyway. The result is kept on the phone and sent when the connection returns.")
    s += task("Check follow-ups", [
        "Open <b>Follow-ups</b>. When an office has marked work done, check it on site and select <b>Confirm done</b>, or send it back with a reason.",
    ])
    s += task("Record stock-taking findings", [
        "Open <b>Verification</b>, open the campaign, scan each label and record what you found.",
    ])

    # 7 ----------------------------------------------------------------
    s += H1("Financial Officer")
    s.append(P("You record the value and the income of assets in the Kifle Ketemas assigned to you. Money figures are visible only to you "
               "and the other roles that need them."))
    s += task("Record a valuation", [
        "Open <b>Financial management</b> and choose <b>Record valuation</b>, or open the asset and use its finance tab.",
        "Find the asset, enter the value in Birr, the date (not in the future), the method and notes. Save.",
        "The new value becomes the asset's current value; earlier values stay in its history.",
    ])
    s += task("Record income", [
        "In <b>Financial management</b> choose <b>Record income</b>.",
        "Enter the type (rent, lease, fee, sale, other), the amount, the date received, the period it covers, the payer and the receipt reference. Save.",
    ])
    s += task("See the finance overview", [
        "<b>Financial management</b> shows totals, valuation history, income, depreciation and assets that still have no value recorded (the backlog). Use the tabs to switch views.",
    ])

    # 8 ----------------------------------------------------------------
    s += H1("Mayor / Executive")
    s.append(P("You see the whole City: dashboards, analytics, performance by area and money. You receive the monthly reports of the three "
               "Kifle Ketema Administrators and the Internal Auditor. You do not change records."))
    s += task("Read and decide the monthly reports", [
        "Open <b>Monthly reports</b>. The reports sent to you are listed by month and sender.",
        "Open a report. Select <b>Accept</b>, or <b>Return</b> with a reason if something must be corrected.",
    ])
    s += task("Follow performance", [
        "<b>Dashboard</b> gives the City-wide picture. <b>Performance by area</b> compares the Kifle Ketemas and Kebeles. <b>Analytics</b> shows condition, high-maintenance assets, replacement candidates and under-used assets.",
    ])

    # 9 ----------------------------------------------------------------
    s += H1("Internal Auditor")
    s.append(P("You check the records independently. You can read everything, including the audit log and the history of every user "
               "account, and you change nothing. You report directly to the Mayor."))
    s += task("Search the audit log", [
        "Open <b>Audit log</b>. Filter by person, action, record type and date.",
        "Open an entry to see exactly what changed: the old and the new values.",
    ])
    s += task("Review accounts and stock-taking", [
        "<b>Users</b> lists every account (read-only) with its history.",
        "<b>Verification</b> shows every campaign, its findings and how discrepancies were resolved.",
    ])
    s += task("Send your monthly report", ["Open <b>Monthly reports</b>, review the prepared figures, add your findings, confirm and send to the Mayor."])

    # 10 ---------------------------------------------------------------
    s += H1("Super Administrator")
    s.append(P("You run the system. You create the accounts at the top of the hierarchy and the specialist accounts, keep the master data, "
               "settings and backups, and read the audit log. You do no asset work: you cannot register, change or approve assets."))
    s += task("Create accounts", [
        "Open <b>Users</b>. Use the add-user icon and choose the kind of account: Kifle Ketema Administrator, Mayor / Executive, Internal Auditor, Financial Officer or Inspector.",
        "Enter the person's names, phone and e-mail and the area (Kifle Ketema for most roles). Save and hand over the temporary password in person.",
    ], "There is one active Mayor and one active Internal Auditor. To replace either, deactivate the old account first.")
    s += task("Help a user who is locked out or forgot the password", [
        "Open <b>Users</b>, select the pencil next to the person and type a new password in <b>New password</b>. Save. It is a temporary password: the person must replace it at the next sign-in.",
        "Give it to the person yourself. Their open sessions end immediately.",
    ])
    s += task("Keep the master data", [
        "Open <b>Master data</b>. Add or correct Kifle Ketemas, Kebeles, sectors, departments, categories and types.",
        "Link each Kebele to its Kifle Ketema. Assets cannot be registered in a Kebele that is not linked.",
    ])
    s += task("Settings, permissions and backups", [
        "<b>System</b> has the approval workflows, role permissions, notification rules, settings (for example the calendar of the monthly reports), API keys and backups.",
        "Take a backup before any large change and check that the backup list shows it as verified.",
    ], "Change role permissions only when the City has decided so in writing; every change is in the audit log.")
    s += task("Follow the monthly reports", ["<b>Monthly reports</b> shows where every report stands (sent, late, accepted, returned). You cannot open or decide them."])

    # 11 ---------------------------------------------------------------
    s += H1("Anyone: scanning a label without an account")
    s.append(P("Anyone who scans an asset's QR label with an ordinary phone camera sees a short public card: the asset's name and ID, "
               "its category, sector and Kebele, its condition and status, and photos. It does not show money, names, the exact "
               "location or documents. If the label was replaced, the card says so; the new label is on the asset."))

    # 12 ---------------------------------------------------------------
    s += H1("The AI assistant")
    s.append(P("The round button at the bottom right of every page opens the AI assistant. Ask it in your own language how to do "
               "something, or ask about the assets in your area. It answers from what you are allowed to see, and it cannot change, "
               "approve or delete anything: for that it tells you which page to open."))
    s += task("Ask the assistant", [
        "Select the round chat button at the bottom right.",
        "Type your question and press Enter, or select one of the suggested questions.",
        "Read the answer. Ask a follow-up question in the same window if needed. Close the window with the X.",
    ], "Examples: \"What is waiting for me?\", \"How many assets in my Kebele are in poor condition?\", \"Show AST-000125\", "
       "\"How do I send my monthly report?\". AI answers can be wrong: check the record before you act on an answer.")
    s.append(P("Do not type passwords or personal information about citizens into the assistant. If the button is not there, the "
               "assistant has not been switched on for your system."))

    # 13 ---------------------------------------------------------------
    s += H1("Troubleshooting")
    s += table([["What you see", "What to do"],
                ["\"Wrong username or password.\"", "Check the username and the keyboard language and Caps Lock. After 5 tries the account locks for 15 minutes."],
                ["\"Too many sign-in attempts\" or \"account locked\"", "Wait 15 minutes, or ask your administrator to reset your password."],
                ["\"Your temporary password has expired.\"", "Ask your administrator for a new temporary password."],
                ["\"Your session ended ...\"", "Sign in again. Sessions end after 30 minutes without activity and when your account is changed."],
                ["\"Not found\" for an asset you know exists", "It is outside your area. Ask the administrator of that area."],
                ["\"You do not have permission to do this.\"", "This task belongs to another role (see section 2)."],
                ["The camera or location does not start", "The address must start with https, and the browser must be allowed to use the camera or location (browser settings)."],
                ["Results waiting on the phone", "Connect to the internet and keep the app open; they are sent automatically. Do not clear the browser data."],
                ["A field will not accept what you type", "It accepts only the right kind of data (for example only letters in names, only digits in phone numbers). Read the hint under the field."]],
               [5.6, 11.0])
    s += H2("Getting help")
    s.append(P("Ask your administrator first (the person who created your account). For technical problems, contact the ICT "
               "Directorate of the Jimma City Administration. Never share your password, even with the help desk."))
    return s


if __name__ == "__main__":
    out = os.path.join(OUT, "04_User_Guide.pdf")
    build(Doc(out, CODE, TITLE), story())
    print(out)
