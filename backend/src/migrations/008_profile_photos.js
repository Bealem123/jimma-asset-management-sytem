// Every account can carry a profile picture: the stored file name, beside the asset documents in the upload folder.
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('photo_name', 80).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => { t.dropColumn('photo_name'); });
}
