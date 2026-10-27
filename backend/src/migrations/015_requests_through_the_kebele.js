// Requests follow the registration chain: the Sector Administrator asks, the Kebele Administrator reviews, the Kifle
// Ketema Administrator gives the final approval. Transfers and retirements, which used to need a single approval,
// now take both steps. Only policies at the old default (one approval) change; "no approval" stays as it is.
const TYPES = ['TRANSFER', 'RETIREMENT'];

export async function up(knex) {
  await knex('workflow_configs').whereIn('request_type', TYPES).where({ requires_approval: true, steps: 1 }).update({ steps: 2 });
}

export async function down(knex) {
  await knex('workflow_configs').whereIn('request_type', TYPES).where({ requires_approval: true, steps: 2 }).update({ steps: 1 });
}
