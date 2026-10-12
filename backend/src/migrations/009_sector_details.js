// What each sector records about its own assets (see lib/sectorFields.js), kept with the asset.
export async function up(knex) {
  await knex.schema.alterTable('assets', (t) => {
    t.json('details').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('assets', (t) => { t.dropColumn('details'); });
}
