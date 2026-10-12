// Accounts created in bulk get a temporary password; the person must choose their own at first sign-in.
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('must_change_password').notNullable().defaultTo(false);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => { t.dropColumn('must_change_password'); });
}
