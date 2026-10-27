// A follow-up raised by someone else (a failed inspection, a verification problem) is not closed on the word of the
// asset's keeper alone: the Sector Administrator reports the work done (status REPORTED), then the Inspector or a
// verification manager checks it and closes it, or reopens it. Who reported it, and when, is kept beside who closed it.
const TYPES = ['FOLLOW_UP_REPORTED', 'FOLLOW_UP_REOPENED'];

export async function up(knex) {
  await knex.schema.alterTable('follow_up_actions', (t) => {
    t.integer('reported_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('reported_at').nullable();
  });
  for (const type of TYPES) {
    await knex('notification_rules').insert({ type, enabled: true, lead_days: null, email: false, sms: false }).onConflict('type').ignore();
  }
}

export async function down(knex) {
  await knex('follow_up_actions').where({ status: 'REPORTED' }).update({ status: 'OPEN' });
  await knex.schema.alterTable('follow_up_actions', (t) => {
    t.dropForeign(['reported_by']);
    t.dropColumn('reported_by');
    t.dropColumn('reported_at');
  });
  await knex('notification_rules').whereIn('type', TYPES).del();
}
