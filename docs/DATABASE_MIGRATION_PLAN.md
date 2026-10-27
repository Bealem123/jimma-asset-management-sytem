# Database migration plan: MyISAM → InnoDB, strict SQL mode, foreign keys

Status: **plan only, not executed.** Prepared 26 October 2026 after the readiness audit. Nothing in this document has
been run against any database. Execution needs written approval.

## 1. Where we start (verified, read-only)

| Item | Finding |
|---|---|
| Server | MySQL 8.4.7 (local WAMP). `@@default_storage_engine = MyISAM`, `@@sql_mode = IGNORE_SPACE` (no strict mode) |
| Databases | `jimma_ams` (live), `jimma_ams_test`, `jimma_ams_insa`, all 41 tables MyISAM |
| Foreign keys | **0 exist.** The migrations declare 98 (`.references(...)` / the `fk()` helper); MyISAM accepted and ignored them |
| Size | 0.67 MB, about 2,500 rows; conversion takes seconds |
| Character set | every table `utf8mb4_unicode_ci` (no change needed) |
| Other constraints | 13 CHECK constraints (migration 012) and the unique indexes exist and survive an engine change |
| MyISAM-only features | none: no FULLTEXT/SPATIAL index, no AUTO_INCREMENT that is not first in a key |
| Zero dates | none (`0000-00-00` would be rejected by strict mode) |
| Column types | every declared foreign-key column has the same type as the `id` it points to (0 mismatches) |
| Orphan rows (would block a foreign key) | **320** in two places, see section 2 |
| One declared key no longer applies | `report_schedules.created_by` (the column was removed by migration 007) |

## 2. Decisions needed before execution

1. **296 rows in `notifications` for user IDs 999000-999999.** They are not real data: the test file
   `accountAlerts.test.js` ran against the live database because it did not load the test settings (fixed in this
   phase). Proposal: after the full backup, delete exactly these rows
   (`DELETE FROM notifications WHERE user_id BETWEEN 999000 AND 999999 AND type = 'ACCOUNT_CREATED'`).
2. **24 rows in `audit_logs` for 11 deleted accounts** (IDs 66-71 and 241-243, sign-ins and password changes on
   8 October 2026). The application never deletes users; these were removed outside it. Each row still carries the
   username. The audit trail must not be altered. Choose one:
   - **A (recommended): no foreign key on `audit_logs.user_id`.** An audit log is a historical record that keeps the
     username itself; it should outlive any account. A small new migration records this choice so a fresh install
     matches a converted one.
   - B: insert 11 inactive placeholder users ("Deleted account", unusable password, no area) with the original IDs so
     the key can be added. Keeps the key, but adds rows that were never real accounts.
3. **The SQL mode to enforce.** Proposal: MySQL 8's own default,
   `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`.
4. **Where it is set.** In the server configuration (`my.ini` / `my.cnf`) for production. For testing on the current
   computer without touching the other databases, the application can set it per connection (section 4, step 1).

## 3. Risks and required changes found while planning

| Risk | Detail | Handling |
|---|---|---|
| Behaviour changes once keys are enforced | `DELETE /api/assets/:id/documents/:did` deletes a document that may be the photo of an on-site check (`asset_site_checks.photo_document_id`, no cascade): on InnoDB the delete would be refused | Test on InnoDB; decide: refuse with a clear message, or clear the link first |
| | Deleting a draft asset keeps its notifications "apart" (`KEPT_APART` in `routes/assets.js`), but the declared key `notifications.asset_id` is `ON DELETE CASCADE`: on InnoDB they would be deleted with it | Confirm the intended behaviour; adjust the key or the code in a reviewed migration |
| Strict mode | Values that MyISAM silently truncated or adjusted are refused with an error | The input validation (Zod limits) should already prevent this; the full test suite on strict mode proves it |
| `ONLY_FULL_GROUP_BY` | A report query that selects a column it does not group by is refused | Covered by the dashboard/analytics/report tests; fix any query that fails |
| Real transactions | Code that wrote in `trx` now really rolls back on error (the intended behaviour) | Covered by the tests |
| Existing backups | All 79 dumps say `ENGINE=MyISAM`; restoring one recreates MyISAM tables. `--single-transaction` gives no consistent snapshot on MyISAM | Expected: this is the rollback path. After conversion, new dumps are consistent |
| Locking | InnoDB takes row locks; deadlocks are possible but unlikely at this volume | Watch the error log after go-live |
| Windows file locks | Twice on 26-27 Oct an `ALTER TABLE` on the MyISAM test database failed with "Error on rename of '#sql-….MYD' … (OS errno 13 - Permission denied)", most likely antivirus or indexing holding the file; the stray temporary table then broke the next rebuild | Exclude the MySQL data folder from antivirus scanning and indexing before the conversion; run each `ALTER` one at a time and check its result; if one fails, stop and roll back |
| Foreign-key names | Must match Knex's naming (`<table>_<column>_foreign`) so later migrations can drop them | Generate them from a fresh InnoDB migration run (section 4, step 2) |

## 4. Procedure

### Step 1. Prepare (no live change)
- Add an opt-in to `backend/src/db.js`: when `DB_STRICT=true`, every new connection runs
  `SET SESSION sql_mode = '<the mode from decision 3>'` and `SET SESSION default_storage_engine = InnoDB`
  (Knex `pool.afterCreate`). Off by default, so nothing changes until it is switched on. *(Code change, needs approval.)*
- If decision 2A: a migration `021_*` that drops `audit_logs_user_id_foreign` **if it exists**, so fresh installs
  and converted databases end up identical.

### Step 2. Test database on InnoDB (no live change)
1. `DB_STRICT=true` for the test run only (`jimma_ams_test`). The test helper drops every table and re-runs all
   migrations, so the test database is rebuilt as InnoDB **with all declared foreign keys** and strict mode.
2. Run `npm test`. **All 265 tests must pass.** Fix each failure in code, never by loosening the mode.
3. Record the exact foreign keys this creates
   (`SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='jimma_ams_test'`): this list is
   the target for the live conversion script.

### Step 3. Rehearse on a copy of the live data (no live change)
1. Take a full backup: `npm --prefix backend run backup` (database + uploads). Also a plain dump with
   `mysqldump --routines --triggers --hex-blob --default-character-set=utf8mb4 jimma_ams > pre-innodb.sql`.
   Copy both off the machine.
2. Restore the dump into a scratch database `jimma_ams_rehearsal` (create it; then
   `DB_NAME=jimma_ams_rehearsal node src/scripts/restore.js <file> --yes`: an environment variable set on the command
   line takes precedence over `.env`).
3. Run the conversion script (Step 4) against `jimma_ams_rehearsal`.
4. Run the integrity checks (section 5) and compare with the live database.
5. Point a test copy of the app at `jimma_ams_rehearsal` (`DB_NAME=… DB_STRICT=true npm start` on another port), sign
   in, open assets, approve a test asset, record a revenue, take a backup and restore it. **This is also the first
   tested restore.**

### Step 4. Conversion script (run during a maintenance window)
1. Stop the application (and its scheduler) so nothing writes.
2. Back up (as Step 3.1) and record the integrity checks.
3. Clean orphans per decisions 1 and 2.
4. `ALTER TABLE <t> ENGINE=InnoDB;` for each of the 41 tables. This keeps every row, every ID, the AUTO_INCREMENT
   counters, the indexes, unique keys and CHECK constraints.
5. Re-run the orphan check (must be 0 for every key to be added).
6. `ALTER TABLE <t> ADD CONSTRAINT <t>_<col>_foreign FOREIGN KEY (<col>) REFERENCES <ref>(id) [ON DELETE CASCADE];`
   for each key from Step 2.3, one table at a time.
7. Set the server: `default_storage_engine=InnoDB` and the SQL mode in `my.ini`, restart MySQL.
8. Start the application, run the integrity checks and a smoke test (sign in, list assets, open one, the dashboard).

### Step 5. Rollback
- **Before step 4.4 finished:** nothing changed in the data; restart the application.
- **After conversion, if anything is wrong:** stop the application, drop `jimma_ams`, recreate it, restore
  `pre-innodb.sql` (it recreates the original MyISAM tables with the original rows), restore the uploads folder from
  the same backup, put `my.ini` back, restart MySQL and the application, re-run the integrity checks and compare with
  the numbers recorded in step 4.2. Any record written after the backup is lost, which is why the application stays
  stopped during the window.

## 5. Integrity checks (before and after; all must match, except the cleaned orphans)

```sql
-- row counts of every table
SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE();   -- approximate on InnoDB; use COUNT(*) per table for the record
SELECT COUNT(*) FROM assets;  SELECT COUNT(*) FROM users;  SELECT COUNT(*) FROM audit_logs;  -- … every table
-- identity preserved
SELECT MIN(id), MAX(id), COUNT(*) FROM assets;  SELECT MIN(id), MAX(id), COUNT(*) FROM users;  SELECT MAX(id) FROM audit_logs;
-- content preserved: export these before and after and compare the files (CHECKSUM TABLE differs between engines)
SELECT id, asset_code, public_token, approval_state, status, updated_at FROM assets ORDER BY id;
SELECT id, username, role, is_active FROM users ORDER BY id;
SELECT id, action, entity, entity_id, created_at FROM audit_logs ORDER BY id;
-- the account structure (expected: 194 active, as in the audit)
SELECT role, COUNT(*) FROM users WHERE is_active = 1 GROUP BY role;
-- engine and keys (after)
SELECT ENGINE, COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() GROUP BY ENGINE;   -- InnoDB 41
SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE();      -- the Step 2.3 number
SELECT @@sql_mode, @@default_storage_engine;
```
Plus the orphan query for every declared key, the Kebele → Kifle Ketema links (5 / 4 / 4), and the application's own
backup read-back check.

## 6. Done means
- All 265 tests pass with InnoDB, foreign keys and strict mode.
- The rehearsal matched the live counts and passed the smoke test, including a restore.
- The live conversion matched the recorded counts; IDs, asset codes, accounts and audit history unchanged.
- `my.ini` on the production server has InnoDB and the strict mode, documented in `docs/SECURITY.md` Part 2.
