// The centre of each Kifle Ketema and Kebele, as the City sets it in Master data. An asset with no GPS position (or one
// outside Jimma) is drawn on the map at the centre of the Kebele it is registered in, or of its Kifle Ketema, and marked
// as placed there, so every asset appears in its own area. Empty until the City enters it: nothing is guessed.
const TABLES = ['kifle_ketemas', 'kebeles'];

export async function up(knex) {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.decimal('latitude', 10, 7).nullable();
      t.decimal('longitude', 10, 7).nullable();
    });
  }
}

export async function down(knex) {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('latitude');
      t.dropColumn('longitude');
    });
  }
}
