// Evidence that a Kebele Administrator verified a newly registered asset on site: where they stood (GPS), how far
// that is from the recorded location, whether they scanned the asset's QR label, the condition they found and a
// photo taken there. The Kifle Ketema Administrator sees it before approving.
export async function up(knex) {
  await knex.schema.createTable('asset_site_checks', (t) => {
    t.increments('id');
    t.integer('asset_id').unsigned().notNullable().references('id').inTable('assets');
    t.integer('user_id').unsigned().nullable().references('id').inTable('users');
    t.decimal('latitude', 10, 7).notNullable();
    t.decimal('longitude', 10, 7).notNullable();
    t.integer('accuracy_m').unsigned().nullable(); // how precise the phone said its position was
    t.integer('distance_m').unsigned().nullable(); // from the recorded location; null when none was recorded
    t.boolean('far').notNullable().defaultTo(false); // further away than allowed
    t.boolean('location_saved').notNullable().defaultTo(false); // the asset had no location: this one was saved
    t.boolean('qr_scanned').notNullable().defaultTo(false); // the asset's own label was scanned
    t.string('found_condition', 20).notNullable();
    t.integer('photo_document_id').unsigned().nullable().references('id').inTable('asset_documents');
    t.string('note', 500).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['asset_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTable('asset_site_checks');
}
