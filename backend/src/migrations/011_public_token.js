// The random part of the address a printed QR code opens (the public asset card). Random, so that nobody can read
// the register by trying AST-000001, AST-000002 ...: only someone holding the label can open the card.
export async function up(knex) {
  await knex.schema.alterTable('assets', (t) => {
    t.string('public_token', 32).nullable().unique();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('assets', (t) => { t.dropColumn('public_token'); });
}
