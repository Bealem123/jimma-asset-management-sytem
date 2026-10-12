// Smart City extension: acquisition, assignment, reservation, verification, approval requests,
// disposal, revenue, notifications, QR scanning, API keys, custom permissions, backups.
// Same rules as 001: history is never overwritten; every new record points back to the asset.

/** Unsigned integer column, optionally a foreign key. */
const fk = (t, col, table, { nullable = true, cascade = false, unique = false } = {}) => {
  const c = t.integer(col).unsigned();
  if (nullable) c.nullable(); else c.notNullable();
  const r = c.references('id').inTable(table);
  if (cascade) r.onDelete('CASCADE');
  if (unique) c.unique();
  return c;
};

const stamps = (t, knex) => {
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
};

export async function up(knex) {
  // ---------- Kebeles may exist before the City confirms which Kifle Ketema they belong to ----------
  await knex.schema.alterTable('kebeles', (t) => {
    t.integer('kifle_ketema_id').unsigned().nullable().alter();
  });

  // ---------- users ----------
  await knex.schema.alterTable('users', (t) => {
    t.string('email', 190).nullable();
    t.string('phone', 40).nullable();
    fk(t, 'department_id', 'departments');
    t.integer('token_version').unsigned().notNullable().defaultTo(0); // bump to end every open session of this user
  });

  // ---------- assets: identification, responsibility, depreciation inputs ----------
  await knex.schema.alterTable('assets', (t) => {
    t.string('serial_number', 120).nullable();
    t.string('registration_number', 120).nullable();
    t.string('function_use', 160).nullable(); // classification by function / use
    t.string('responsible_office', 200).nullable();
    t.boolean('is_reservable').notNullable().defaultTo(false);
    t.integer('useful_life_years').unsigned().nullable();
    t.decimal('salvage_value', 16, 2).nullable();
    t.timestamp('archived_at').nullable();
    t.index(['serial_number']);
    t.index(['registration_number']);
  });

  await knex.schema.alterTable('asset_documents', (t) => {
    t.string('related_type', 30).nullable(); // ACQUISITION | MAINTENANCE | INSPECTION | TRANSFER | DISPOSAL | VERIFICATION
    t.integer('related_id').unsigned().nullable();
    t.date('expires_on').nullable();
    t.index(['related_type', 'related_id']);
    t.index(['expires_on']);
  });

  await knex.schema.alterTable('maintenance_records', (t) => {
    t.string('kind', 20).notNullable().defaultTo('ROUTINE'); // ROUTINE | PREVENTIVE | CORRECTIVE | REPAIR | OVERHAUL
  });

  await knex.schema.alterTable('inspection_records', (t) => {
    t.string('result', 20).notNullable().defaultTo('PASSED'); // PASSED | FAILED
    t.decimal('latitude', 10, 7).nullable();
    t.decimal('longitude', 10, 7).nullable();
    t.string('method', 12).notNullable().defaultTo('MANUAL'); // MANUAL | SCAN
  });

  // ---------- approval requests (transfer, disposal, retirement, assignment, ownership change) ----------
  await knex.schema.createTable('workflow_configs', (t) => {
    t.string('request_type', 30).primary();
    t.boolean('requires_approval').notNullable().defaultTo(true);
    t.integer('steps').unsigned().notNullable().defaultTo(1); // 1 = one approver, 2 = review then approve
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('approval_requests', (t) => {
    t.increments('id');
    t.string('request_type', 30).notNullable();
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    t.json('payload').notNullable();
    t.string('summary', 500).notNullable();
    t.string('status', 12).notNullable().defaultTo('PENDING'); // PENDING | REVIEWED | APPROVED | REJECTED | CANCELLED
    fk(t, 'requested_by', 'users', { nullable: false });
    t.timestamp('requested_at').notNullable().defaultTo(knex.fn.now());
    fk(t, 'reviewed_by', 'users');
    t.timestamp('reviewed_at').nullable();
    fk(t, 'decided_by', 'users');
    t.timestamp('decided_at').nullable();
    t.string('decision_note', 500).nullable();
    t.index(['status']);
    t.index(['asset_id']);
    t.index(['request_type', 'status']);
  });

  await knex.schema.alterTable('asset_transfers', (t) => {
    fk(t, 'request_id', 'approval_requests');
    fk(t, 'approved_by', 'users');
    fk(t, 'from_department_id', 'departments');
    fk(t, 'to_department_id', 'departments');
  });

  // ---------- acquisition / procurement ----------
  await knex.schema.createTable('asset_acquisitions', (t) => {
    t.increments('id');
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true, unique: true });
    t.string('method', 30).notNullable(); // PURCHASE | GOVERNMENT_ALLOCATION | DONATION | TRANSFER | CONSTRUCTION | OTHER
    t.string('procurement_ref', 120).nullable();
    t.string('supplier_name', 200).nullable();
    t.string('supplier_contact', 200).nullable();
    t.string('contract_ref', 120).nullable();
    t.string('invoice_ref', 120).nullable();
    t.date('acquisition_date').nullable();
    t.decimal('cost', 16, 2).nullable();
    t.string('approval_ref', 160).nullable(); // decision / minute that approved the acquisition
    t.string('approved_by_name', 200).nullable();
    t.date('approved_on').nullable();
    t.text('notes');
    fk(t, 'recorded_by', 'users');
    stamps(t, knex);
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // ---------- assignment / allocation (this table is also the responsibility history) ----------
  await knex.schema.createTable('asset_assignments', (t) => {
    t.increments('id');
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    fk(t, 'sector_id', 'sectors');
    fk(t, 'department_id', 'departments');
    t.string('office', 200).nullable();
    t.string('responsible_officer', 160).nullable();
    t.string('holder', 200).nullable(); // employee / user who holds the asset now
    fk(t, 'holder_user_id', 'users');
    t.date('assigned_date').notNullable();
    t.date('ended_date').nullable();
    t.string('reason', 500).notNullable();
    t.string('status', 10).notNullable().defaultTo('ACTIVE'); // ACTIVE | ENDED
    fk(t, 'request_id', 'approval_requests');
    fk(t, 'recorded_by', 'users');
    stamps(t, knex);
    t.index(['asset_id', 'status']);
    t.index(['department_id']);
  });

  await knex.schema.createTable('asset_ownership_history', (t) => {
    t.increments('id');
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    t.string('previous_owner', 200).notNullable();
    t.string('new_owner', 200).notNullable();
    t.string('previous_type', 30).notNullable();
    t.string('new_type', 30).notNullable();
    t.date('effective_date').notNullable();
    t.string('basis', 500).notNullable(); // legal basis / decision
    fk(t, 'request_id', 'approval_requests');
    fk(t, 'recorded_by', 'users');
    stamps(t, knex);
    t.index(['asset_id']);
  });

  // ---------- reservation ----------
  await knex.schema.createTable('asset_reservations', (t) => {
    t.increments('id');
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    fk(t, 'requested_by', 'users', { nullable: false });
    t.string('requester_name', 200).notNullable();
    t.datetime('start_at').notNullable();
    t.datetime('end_at').notNullable();
    t.string('purpose', 500).notNullable();
    t.string('status', 12).notNullable().defaultTo('PENDING'); // PENDING | APPROVED | REJECTED | CANCELLED
    fk(t, 'decided_by', 'users');
    t.timestamp('decided_at').nullable();
    t.string('decision_note', 500).nullable();
    stamps(t, knex);
    t.index(['asset_id', 'start_at', 'end_at']);
    t.index(['status']);
  });

  // ---------- disposal / retirement ----------
  await knex.schema.createTable('asset_disposals', (t) => {
    t.increments('id');
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    t.string('kind', 12).notNullable(); // RETIREMENT | DISPOSAL
    t.string('reason', 500).notNullable();
    t.string('method', 30).nullable(); // SALE | DONATION | SCRAP | DESTRUCTION | TRANSFER_OUT | OTHER
    t.date('disposal_date').notNullable();
    t.decimal('disposal_value', 16, 2).nullable();
    t.string('recipient', 200).nullable(); // buyer / recipient where applicable
    t.text('notes');
    fk(t, 'request_id', 'approval_requests');
    fk(t, 'approved_by', 'users');
    fk(t, 'recorded_by', 'users');
    stamps(t, knex);
    t.index(['asset_id']);
  });

  // ---------- follow-up actions (failed inspections, verification corrections) ----------
  await knex.schema.createTable('follow_up_actions', (t) => {
    t.increments('id');
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    t.string('source_type', 20).notNullable(); // INSPECTION | VERIFICATION | MANUAL
    t.integer('source_id').unsigned().nullable();
    t.string('description', 500).notNullable();
    t.date('due_date').nullable();
    t.string('assigned_to', 160).nullable();
    t.string('status', 10).notNullable().defaultTo('OPEN'); // OPEN | DONE | CANCELLED
    t.string('resolution', 500).nullable();
    fk(t, 'created_by', 'users');
    fk(t, 'closed_by', 'users');
    stamps(t, knex);
    t.timestamp('closed_at').nullable();
    t.index(['asset_id']);
    t.index(['status']);
  });

  // ---------- physical verification / inventory ----------
  await knex.schema.createTable('verification_campaigns', (t) => {
    t.increments('id');
    t.string('name', 200).notNullable();
    fk(t, 'kifle_ketema_id', 'kifle_ketemas');
    fk(t, 'kebele_id', 'kebeles');
    fk(t, 'sector_id', 'sectors');
    t.date('due_date').nullable();
    t.string('status', 10).notNullable().defaultTo('OPEN'); // OPEN | CLOSED
    fk(t, 'created_by', 'users');
    stamps(t, knex);
    t.timestamp('closed_at').nullable();
  });

  await knex.schema.createTable('verification_items', (t) => {
    t.increments('id');
    fk(t, 'campaign_id', 'verification_campaigns', { nullable: false, cascade: true });
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    // what the database said when the campaign started
    fk(t, 'expected_kifle_ketema_id', 'kifle_ketemas');
    fk(t, 'expected_kebele_id', 'kebeles');
    t.string('expected_location_detail', 255).nullable();
    t.string('expected_condition', 20).nullable();
    // what the officer found
    t.string('result', 20).notNullable().defaultTo('PENDING'); // PENDING | FOUND | MISSING | WRONG_LOCATION | DUPLICATE
    fk(t, 'found_kifle_ketema_id', 'kifle_ketemas');
    fk(t, 'found_kebele_id', 'kebeles');
    t.string('found_location_detail', 255).nullable();
    t.string('found_condition', 20).nullable();
    t.decimal('latitude', 10, 7).nullable();
    t.decimal('longitude', 10, 7).nullable();
    t.string('method', 12).nullable(); // MANUAL | SCAN
    t.text('notes');
    fk(t, 'verified_by', 'users');
    t.timestamp('verified_at').nullable();
    // discrepancy handling
    t.string('discrepancy_status', 20).notNullable().defaultTo('NONE'); // NONE | OPEN | INVESTIGATING | CORRECTED | DISMISSED
    t.string('resolution_note', 500).nullable();
    fk(t, 'resolved_by', 'users');
    t.timestamp('resolved_at').nullable();
    t.unique(['campaign_id', 'asset_id']);
    t.index(['result']);
    t.index(['discrepancy_status']);
  });

  // ---------- financial: revenue linked to an asset ----------
  await knex.schema.createTable('asset_revenues', (t) => {
    t.increments('id');
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    fk(t, 'utilization_id', 'utilizations');
    t.string('revenue_type', 20).notNullable(); // RENT | LEASE | FEE | SALE | OTHER
    t.decimal('amount', 16, 2).notNullable();
    t.date('received_date').notNullable();
    t.date('period_start').nullable();
    t.date('period_end').nullable();
    t.string('payer', 200).nullable();
    t.string('reference', 120).nullable();
    t.text('notes');
    fk(t, 'recorded_by', 'users');
    stamps(t, knex);
    t.index(['asset_id']);
    t.index(['received_date']);
  });

  // ---------- QR / barcode scanning ----------
  await knex.schema.createTable('scan_events', (t) => {
    t.bigIncrements('id');
    fk(t, 'asset_id', 'assets', { nullable: false, cascade: true });
    fk(t, 'user_id', 'users');
    t.string('context', 20).notNullable().defaultTo('LOOKUP'); // LOOKUP | INSPECTION | VERIFICATION
    t.decimal('latitude', 10, 7).nullable();
    t.decimal('longitude', 10, 7).nullable();
    stamps(t, knex);
    t.index(['asset_id']);
  });

  // ---------- notifications ----------
  await knex.schema.createTable('notification_rules', (t) => {
    t.string('type', 40).primary();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('lead_days').unsigned().nullable(); // how early to warn (scan-based alerts)
    t.boolean('email').notNullable().defaultTo(false);
    t.boolean('sms').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('notifications', (t) => {
    t.bigIncrements('id');
    fk(t, 'user_id', 'users', { nullable: false, cascade: true });
    t.string('type', 40).notNullable();
    t.string('title', 200).notNullable();
    t.string('body', 500).nullable();
    fk(t, 'asset_id', 'assets', { cascade: true });
    t.string('link', 200).nullable();
    t.string('dedupe_key', 160).nullable();
    t.boolean('is_read').notNullable().defaultTo(false);
    t.string('email_status', 12).nullable(); // SENT | FAILED | SKIPPED
    t.string('sms_status', 12).nullable();
    stamps(t, knex);
    t.unique(['user_id', 'dedupe_key']);
    t.index(['user_id', 'is_read']);
  });

  // ---------- reports ----------
  await knex.schema.createTable('report_schedules', (t) => {
    t.increments('id');
    t.string('report_slug', 60).notNullable();
    t.string('frequency', 10).notNullable(); // DAILY | WEEKLY | MONTHLY
    t.string('recipients', 500).notNullable(); // comma-separated e-mail addresses
    t.string('format', 5).notNullable().defaultTo('csv'); // csv | pdf
    t.boolean('is_active').notNullable().defaultTo(true);
    t.date('last_run_on').nullable();
    fk(t, 'created_by', 'users', { nullable: false });
    stamps(t, knex);
  });

  // ---------- administration ----------
  await knex.schema.createTable('role_permissions', (t) => {
    t.string('role', 30).notNullable();
    t.string('permission', 40).notNullable();
    t.boolean('allowed').notNullable();
    t.primary(['role', 'permission']);
  });

  await knex.schema.createTable('system_settings', (t) => {
    t.string('key', 60).primary();
    t.text('value');
  });

  await knex.schema.createTable('api_keys', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('key_prefix', 12).notNullable();
    t.string('key_hash', 64).notNullable().unique(); // SHA-256 of the key; the key itself is shown once
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('last_used_at').nullable();
    fk(t, 'created_by', 'users');
    stamps(t, knex);
  });

  await knex.schema.createTable('backups', (t) => {
    t.increments('id');
    t.string('filename', 200).notNullable();
    t.bigInteger('size_bytes').unsigned().notNullable().defaultTo(0);
    t.string('kind', 10).notNullable(); // DATABASE | FILES
    t.string('status', 10).notNullable(); // OK | FAILED
    t.string('note', 500).nullable();
    t.timestamp('verified_at').nullable();
    fk(t, 'created_by', 'users');
    stamps(t, knex);
  });
}

export async function down(knex) {
  for (const table of [
    'backups', 'api_keys', 'system_settings', 'role_permissions', 'report_schedules', 'notifications',
    'notification_rules', 'scan_events', 'asset_revenues', 'verification_items', 'verification_campaigns',
    'follow_up_actions', 'asset_disposals', 'asset_reservations', 'asset_ownership_history', 'asset_assignments',
    'asset_acquisitions',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.schema.alterTable('asset_transfers', (t) => {
    t.dropForeign('request_id'); t.dropForeign('approved_by'); t.dropForeign('from_department_id'); t.dropForeign('to_department_id');
    t.dropColumn('request_id'); t.dropColumn('approved_by'); t.dropColumn('from_department_id'); t.dropColumn('to_department_id');
  });
  await knex.schema.dropTableIfExists('approval_requests');
  await knex.schema.dropTableIfExists('workflow_configs');
  await knex.schema.alterTable('inspection_records', (t) => {
    t.dropColumn('result'); t.dropColumn('latitude'); t.dropColumn('longitude'); t.dropColumn('method');
  });
  await knex.schema.alterTable('maintenance_records', (t) => { t.dropColumn('kind'); });
  await knex.schema.alterTable('asset_documents', (t) => {
    t.dropColumn('related_type'); t.dropColumn('related_id'); t.dropColumn('expires_on');
  });
  await knex.schema.alterTable('assets', (t) => {
    for (const c of ['serial_number', 'registration_number', 'function_use', 'responsible_office', 'is_reservable', 'useful_life_years', 'salvage_value', 'archived_at']) t.dropColumn(c);
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropForeign('department_id');
    for (const c of ['email', 'phone', 'department_id', 'token_version']) t.dropColumn(c);
  });
}
