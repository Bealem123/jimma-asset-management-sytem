// QR labels that were replaced (lost, damaged, stolen ...). The asset gets a new public token; the old one is kept
// here so that scanning the old label says it was cancelled instead of opening the asset.
export async function up(knex) {
  await knex.schema.createTable('asset_retired_labels', (t) => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('id').inTable('assets');
    t.string('token', 32).notNullable().unique();
    t.string('reason', 20).notNullable();
    t.string('note', 500).nullable();
    t.integer('retired_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('retired_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTable('asset_retired_labels');
}
