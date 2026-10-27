// A temporary password (a new account, or one an administrator reset) works for a limited time only
// (TEMP_PASSWORD_DAYS, 7 by default): an account nobody took up does not keep a working password for ever.
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => { t.datetime('temp_password_expires_at').nullable(); });
  // the temporary passwords already given out get the full period from today
  await knex('users').where({ must_change_password: true }).update({ temp_password_expires_at: new Date(Date.now() + 7 * 86400000) });
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => { t.dropColumn('temp_password_expires_at'); });
}
