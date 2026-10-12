// Each user can choose the language of the interface: en (English), am (Amharic), om (Afaan Oromo).
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('language', 5).notNullable().defaultTo('en');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => { t.dropColumn('language'); });
}
