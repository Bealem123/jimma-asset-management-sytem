from common import *

CODE = "JCSAMS-SRS-001"
TITLE = "Software Requirements Specification"


def req_table(prefix, rows):
    """rows: (text, priority, verification). Returns a table with IDs prefix-01, -02 ..."""
    data = [["ID", "Requirement", "Priority", "Verified by"]]
    for i, (t, pr, v) in enumerate(rows, 1):
        data.append([f"<b>{prefix}-{i:02d}</b>", t, pr, v])
    return table(data, [2.3, 9.6, 1.6, 3.1])


def use_case(uid, name, rows, main, alt):
    st = [Spacer(1, 4), P(f"{uid}: {name}", "h3")]
    st += kv_table(rows, 3.6, 13.0)
    st.append(P("<b>Main flow</b>", "bodyL"))
    st += numbered(main)
    if alt:
        st.append(P("<b>Alternative and exception flows</b>", "bodyL"))
        st += bullets(alt)
    return st


def story():
    s = []
    s += cover(CODE, TITLE, "What the system must do, for whom, and how well",
               "This specification states the functional and non-functional requirements of the Jimma City Smart Asset "
               "Management System as built for release 1.0. Every requirement has an identifier, a priority and the way it is "
               "verified, so that the assessment team, the City and the developers can refer to it without ambiguity.")
    s += document_control(
        [["0.1", "8 October 2026", AUTHOR, "First draft from the 36-group feature checklist agreed with the City."],
         ["0.4", "14 October 2026", AUTHOR, "Roles reduced to eight; registration chain and reporting chain clarified with the City project team."],
         ["0.8", "22 October 2026", AUTHOR, "Input validation, account visibility, password and session requirements added."],
         ["1.0", DATE, AUTHOR, "Issued for the INSA assessment. Each requirement checked against the built system and its tests."]],
        related=RELATED)
    s += toc()

    # 1 ------------------------------------------------------------------
    s += H1("Introduction")
    s += H2("Purpose")
    s.append(P("This document specifies the requirements of the Jimma City Smart Asset Management System (JCSAMS). It is the "
               "reference against which the system was built and tested, and against which the City will accept it. It also gives "
               "the INSA assessment team a precise statement of what the system is supposed to allow and refuse, which is the "
               "starting point for testing whether it does."))
    s += H2("Background")
    s.append(P("Jimma City Administration is responsible for a large and varied set of public assets spread over three Kifle Ketemas "
               "(Hirmata, Jiren and Gibe) and their Kebeles. Each sector office has kept its own lists, mostly on paper or in "
               "spreadsheets. During the discovery work in September and October 2026 the project team found the same asset recorded "
               "differently in different offices, assets with no recorded location, no common identifier, and no reliable way to "
               "tell whether an asset still existed. Reports to the Mayor's office were compiled by hand each month."))
    s.append(P("The City's first request was for a rent revenue system. The discovery showed that rent is only one way an asset is "
               "used, and that a reliable rent system needs a reliable register of the assets being rented. The City therefore agreed "
               "to build the asset register first, as a foundation that rent and other revenue modules will use later."))
    s += H2("Scope")
    s.append(P("JCSAMS release 1.0 provides:"))
    s += bullets([
        "a single register of City assets, with a unique Asset ID, location, classification, ownership, responsibility, condition and status;",
        "a registration chain in which each new asset is registered by its sector, confirmed on site by the Kebele and approved by the Kifle Ketema;",
        "recording of maintenance, inspections, transfers, assignments, ownership changes, reservations, retirement and disposal;",
        "physical verification (stock-taking) with QR labels and phone scanning;",
        "valuation, depreciation and income per asset, visible only to authorised roles;",
        "monthly reports that move up the City's chain of responsibility;",
        "dashboards, a map, analytics, notifications, an audit trail and system administration;",
        "a public asset card for anyone who scans a label, and a read-only integration API for other City systems;",
        "an AI assistant that answers questions about using the system and looks up information in the user's own area, without changing anything.",
    ])
    s.append(P("Out of scope for release 1.0: rent and lease billing, receipts and arrears; payment integration; two-factor sign-in; "
               "single sign-on; a native mobile application; predictive analytics and sensor (IoT) integration."))
    s += H2("Definitions, acronyms and abbreviations")
    s += table([["Term", "Meaning"],
                ["Asset", "Anything the City owns, controls or administers on behalf of others and wants to account for: land, buildings, shops, vehicles, machinery, equipment, farms."],
                ["Kifle Ketema / Kebele", "Sub-city / the smallest administrative unit. A Kebele belongs to exactly one Kifle Ketema."],
                ["Sector", "A City line office (for example Agriculture, Trade, Construction). Every Kebele has the same set of sectors."],
                ["Area", "The part of the City assigned to a user: the whole City, one or more Kifle Ketemas, one Kebele, or one sector in one Kebele."],
                ["Registration chain", "Register (Sector) to verify on site (Kebele) to approve (Kifle Ketema)."],
                ["Request", "A proposed transfer, disposal, retirement, assignment or ownership change that needs approval."],
                ["Stock-taking / verification campaign", "A planned check that the assets in the register physically exist where the register says."],
                ["Temporary password", "A password set by an administrator or generated for a new account; it must be replaced at first sign-in."],
                ["Shall / should", "\"Shall\" marks a mandatory requirement; \"should\" marks a desirable one."],
                ["Must / Should / Could", "Priorities: Must = required for release 1.0; Should = important, included in 1.0; Could = desirable, may be deferred."]],
               [4.2, 12.4])
    s += H2("References")
    s += table([["Reference", "Title"],
                ["ISO/IEC/IEEE 29148:2018", "Systems and software engineering: life cycle processes, requirements engineering"],
                ["JCSAMS-SDD-002", "System and Architecture Design Document"],
                ["JCSAMS-SEC-005", "Security Documentation"],
                ["Project record, 6 October 2026", "Jimma City Asset Management System: Updated Discussion Summary and Conceptual Architecture"],
                ["Project record, 7 October 2026", "List of the 13 Kebeles supplied by the City"],
                ["OWASP ASVS 4.0.3", "Application Security Verification Standard, used for the security requirements in section 5.3"]],
               [5.2, 11.4])
    s += H2("How to read this document")
    s.append(P("Section 2 describes the system as a whole and its users. Section 3 lists the functional requirements by area. "
               "Section 4 gives the main use cases step by step. Section 5 lists the non-functional requirements with measurable "
               "values. Section 6 gives the business rules the system enforces. Section 7 covers external interfaces, and section 8 "
               "traces requirements to the automated tests. Open questions that the City still has to answer are in section 9."))

    # 2 ------------------------------------------------------------------
    s += H1("Overall description")
    s += H2("Product perspective")
    s.append(P("JCSAMS is a new, self-contained web system. It does not replace an existing computer system; it replaces paper "
               "records and spreadsheets. It is the first of a planned family of City systems: rent and lease management, billing "
               "and revenue reporting will be added later and will use the asset register through its identifiers. For that reason "
               "the register keeps an asset, its use and any revenue it produces as three separate things."))
    s += H2("Product functions")
    s += table([["Area", "Summary"],
                ["Accounts and access", "Sign-in, sign-out, password rules, account lockout, eight roles with editable permissions, area-based visibility, account management down the hierarchy."],
                ["Asset register", "Registration with Asset ID, classification, location, ownership, responsibility, condition, status, photos and documents; search, filter, export, map."],
                ["Registration chain", "Draft, submit, on-site verification, approval and activation, with return and correction."],
                ["Asset operations", "Maintenance, inspections, follow-up actions, transfers, assignments, ownership changes, reservations, retirement, disposal, archive."],
                ["Physical verification", "Campaigns, scanning, results, discrepancies, corrections, reports."],
                ["Finance", "Acquisition cost, valuations, depreciation, income; restricted visibility."],
                ["Reporting", "Monthly reports up the chain, dashboards, analytics, performance views."],
                ["Notifications", "21 notification types, in the system and by e-mail and SMS."],
                ["Administration", "Master data, workflows, permissions, settings, backups, API keys, audit log, system health."],
                ["Public and integration", "Public asset card behind each QR label; read-only API for City systems."],
                ["AI assistant", "Chat window on every page: how-to answers and read-only lookups in the user's area, in the user's language."]],
               [4.0, 12.6])
    s += H2("User classes and characteristics")
    s += table([["User class", "Number of accounts (initial)", "Characteristics and needs"],
                ["Super Administrator", "1", "ICT staff of the City. Technically confident. Needs control of accounts and configuration, and the audit log. Must not be able to change asset data."],
                ["Mayor / Executive", "1", "Senior decision maker. Uses the system occasionally, mainly on a laptop or phone. Needs short, clear summaries and the monthly reports from the Kifle Ketemas."],
                ["Kifle Ketema Administrator", "3", "Manages one sub-city. Approves registrations and requests. Needs a clear queue of what waits for a decision."],
                ["Kebele Administrator", "13", "Works in the field. Confirms new assets on site, runs stock-taking. Often on a phone with a weak connection."],
                ["Sector Administrator", "169 (13 sectors in 13 Kebeles)", "Office staff with varied computer skills. Registers and maintains the assets of one sector. Needs simple forms that check input as it is typed."],
                ["Internal Auditor", "1", "Independent reviewer. Needs read access to everything, including the audit log and user history, and no ability to change anything."],
                ["Financial Officer", "3 (one per Kifle Ketema)", "Records valuations and income. Needs money views for their Kifle Ketemas only."],
                ["Inspector", "3 (one per Kifle Ketema)", "Technical staff. The only role that records inspections. Works on a phone in the field."],
                ["Public visitor", "No account", "Anyone who scans an asset's QR label. Sees a short public card."]],
               [3.6, 3.4, 9.6])
    s += H2("Operating environment")
    s += bullets([
        "Server: 64-bit Linux (Ubuntu Server 22.04 or 24.04 LTS recommended), Node.js 20 or later, MySQL 8 or MariaDB 10.6 or later, nginx as the HTTPS reverse proxy.",
        "Clients: current versions of Chrome, Edge, Firefox and Safari on desktop; Chrome and Safari on Android and iOS phones. No plug-ins are needed.",
        "Network: the City LAN and the internet over HTTPS. Field work must be possible with intermittent mobile coverage.",
        "Languages: English, Amharic and Afaan Oromo for the interface; the Ethiopian calendar for monthly reports.",
    ])
    s += H2("Design and implementation constraints")
    s += bullets([
        "The system shall be operable by the City's own ICT staff on a single server, without paid third-party services.",
        "All software components shall be open source with licences that allow government use without fees.",
        "The camera and location features of phones work only on HTTPS; production must therefore be served over HTTPS.",
        "Data shall be stored in the City's own data centre; no asset, personal or financial data is sent to outside services except notification messages to the e-mail and SMS providers the City configures.",
    ])
    s += H2("Assumptions and dependencies")
    s += table([["#", "Assumption or dependency", "Effect if it does not hold"],
                ["A1", "The City confirms which Kifle Ketema each Kebele belongs to.", "Assets cannot be registered in an unassigned Kebele."],
                ["A2", "The City provides an SMTP server and an SMS gateway.", "Notifications appear only inside the system; new users must receive their temporary password by hand."],
                ["A3", "The City provides a domain name and TLS certificate.", "Phone cameras and location do not work; the system must not go live over plain HTTP."],
                ["A4", "Each person who holds a role has their own account and does not share it.", "The audit trail and separation of duties lose their meaning."],
                ["A5", "Printed QR labels are attached to physical assets by the sector offices.", "Physical verification falls back to typing Asset IDs."]],
               [1.0, 8.2, 7.4])

    # 3 ------------------------------------------------------------------
    s += H1("Functional requirements")
    s.append(P("Priorities: <b>M</b> = Must, <b>S</b> = Should, <b>C</b> = Could. Verification: <b>T</b> = automated test (file named), "
               "<b>D</b> = demonstration, <b>I</b> = inspection of code or configuration."))
    s += H2("Authentication and sessions (AUTH)")
    s += req_table("FR-AUTH", [
        ("The system shall require a username and password for every function except the sign-in page, the translations and the public asset card.", "M", "T auth.test.js"),
        ("The system shall store passwords only as bcrypt hashes with a cost factor of at least 12.", "M", "I security.js"),
        ("A new password shall have at least 8 characters and contain an upper-case letter, a lower-case letter, a digit and a symbol. The rule shall be checked in the form and again on the server.", "M", "T auth.test.js"),
        ("After 5 consecutive failed sign-ins for the same username the account shall be locked for 15 minutes, whatever address the attempts come from. The lock and its end shall be recorded in the audit log.", "M", "T auth.test.js"),
        ("A failed sign-in shall give the same message (\"Wrong username or password.\") and take about the same time whether or not the username exists.", "M", "T auth.test.js"),
        ("Sign-in attempts shall be limited to 20 per minute from one address.", "M", "T auth.test.js"),
        ("A session shall end after 30 minutes without activity, and in any case 8 hours after sign-in. Both values shall be configurable.", "M", "T auth.test.js"),
        ("Signing out shall end the session on the server: the token shall stop working immediately.", "M", "T auth.test.js"),
        ("Changing or resetting a password, deactivating an account, changing its role, or an administrator choosing \"end sessions\" shall end all existing sessions of that user.", "M", "T accounts.test.js"),
        ("A new account or a reset shall receive a random temporary password that meets FR-AUTH-03. Until the user replaces it, no function other than changing the password shall be available.", "M", "T accounts.test.js"),
        ("A temporary password shall expire 7 days after it was issued (configurable). An expired temporary password shall not open the account.", "M", "T auth.test.js"),
        ("The user's chosen language shall be remembered on the account and on the device.", "S", "T i18n.test.js"),
    ])
    s += H2("Accounts and roles (ACC)")
    s += req_table("FR-ACC", [
        ("The system shall provide eight roles: Super Administrator, Mayor / Executive, Kifle Ketema Administrator, Kebele Administrator, Sector Administrator, Internal Auditor, Financial Officer and Inspector.", "M", "T accounts.test.js"),
        ("Each level shall create and manage only the level directly below it: the Super Administrator the Kifle Ketema Administrators; a Kifle Ketema Administrator the Kebele Administrators of its Kifle Ketema; a Kebele Administrator the Sector Administrators of its Kebele.", "M", "T accounts.test.js"),
        ("The Super Administrator shall also create the Mayor / Executive, Internal Auditor, Financial Officer and Inspector accounts.", "M", "T accounts.test.js"),
        ("A user shall see only the accounts they manage. The Internal Auditor shall see all accounts, read-only. An account outside the user's view shall answer \"not found\".", "M", "T accounts.test.js"),
        ("A person shall be registered with first name, father's name and, optionally, grandfather's name. The username shall be derived from the first name and made unique automatically.", "M", "T accounts.test.js"),
        ("There shall be only one active administrator per area (one Kebele Administrator per Kebele, one Sector Administrator per sector in a Kebele) and only one active Mayor and one active Internal Auditor.", "M", "T accounts.test.js"),
        ("The Super Administrator shall be able to change which permissions each role has, except that the Super Administrator role itself cannot be locked out of administration.", "S", "T admin.test.js"),
        ("Every account change shall be kept in the account's history and in the audit log.", "M", "T accounts.test.js"),
        ("A user shall be able to add or change their own profile photo; photos shall be checked to be real images.", "C", "T photos.test.js"),
    ])
    s += H2("Asset register (AST)")
    s += req_table("FR-AST", [
        ("The system shall give each asset a unique, permanent Asset ID in the form AST-000125.", "M", "T assets.test.js"),
        ("An asset record shall hold: name, description, category and type, sector and department, Kifle Ketema, Kebele, location detail, GPS coordinates, ownership type and owner, responsible officer, current holder, condition, status, acquisition details and the sector-specific details defined for its sector.", "M", "T assets.test.js, sectorDetails.test.js"),
        ("Only a Sector Administrator shall register assets, and only in its own sector and Kebele.", "M", "T assets.test.js"),
        ("GPS coordinates shall be accepted only inside the Jimma City boundary.", "M", "T systemValidation.test.js"),
        ("The system shall warn about a probable duplicate (same serial number, registration number or name and location) when an asset is entered or imported.", "S", "T smartcity.test.js"),
        ("Condition shall be one of Excellent, Good, Fair, Poor, Critical; status one of Planned, Registered, Active, Inactive, Under maintenance, Damaged, Lost, Transferred, Leased, Rented, Retired, Disposed. Every change shall be recorded with a reason.", "M", "T assets.test.js"),
        ("Users shall be able to search and filter assets by ID, name, serial, category, type, sector, department, Kifle Ketema, Kebele, status, condition, responsible person and ownership, in any combination, and export the result as CSV.", "M", "T assets.test.js"),
        ("Photos and documents (12 document types) shall be attachable to an asset or to a specific maintenance, inspection, transfer, disposal or verification record.", "M", "T assets.test.js"),
        ("A draft that was never submitted may be deleted by the person who created it; no other asset record shall be deletable.", "M", "T assets.test.js"),
        ("The system shall show assets on a map, coloured by condition, with the same filters as the list.", "S", "D"),
        ("An administrator with the import permission shall be able to import assets from a CSV file. The whole file shall be checked first and nothing imported if any row is wrong.", "S", "T smartcity.test.js"),
    ])
    s += H2("Registration chain (REG)")
    s += req_table("FR-REG", [
        ("A new asset shall pass through the states Draft, Submitted, Reviewed, Approved and Active, in that order.", "M", "T assets.test.js"),
        ("The Kebele Administrator of the asset's Kebele shall confirm that the asset physically exists at the recorded place (with optional GPS point and photo), or return it with a reason.", "M", "T assets.test.js"),
        ("The Kifle Ketema Administrator of the asset's Kifle Ketema shall approve and activate the asset, or return it with a reason.", "M", "T assets.test.js"),
        ("No person shall take two steps on the same asset: the registrar cannot verify, and the verifier cannot approve.", "M", "T assets.test.js"),
        ("A returned asset shall go back to Draft with the reason visible to the registrar, who may correct and resubmit it.", "M", "T assets.test.js"),
        ("When an asset becomes active the system shall create its QR label token.", "M", "T publicCard.test.js"),
        ("Each step shall notify the person who must take the next step.", "S", "T operations.test.js"),
    ])
    s += H2("Asset operations (OPS)")
    s += req_table("FR-OPS", [
        ("Maintenance records shall hold date, kind, description, cost, provider, status (Planned, In progress, Completed, Cancelled) and next date. Due and overdue maintenance shall raise alerts.", "M", "T operations.test.js"),
        ("Only Inspectors shall record inspections. An inspection shall record result (Passed or Failed), condition found, notes, evidence photos and next date, and shall update the asset's condition.", "M", "T operations.test.js"),
        ("A failed inspection shall create a follow-up action for the responsible office; the follow-up shall be reported done and then checked and closed or sent back.", "M", "T operations.test.js"),
        ("Transfers, disposals, retirements, assignments and ownership changes shall be raised as requests and approved according to the workflow set for that request type (none, one approver, or review then approve). By default all require review by the Kebele and approval by the Kifle Ketema.", "M", "T operations.test.js"),
        ("The person who raised a request shall not review or approve it, and the reviewer shall not give the final approval.", "M", "T operations.test.js"),
        ("A transfer shall keep the old location; an assignment and an ownership change shall keep the previous holder and owner with dates and legal basis.", "M", "T smartcity.test.js"),
        ("Reservations of assets such as halls and vehicles shall be approved or rejected, and the system shall refuse a reservation that overlaps an approved one.", "S", "T smartcity.test.js"),
        ("A disposed asset's record shall be locked against change and may be archived.", "M", "T operations.test.js"),
        ("A lost or damaged QR label shall be replaceable; the old label shall then show \"label replaced\" when scanned.", "S", "T publicCard.test.js"),
    ])
    s += H2("Physical verification (VER)")
    s += req_table("FR-VER", [
        ("A Kebele or Kifle Ketema Administrator shall be able to open a verification campaign for their area; the campaign shall take a snapshot of what the register says.", "M", "T smartcity.test.js"),
        ("Inspectors and Kebele Administrators shall record each asset as Found, Missing, Wrong location or Duplicate, normally by scanning its label.", "M", "T smartcity.test.js"),
        ("Each difference between the snapshot and the finding shall become a discrepancy that is investigated and then corrected or dismissed with approval. The person who recorded the finding shall not approve its correction.", "M", "T smartcity.test.js"),
        ("Each campaign shall be exportable as a CSV report comparing expected and found.", "S", "T systemValidation.test.js"),
        ("Inspection and verification results recorded without a connection shall be kept on the device and sent automatically when the connection returns.", "S", "D"),
    ])
    s += H2("Finance (FIN)")
    s += req_table("FR-FIN", [
        ("Acquisition cost, valuations, depreciation, income and purchase, invoice and contract documents shall be visible only to roles with the financial permission, within their area.", "M", "T smartcity.test.js"),
        ("Only Financial Officers shall record valuations and income, for assets in their assigned Kifle Ketemas.", "M", "T operations.test.js"),
        ("Money amounts shall be positive, at most two decimals, in Ethiopian Birr; dates shall not be in the future; an income period shall end after it starts.", "M", "T systemValidation.test.js"),
        ("Depreciation shall be calculated straight-line from acquisition cost, salvage value and useful life.", "S", "T smartcity.test.js"),
        ("Every valuation shall be kept; the latest becomes the asset's current value.", "M", "T smartcity.test.js"),
    ])
    s += H2("Monthly reports (RPT)")
    s += req_table("FR-RPT", [
        ("Each role except the Mayor shall send a monthly report to the role directly above it: Sector to Kebele; Kebele, Financial Officer and Inspector to Kifle Ketema; Kifle Ketema and Internal Auditor to the Mayor.", "M", "T monthlyReports.test.js"),
        ("The system shall prepare the figures of the sender's area for the month; the sender adds comments and confirms; the figures are frozen when sent.", "M", "T monthlyReports.test.js"),
        ("The receiver shall accept the report or return it with a reason; a returned report is corrected and sent again as a new version; an accepted report is locked.", "M", "T monthlyReports.test.js"),
        ("A report shall be visible only to its sender and its receiver. The Super Administrator shall see only each report's status.", "M", "T monthlyReports.test.js"),
        ("Reminders shall be sent three days before the deadline and a late notice after it, to the sender and their superior. Deadlines: 5, 10 and 15 days after the month ends by level.", "S", "T monthlyReports.test.js"),
        ("Months shall follow the Ethiopian calendar by default, with Pagume reported together with Nehase; the Gregorian calendar shall be selectable.", "S", "T monthlyReports.test.js"),
    ])
    s += H2("Notifications, dashboards and analytics (NTF)")
    s += req_table("FR-NTF", [
        ("The system shall raise in-system notifications for 21 event types, including maintenance due and overdue, inspection due, expiring documents and leases, approvals waiting, rejected requests, critical condition, missing assets, verification discrepancies and monthly report events.", "M", "T operations.test.js"),
        ("Notifications shall also be sent by e-mail and SMS when those channels are configured and the rule for the type allows it.", "S", "T operations.test.js"),
        ("Each role shall see a dashboard limited to its area showing what needs its attention.", "M", "D"),
        ("The analytics view shall show rule-based indicators: condition and status mix, high-maintenance assets, replacement candidates, under-used assets, comparisons by sector and area.", "S", "T smartcity.test.js"),
    ])
    s += H2("Audit and administration (ADM)")
    s += req_table("FR-ADM", [
        ("The system shall record in an insert-only audit log every sign-in, failed sign-in, lock, sign-out, change to an asset, account, permission or setting, approval decision, document upload, download and removal, and export, with user, time and old and new values.", "M", "T admin.test.js"),
        ("Only the Super Administrator and the Internal Auditor shall read the audit log.", "M", "T admin.test.js"),
        ("The Super Administrator shall manage master data (Kifle Ketemas, Kebeles, sectors, departments, categories, types), approval workflows, notification rules and settings, without code changes.", "M", "T admin.test.js"),
        ("The Super Administrator shall be able to take a backup on demand, see the backup history and verify that each backup can be read; daily automatic backup shall be available.", "M", "T admin.test.js"),
        ("The Super Administrator shall be able to create and disable API keys for the integration API; a key shall be shown once and stored only as a hash.", "S", "T admin.test.js"),
    ])
    s += H2("Public card and integration (PUB)")
    s += req_table("FR-PUB", [
        ("Scanning an asset's QR label with any phone camera shall open a public card showing the asset's name, ID, category, sector, Kebele, condition, status and photos.", "M", "T publicCard.test.js"),
        ("The public card shall not show money, people's names, exact GPS position, serial, chassis or engine numbers, documents other than photos, or history.", "M", "T publicCard.test.js"),
        ("The integration API shall be read-only, require an API key, and never return money figures.", "M", "T admin.test.js"),
    ])
    s += H2("Input validation (VAL)")
    s += req_table("FR-VAL", [
        ("Every input field shall accept only the right kind of data, checked while typing in the form and again on the server: names letters only, phone numbers digits only up to the correct length, money valid amounts, dates valid calendar dates.", "M", "T systemValidation.test.js"),
        ("Phone numbers shall be typed as Ethiopian numbers (09 or 07 followed by 8 digits, or +251 9 / +251 7 followed by 8 digits); the form shall stop accepting digits once the number is complete. The server shall accept 9 to 15 digits with an optional leading + and reject letters.", "M", "T systemValidation.test.js"),
        ("Text fields shall have maximum lengths; unknown fields in a request shall be ignored.", "M", "T systemValidation.test.js"),
        ("The server shall answer a malformed, empty or unexpected request with a clear message and without failing.", "M", "T systemValidation.test.js"),
        ("Uploads shall be limited to PDF, JPG, PNG, WebP, Word and Excel files of at most 10 MB, and their content shall match their stated type.", "M", "T assets.test.js"),
    ])

    s += H2("AI assistant (AI)")
    s += req_table("FR-AI", [
        ("The system shall offer an AI assistant on every page that answers questions about how to use the system and about the assets in the user's area, in the user's interface language.", "S", "T assistant.test.js"),
        ("The assistant shall only read. It shall have no function that creates, changes, approves, sends or deletes anything.", "M", "T assistant.test.js"),
        ("Every lookup the assistant makes shall run with the signed-in user's own permissions and area; it shall never return an asset outside that area, and shall return money figures only to roles with the financial permission.", "M", "T assistant.test.js"),
        ("The assistant's instructions shall be set by the server only; a request that tries to supply them shall be refused. A conversation shall have at most 12 turns of at most 2000 characters each.", "M", "T assistant.test.js"),
        ("Questions shall be limited to 10 per minute per person (configurable).", "S", "I assistant route"),
        ("Each use shall be recorded in the audit log with the lookups made, without the text of the question.", "M", "T assistant.test.js"),
        ("The assistant shall be off unless an AI service is configured, and shall work with any OpenAI-compatible service, including a local model on the City's own server.", "M", "T assistant.test.js"),
    ])

    # 4 ------------------------------------------------------------------
    s += H1("Use cases")
    s.append(P("The use cases below describe the most important interactions in enough detail to design tests from them. Each "
               "refers to the requirements it realises."))
    s += use_case("UC-01", "Register a new asset", [
        ("Primary actor", "Sector Administrator"), ("Requirements", "FR-AST-01 to 08, FR-REG-01, FR-VAL-01 to 05"),
        ("Precondition", "The user is signed in; their Kebele is assigned to a Kifle Ketema."),
        ("Postcondition", "The asset exists in state Submitted and the Kebele Administrator has been notified.")],
        ["The user chooses Register asset.", "The system shows the registration form for the user's sector, with the Kebele and sector already filled in.",
         "The user enters the asset details step by step; each field is checked as it is typed.", "The user adds photos and documents.",
         "The user submits. The system validates everything again, checks for probable duplicates, gives the asset its Asset ID and sets it to Submitted.",
         "The system records the action in the audit log and notifies the Kebele Administrator."],
        ["Invalid data: the system marks the field and explains what is wrong; nothing is saved until it is corrected.",
         "Probable duplicate: the system shows the matching asset; the user can open it or confirm that this is a different asset.",
         "The user saves without submitting: the asset stays a Draft that only they can see and delete."])
    s += use_case("UC-02", "Verify a submitted asset on site", [
        ("Primary actor", "Kebele Administrator"), ("Requirements", "FR-REG-02, FR-REG-04, FR-REG-05"),
        ("Precondition", "An asset of the user's Kebele is Submitted, registered by someone else."),
        ("Postcondition", "The asset is Reviewed (or back to Draft with a reason).")],
        ["The user opens the queue of assets waiting for verification.", "The user goes to the place and opens the asset.",
         "The user records that the asset was found, optionally with the phone's GPS position and a photo.",
         "The system sets the asset to Reviewed and notifies the Kifle Ketema Administrator."],
        ["The asset is not found or the data is wrong: the user returns it with a reason; it goes back to Draft and the registrar is notified.",
         "The user registered the asset themselves: the system refuses the step."])
    s += use_case("UC-03", "Approve and activate an asset", [
        ("Primary actor", "Kifle Ketema Administrator"), ("Requirements", "FR-REG-03, FR-REG-04, FR-REG-06"),
        ("Precondition", "An asset of the user's Kifle Ketema is Reviewed."), ("Postcondition", "The asset is Active and has a QR label token.")],
        ["The user opens the approvals queue.", "The user reviews the record, its photos and the site check.", "The user approves.",
         "The system sets the asset to Approved and then Active, creates its label token and notifies the registrar."],
        ["The user returns the asset with a reason; it goes back to Draft.", "The user verified the asset themselves: the system refuses the step."])
    s += use_case("UC-04", "Record an inspection in the field", [
        ("Primary actor", "Inspector"), ("Requirements", "FR-OPS-02, FR-OPS-03, FR-VER-05"),
        ("Precondition", "The asset is in one of the Inspector's Kifle Ketemas."), ("Postcondition", "The inspection is recorded, the asset's condition updated, a follow-up created if it failed.")],
        ["The Inspector scans the asset's label with the phone.", "The system opens the asset.",
         "The Inspector records the result, the condition found, notes and photos.", "The system saves the inspection and updates the condition."],
        ["No connection: the result is kept on the phone and sent when the connection returns; a banner shows what is waiting.",
         "The inspection failed: the system creates a follow-up action for the responsible office."])
    s += use_case("UC-05", "Send a monthly report", [
        ("Primary actor", "Any role except the Mayor"), ("Requirements", "FR-RPT-01 to 05"),
        ("Precondition", "The reporting month has ended."), ("Postcondition", "The report is Submitted and frozen; the receiver is notified.")],
        ["The user opens Monthly reports and chooses the month.", "The system shows the prepared figures of the user's area and, for a superior, which team reports have arrived.",
         "The user adds comments and ticks \"I confirm\".", "The user sends. The system freezes the figures and notifies the receiver."],
        ["The receiver returns it: the sender corrects it and sends version 2.", "Some team reports are missing: the sender may still send but must explain what is missing."])
    s += use_case("UC-06", "Scan a QR label without an account", [
        ("Primary actor", "Member of the public"), ("Requirements", "FR-PUB-01, FR-PUB-02"),
        ("Precondition", "The label belongs to an active asset."), ("Postcondition", "The visitor has seen the public card; nothing is changed.")],
        ["The visitor scans the label with the phone camera.", "The phone opens the card address.", "The system shows the public card."],
        ["The label was replaced: the system says so and asks the visitor to scan the new label.", "The token is unknown: the system shows \"not found\"."])

    # 5 ------------------------------------------------------------------
    s += H1("Non-functional requirements")
    s += H2("Performance and capacity")
    s += req_table("NFR-PRF", [
        ("With 50 000 assets and 50 simultaneous users on the recommended server, 95% of list and record pages shall load within 2 seconds on the City LAN.", "S", "Load test (planned)"),
        ("Lists shall be paged on the server (25 rows per page by default, at most 100) and each list shall be served by a single database query.", "M", "I assetQuery.js"),
        ("Uploads up to 10 MB shall complete within 30 seconds on a 4 Mbit/s connection.", "S", "D"),
        ("The database design shall support at least 500 000 history records per year without schema change.", "S", "I migrations"),
    ])
    s += H2("Reliability and availability")
    s += req_table("NFR-REL", [
        ("The service shall restart automatically if it stops.", "M", "I deployment"),
        ("A full backup (database and files) shall be possible on demand and daily; each backup shall be verified by reading it back.", "M", "T admin.test.js"),
        ("Data loss after a server failure shall be at most one day (recovery point objective) and service shall be restorable within 4 hours (recovery time objective).", "S", "Restore drill"),
        ("Every change that touches more than one table shall be done in one database transaction.", "M", "I code review"),
    ])
    s += H2("Security")
    s.append(P("The security requirements are based on OWASP ASVS 4.0.3 level 2. The controls that meet them are described in JCSAMS-SEC-005."))
    s += req_table("NFR-SEC", [
        ("All traffic in production shall use HTTPS (TLS 1.2 or 1.3) with HSTS.", "M", "I deployment"),
        ("Every request shall be authorised on the server by role permission and by the user's area; a record outside the area shall answer 404.", "M", "T accounts.test.js, assets.test.js"),
        ("All database access shall use bound parameters; no user input shall be concatenated into SQL.", "M", "I code review, T systemValidation.test.js"),
        ("Responses shall carry security headers: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Cache-Control: no-store.", "M", "T auth.test.js"),
        ("Error responses shall not reveal stack traces, SQL, file paths or library versions.", "M", "T systemValidation.test.js"),
        ("Secrets (passwords, temporary passwords, tokens, API keys) shall never be written to logs.", "M", "I channels.js, audit.js"),
        ("Uploaded files shall be stored under random names outside the web root and downloaded only as attachments after an area check.", "M", "T assets.test.js"),
        ("CSV exports shall neutralise spreadsheet formulas.", "M", "T assets.test.js"),
        ("Third-party packages shall have no known high or critical vulnerabilities at release.", "M", "npm audit"),
    ])
    s += H2("Usability and accessibility")
    s += req_table("NFR-USE", [
        ("The interface shall be available in English, Amharic and Afaan Oromo, switchable at any time.", "M", "T i18n.test.js"),
        ("Every page shall work on a phone screen 360 pixels wide without horizontal scrolling.", "M", "D"),
        ("Forms shall show the reason for every rejected value next to the field, in the user's language.", "M", "D"),
        ("A new Sector Administrator shall be able to register an asset after a one-hour training session.", "S", "Training feedback"),
        ("Colour shall not be the only way information is shown; status chips carry text.", "S", "D"),
    ])
    s += H2("Maintainability and portability")
    s += req_table("NFR-MNT", [
        ("The database schema shall change only through numbered migration files.", "M", "I migrations"),
        ("The backend shall have automated tests for every requirement marked T in this document, runnable with one command against a separate test database.", "M", "npm test"),
        ("Master data, permissions, workflows and notification rules shall be changeable without code changes.", "M", "T admin.test.js"),
        ("Translations shall be editable in plain JSON files.", "S", "I i18n folder"),
        ("The system shall run on any 64-bit Linux or Windows server with Node.js 20+ and MySQL 8.", "S", "D"),
    ])

    # 6 ------------------------------------------------------------------
    s += H1("Business rules")
    s += table([["ID", "Rule"],
                ["BR-01", "An asset belongs to exactly one sector, one Kebele and therefore one Kifle Ketema at a time."],
                ["BR-02", "An asset is not duplicated when its use or its revenue changes; use and revenue are recorded against the one asset."],
                ["BR-03", "Not every asset produces revenue; an asset needs no revenue source to be registered."],
                ["BR-04", "Assets cannot be registered in a Kebele that is not yet linked to a Kifle Ketema."],
                ["BR-05", "Moving a Kebele to another Kifle Ketema moves its assets with it; a Kebele holding assets cannot be left without a Kifle Ketema."],
                ["BR-06", "Each step of the registration chain and of a two-step request is taken by a different person (separation of duties)."],
                ["BR-07", "Only Inspectors record inspections. The Sector Administrator, who holds the asset, does not inspect it."],
                ["BR-08", "Only Financial Officers record valuations and income."],
                ["BR-09", "The Super Administrator administers the system and does no asset work (no registering, editing or approving)."],
                ["BR-10", "A disposed asset is locked. Only a never-submitted draft may be deleted."],
                ["BR-11", "Monthly report figures are frozen when the report is sent; an accepted report cannot be changed."],
                ["BR-12", "Every Kifle Ketema needs at least one active Inspector; dashboards warn when one has none."],
                ["BR-13", "Pagume is reported together with Nehase."]],
               [1.6, 15.0])

    # 7 ------------------------------------------------------------------
    s += H1("External interface requirements")
    s += H2("User interface")
    s.append(P("A responsive web interface with a side menu and a top bar. The side menu lists only the functions of the user's role. "
               "Each role starts on its own dashboard. Pop-up dialogs are centred on all screen sizes. On phones, lists of cards are "
               "shown in two columns and the menu opens as a drawer that fits the screen."))
    s += H2("Hardware interfaces")
    s.append(P("The phone or laptop camera for QR scanning and photos; the device location service for GPS points; USB or Bluetooth "
               "barcode readers that act as a keyboard. Labels can be printed on any printer from the browser."))
    s += H2("Software interfaces")
    s += table([["Interface", "Direction", "Description"],
                ["MySQL 8 / MariaDB 10.6+", "Out", "All structured data, through the Knex query builder."],
                ["SMTP server", "Out", "Notification e-mails; host, port, TLS and credentials configured by the City."],
                ["SMS gateway", "Out", "HTTP POST of {\"to\", \"message\"} with a bearer token, to the gateway the City configures."],
                ["Integration API", "In", "Read-only REST API under /api/integration/v1 with an X-API-Key header and an OpenAPI 3 description."],
                ["Map tiles", "Browser only", "OpenStreetMap and Esri imagery fetched by the user's browser; no server involvement."],
                ["AI service", "Out", "OpenAI-compatible chat API (Google Gemini, Groq, OpenRouter or a local Ollama), configured by the City; receives the question and the results of the read-only lookups."]],
               [4.0, 2.4, 10.2])
    s += H2("Communication interfaces")
    s.append(P("HTTPS on port 443 only in production. The API exchanges JSON (UTF-8), except file uploads (multipart/form-data), "
               "file downloads, QR images (SVG and PNG) and CSV exports."))

    # 8 ------------------------------------------------------------------
    s += H1("Verification and traceability")
    s.append(P("The backend test suite contains 265 tests in 16 files. It runs against a separate database that it creates and "
               "empties itself, and refuses to run against any other database. On 25 October 2026 all 265 tests passed. Table 3 "
               "shows which test file covers which group of requirements."))
    s += table([["Test file", "Tests", "Requirements covered"],
                ["auth.test.js", "12", "FR-AUTH-01, 03 to 08, 11; NFR-SEC-04"],
                ["accounts.test.js", "33", "FR-AUTH-09, 10; FR-ACC-01 to 06, 08; NFR-SEC-02"],
                ["assets.test.js", "60", "FR-AST-01 to 03, 06 to 09; FR-REG-01 to 05; FR-VAL-05; NFR-SEC-07, 08"],
                ["operations.test.js", "36", "FR-OPS-01 to 05, 08; FR-REG-07; FR-FIN-02; FR-NTF-01, 02"],
                ["smartcity.test.js", "31", "FR-AST-05, 11; FR-OPS-06, 07; FR-VER-01 to 03; FR-FIN-01, 04, 05; FR-NTF-04"],
                ["admin.test.js", "27", "FR-ACC-07; FR-ADM-01 to 05; FR-PUB-03; NFR-REL-02"],
                ["systemValidation.test.js", "17", "FR-AST-04; FR-VAL-01 to 04; FR-FIN-03; FR-VER-04; NFR-SEC-03, 05"],
                ["monthlyReports.test.js", "10", "FR-RPT-01 to 06"],
                ["i18n.test.js", "9", "FR-AUTH-12; NFR-USE-01"],
                ["sectorDetails.test.js", "6", "FR-AST-02 (sector-specific details)"],
                ["publicCard.test.js", "5", "FR-REG-06; FR-OPS-09; FR-PUB-01, 02"],
                ["photos.test.js, assetPhotos.test.js", "7", "FR-ACC-09; photo upload content checks"],
                ["activity.test.js, accountAlerts.test.js", "3", "Activity history and account alerts"],
                ["assistant.test.js", "8", "FR-AI-01 to 04, 06, 07"],
                ["Total", "265", ""]],
               [5.0, 1.6, 10.0])
    s.append(P("Requirements marked D are demonstrated during acceptance; those marked I are checked by inspection of the code or the "
               "server configuration; NFR-PRF-01 will be verified by a load test before go-live."))

    # 9 ------------------------------------------------------------------
    s += H1("Open issues")
    s += table([["#", "Question for Jimma City", "Owner", "Affects"],
                ["OI-1", "Which Kifle Ketema does each of the 13 Kebeles belong to, and what are their official spellings?", "City administration", "BR-04, FR-AST-03"],
                ["OI-2", "What is the official list of asset categories and revenue classifications, and what does \"Assura / Kote\" mean legally?", "Finance and planning", "FR-AST-02"],
                ["OI-3", "What default useful lives should be used for depreciation, by category?", "Finance", "FR-FIN-04"],
                ["OI-4", "How long must the audit trail be kept by law?", "Legal office", "FR-ADM-01"],
                ["OI-5", "Who in each office will hold each role at go-live?", "Mayor's office", "FR-ACC-01"],
                ["OI-6", "Which SMTP server and SMS gateway will be used?", "ICT Directorate", "FR-NTF-02, FR-AUTH-10"],
                ["OI-7", "Review of the Amharic and Afaan Oromo translations by the City's language staff.", "Communication office", "NFR-USE-01"],
                ["OI-8", "Which AI service may receive questions and lookup results: a cloud service (free tiers may keep the data) or a local model on the City's server?", "Mayor's office, ICT Directorate", "FR-AI-07"]],
               [1.2, 9.0, 3.2, 3.2])
    return s


if __name__ == "__main__":
    out = os.path.join(OUT, "01_SRS_Requirements_Specification.pdf")
    build(Doc(out, CODE, TITLE), story())
    print(out)
