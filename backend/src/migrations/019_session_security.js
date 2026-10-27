// Sign-in security: wrong passwords in a row lock the account for a while (whatever address they come from), and a
// session with no activity for a while ends (lib/security.js sets how many and how long).
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.integer('failed_logins').unsigned().notNullable().defaultTo(0);
    t.datetime('locked_until').nullable();
    t.datetime('last_seen_at').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('failed_logins');
    t.dropColumn('locked_until');
    t.dropColumn('last_seen_at');
  });
}
