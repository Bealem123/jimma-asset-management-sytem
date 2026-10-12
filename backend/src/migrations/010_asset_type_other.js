// A type that is not (yet) in the master list, typed by the person registering the asset ("Other").
export async function up(knex) {
  await knex.schema.alterTable('assets', (t) => {
    t.string('asset_type_other', 120).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('assets', (t) => { t.dropColumn('asset_type_other'); });
}
