// A person is registered by their own name and their father's name (and, if given, their grandfather's), the way
// Ethiopian names are written. full_name stays the name shown everywhere: it is these parts joined. Accounts made
// before are split on their spaces: first word, second word, the rest.
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('first_name', 80).nullable();
    t.string('father_name', 80).nullable();
    t.string('grandfather_name', 80).nullable();
  });
  const users = await knex('users').select('id', 'full_name');
  for (const u of users) {
    const [first = null, father = null, ...rest] = String(u.full_name || '').trim().split(/\s+/).filter(Boolean);
    await knex('users').where({ id: u.id }).update({
      first_name: first?.slice(0, 80) ?? null, father_name: father?.slice(0, 80) ?? null, grandfather_name: rest.join(' ').slice(0, 80) || null,
    });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('first_name');
    t.dropColumn('father_name');
    t.dropColumn('grandfather_name');
  });
}
