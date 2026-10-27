// What the AI assistant knows about using the system (a short form of the User Guide, docs/INSA_Submission/04).
// Keep it in step with the screens: menu names and button names are written exactly as they appear in English.
export const GUIDE = `
SIGNING IN. Username and password. A new account gets a temporary password from the administrator; it must be replaced at the first sign-in and expires after 7 days. A password needs at least 8 characters with an upper-case letter, a lower-case letter, a number and a symbol. After 5 wrong passwords the account is locked for 15 minutes. A session ends after 30 minutes without activity. Sign out is at the bottom of the menu. My account: change password, language, profile photo.

LANGUAGES. English, Amharic, Afaan Oromo: the language selector on the sign-in page and in the top bar.

WHO DOES WHAT (the registration chain). Sector Administrator registers an asset -> Kebele Administrator verifies it on site -> Kifle Ketema Administrator approves and activates it. Nobody takes two steps on the same asset. Requests (transfer, disposal, retirement, assignment, ownership change): Sector Administrator asks, Kebele Administrator reviews, Kifle Ketema Administrator decides. Only Inspectors record inspections. Only Financial Officers record valuations and income. The Super Administrator manages accounts, master data and settings and does no asset work. The Mayor / Executive and the Internal Auditor read; the Internal Auditor also reads the audit log and every account, and changes nothing.

ACCOUNTS. Each level creates the level below: Super Administrator -> Kifle Ketema Administrators (and the Mayor, Internal Auditor, Financial Officers, Inspectors); Kifle Ketema Administrator -> Kebele Administrators; Kebele Administrator -> Sector Administrators. Users -> add-user icon; enter first name, father's name (grandfather's name optional), phone, e-mail, area; the username is made from the first name; the temporary password is shown once. To set a new temporary password: Users -> pencil -> New password -> Save. Deactivate user to switch an account off; one active administrator per area, one Mayor and one Internal Auditor.

REGISTER AN ASSET (Sector Administrator). Menu Register asset. Fill the steps (what it is, where it is, Use my current location for the GPS point, who is responsible, condition, acquisition), add a photo and documents (PDF, JPG, PNG, Word, Excel up to 10 MB). On the last step tick "Send it to the Kebele Administrator for verification as soon as it is registered", then Register asset. Without the tick it stays a draft only the registrar sees. A returned asset shows its reason; edit it and send it again. Only a draft never sent can be deleted.

VERIFY ON SITE (Kebele Administrator). Approvals (Registrations and requests). Open the asset at its place; Verify on site with the phone's location and a photo taken on site, or Send back with a reason.

APPROVE (Kifle Ketema Administrator). Approvals. Check the record and the site evidence; Approve makes it active, or Send back with a reason. Requests: Review (Kebele), Approve or Reject (Kifle Ketema).

ASSET PAGE. Open from Assets (search box and filters). Record maintenance, Record use, Record ownership change, Record acquisition, documents, status changes with a reason. Print label and Replace label in the QR label section (a replaced label stops working).

INSPECTIONS (Inspector). Scan QR code, point the camera at the label; the asset opens; Record inspection: Passed or Failed, condition found, notes, photos. Without a connection it is saved on the phone and sent later. A failed inspection creates a follow-up.

FOLLOW-UPS. Follow-ups page: the responsible office selects Mark done with a note; the Inspector or administrator checks it and selects Confirm done, or sends it back.

STOCK-TAKING (Kebele or Kifle Ketema Administrator, Inspector). Verification -> Start a stock-taking (name, due date). Scan the label -> Record what you found: Found, Missing, Wrong location, Duplicate. Differences become discrepancies; a correction is approved by someone other than the finder. Close the campaign and download its report.

MONEY (Financial Officer). Financial management: Record valuation (value in Birr, date not in the future, method), Record income (type, amount, date received, period, payer, receipt reference). Totals, depreciation and assets without a value are shown there. Money is hidden from roles without the financial permission.

MONTHLY REPORTS. Monthly reports: the system prepares the figures; add comments, tick I confirm, send. Sector -> Kebele (5 days after the month), Kebele, Financial Officer, Inspector -> Kifle Ketema (10 days), Kifle Ketema and Internal Auditor -> Mayor (15 days). The receiver selects Accept or Return with a reason. Months follow the Ethiopian calendar by default; Pagume goes with Nehase.

OTHER PAGES. Dashboard (what needs attention), Map, Analytics, Performance by area, Reservations (halls, vehicles; no double booking), Notifications (the bell), Audit log (Super Administrator, Internal Auditor), Master data and System (Super Administrator: Kebeles and their Kifle Ketema, sectors, categories, workflows, permissions, notification rules, settings, backups, API keys).

PHONES. Install app / Add to home screen in the phone browser. Camera and location work only on https addresses.

PROBLEMS. "Not found" for an asset: it is outside your area. "You do not have permission": the task belongs to another role. Locked: wait 15 minutes or ask your administrator. Temporary password expired: ask your administrator for a new one.
`.trim();
