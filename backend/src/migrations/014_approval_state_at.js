// When a registration reached its current step of the approval chain. Waiting times count from it, so correcting a
// record while it waits (a purchase price, a photo ...) no longer makes it look as if it had just arrived.
// Existing assets take the time of their last step in the audit log, or their registration when there is none.
const STEPS = ['SUBMIT', 'REVIEW', 'APPROVE', 'ACTIVATE', 'REJECT'];

export async function up(knex) {
  await knex.schema.alterTable('assets', (t) => {
    t.timestamp('approval_state_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `UPDATE assets SET approval_state_at = COALESCE(
      (SELECT MAX(l.created_at) FROM audit_logs l WHERE l.asset_id = assets.id AND l.action IN (${STEPS.map(() => '?').join(',')})),
      assets.created_at)`,
    STEPS,
  );
}

export async function down(knex) {
  await knex.schema.alterTable('assets', (t) => {
    t.dropColumn('approval_state_at');
  });
}
