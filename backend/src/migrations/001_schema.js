// Jimma City Asset Management System - initial schema.
// Design rules (from the project documents):
//  - one central asset register; the 13 sectors are classifications, not separate systems
//  - Asset, Utilization/Activity and Revenue classification are separate concepts
//  - an asset never has to have revenue
//  - history is preserved (transfers, valuations, audit log); nothing is silently overwritten

export async function up(knex) {
  const validated = (t) => t.boolean('is_validated').notNullable().defaultTo(false); // confirmed by the City?
  const active = (t) => t.boolean('is_active').notNullable().defaultTo(true);

  // ---------- master data ----------
  await knex.schema.createTable('kifle_ketemas', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable().unique();
    validated(t);
    active(t);
  });

  await knex.schema.createTable('kebeles', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.integer('kifle_ketema_id').unsigned().notNullable().references('id').inTable('kifle_ketemas');
    validated(t);
    active(t);
    t.unique(['kifle_ketema_id', 'name']);
  });

  await knex.schema.createTable('sectors', (t) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('name', 120).notNullable().unique();
    t.text('description');
    validated(t);
    active(t);
  });

  await knex.schema.createTable('departments', (t) => {
    t.increments('id');
    t.string('name', 160).notNullable();
    t.integer('sector_id').unsigned().notNullable().references('id').inTable('sectors');
    active(t);
    t.unique(['sector_id', 'name']);
  });

  await knex.schema.createTable('asset_categories', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable().unique();
    t.text('description');
    validated(t);
    active(t);
  });

  await knex.schema.createTable('asset_types', (t) => {
    t.increments('id');
    t.integer('category_id').unsigned().notNullable().references('id').inTable('asset_categories');
    t.string('name', 120).notNullable();
    active(t);
    t.unique(['category_id', 'name']);
  });

  // ---------- users and location/sector scope ----------
  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('username', 80).notNullable().unique();
    t.string('full_name', 160).notNullable();
    t.string('password_hash', 120).notNullable();
    t.string('role', 30).notNullable();
    active(t);
    t.timestamp('last_login_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('user_kifle_ketemas', (t) => {
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('kifle_ketema_id').unsigned().notNullable().references('id').inTable('kifle_ketemas');
    t.primary(['user_id', 'kifle_ketema_id']);
  });
  await knex.schema.createTable('user_kebeles', (t) => {
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('kebele_id').unsigned().notNullable().references('id').inTable('kebeles');
    t.primary(['user_id', 'kebele_id']);
  });
  await knex.schema.createTable('user_sectors', (t) => {
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('sector_id').unsigned().notNullable().references('id').inTable('sectors');
    t.primary(['user_id', 'sector_id']);
  });

  // ---------- the asset register ----------
  await knex.schema.createTable('assets', (t) => {
    t.increments('id');
    t.string('asset_code', 20).nullable().unique(); // AST-000001, assigned on creation
    t.string('name', 200).notNullable();
    t.text('description');

    t.integer('category_id').unsigned().notNullable().references('id').inTable('asset_categories');
    t.integer('asset_type_id').unsigned().nullable().references('id').inTable('asset_types');

    // organisational dimensions (who is responsible)
    t.integer('sector_id').unsigned().notNullable().references('id').inTable('sectors');
    t.integer('department_id').unsigned().nullable().references('id').inTable('departments');

    // location dimension: City -> Kifle Ketema -> Kebele -> specific location
    t.integer('kifle_ketema_id').unsigned().notNullable().references('id').inTable('kifle_ketemas');
    t.integer('kebele_id').unsigned().nullable().references('id').inTable('kebeles');
    t.string('location_detail', 255);
    t.decimal('latitude', 10, 7).nullable();
    t.decimal('longitude', 10, 7).nullable();

    // ownership vs responsibility vs current holder are three different things
    t.string('ownership_type', 30).notNullable().defaultTo('OWNED'); // OWNED | CONTROLLED | ADMINISTERED_ON_BEHALF
    t.string('owner_name', 200).notNullable().defaultTo('Jimma City Administration');
    t.string('responsible_officer', 160);
    t.string('current_holder', 200);

    t.string('condition', 20).notNullable().defaultTo('GOOD');
    t.string('status', 30).notNullable().defaultTo('REGISTERED'); // operational lifecycle state
    t.string('approval_state', 20).notNullable().defaultTo('DRAFT'); // DRAFT>SUBMITTED>REVIEWED>APPROVED>ACTIVE

    // financial information (revenue is NOT stored here: it belongs to utilization / sector modules)
    t.date('acquisition_date').nullable();
    t.decimal('acquisition_cost', 16, 2).nullable();
    t.decimal('current_valuation', 16, 2).nullable();
    t.date('valuation_date').nullable();

    t.integer('created_by').unsigned().nullable().references('id').inTable('users');
    t.integer('submitted_by').unsigned().nullable().references('id').inTable('users');
    t.integer('reviewed_by').unsigned().nullable().references('id').inTable('users');
    t.integer('approved_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('disposed_at').nullable();

    t.index(['sector_id']);
    t.index(['kifle_ketema_id', 'kebele_id']);
    t.index(['status']);
    t.index(['approval_state']);
    t.index(['category_id']);
  });

  // How an asset is being used. May or may not generate money.
  await knex.schema.createTable('utilizations', (t) => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('id').inTable('assets').onDelete('CASCADE');
    t.string('use_type', 30).notNullable();
    t.string('user_party', 200); // department, tenant, lessee, contractor, public...
    t.text('purpose');
    t.string('authorization_basis', 255); // contract, decision, legal basis
    t.date('start_date').notNullable();
    t.date('end_date').nullable();
    t.boolean('generates_revenue').notNullable().defaultTo(false);
    t.integer('revenue_sector_id').unsigned().nullable().references('id').inTable('sectors'); // classification, only if revenue
    t.text('notes');
    t.integer('recorded_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
  });

  await knex.schema.createTable('maintenance_records', (t) => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('id').inTable('assets').onDelete('CASCADE');
    t.date('maintenance_date').notNullable();
    t.string('maintenance_type', 120).notNullable();
    t.text('description');
    t.decimal('cost', 16, 2).nullable();
    t.string('provider', 200);
    t.string('status', 20).notNullable().defaultTo('COMPLETED'); // PLANNED | IN_PROGRESS | COMPLETED | CANCELLED
    t.date('next_maintenance_date').nullable();
    t.integer('recorded_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
    t.index(['next_maintenance_date']);
  });

  await knex.schema.createTable('inspection_records', (t) => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('id').inTable('assets').onDelete('CASCADE');
    t.date('inspection_date').notNullable();
    t.string('inspector', 160).notNullable();
    t.string('condition_found', 20).notNullable();
    t.text('notes');
    t.date('next_inspection_date').nullable();
    t.integer('recorded_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
  });

  // Transfers never overwrite history: both ends are stored.
  await knex.schema.createTable('asset_transfers', (t) => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('id').inTable('assets').onDelete('CASCADE');
    t.integer('from_kifle_ketema_id').unsigned().notNullable().references('id').inTable('kifle_ketemas');
    t.integer('from_kebele_id').unsigned().nullable().references('id').inTable('kebeles');
    t.string('from_location_detail', 255);
    t.integer('to_kifle_ketema_id').unsigned().notNullable().references('id').inTable('kifle_ketemas');
    t.integer('to_kebele_id').unsigned().nullable().references('id').inTable('kebeles');
    t.string('to_location_detail', 255);
    t.date('transfer_date').notNullable();
    t.string('reason', 500).notNullable();
    t.string('authorized_by', 200).notNullable();
    t.integer('recorded_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
  });

  await knex.schema.createTable('asset_documents', (t) => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('id').inTable('assets').onDelete('CASCADE');
    t.string('doc_type', 30).notNullable(); // PHOTO | OWNERSHIP | PURCHASE | REGISTRATION | CONTRACT | MAINTENANCE | OTHER
    t.string('title', 200).notNullable();
    t.string('original_name', 255).notNullable();
    t.string('stored_name', 255).notNullable(); // file on disk (never served directly)
    t.string('mime_type', 120).notNullable();
    t.integer('size_bytes').unsigned().notNullable();
    t.integer('uploaded_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('uploaded_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
  });

  await knex.schema.createTable('asset_valuations', (t) => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('id').inTable('assets').onDelete('CASCADE');
    t.date('valuation_date').notNullable();
    t.decimal('value', 16, 2).notNullable();
    t.string('method', 200);
    t.text('notes');
    t.integer('recorded_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
  });

  // Append-only trail. Application code only ever inserts into this table.
  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id');
    t.integer('user_id').unsigned().nullable().references('id').inTable('users');
    t.string('username', 80);
    t.string('action', 40).notNullable();
    t.string('entity', 40).notNullable();
    t.integer('entity_id').unsigned().nullable();
    t.integer('asset_id').unsigned().nullable(); // for the per-asset history timeline
    t.string('summary', 500).notNullable();
    t.json('changes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
    t.index(['entity', 'entity_id']);
    t.index(['created_at']);
  });
}

export async function down(knex) {
  for (const table of [
    'audit_logs', 'asset_valuations', 'asset_documents', 'asset_transfers', 'inspection_records',
    'maintenance_records', 'utilizations', 'assets', 'user_sectors', 'user_kebeles', 'user_kifle_ketemas',
    'users', 'asset_types', 'asset_categories', 'departments', 'sectors', 'kebeles', 'kifle_ketemas',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
