// Reporting follows the chain of responsibility only: each level sends its monthly report to the level above
// (see 006_monthly_reports). The free-standing report section, its e-mail schedules and its print settings are gone.
const PRINT_SETTINGS = ['org_name', 'org_contact', 'report_footer'];

export async function up(knex) {
  await knex.schema.dropTableIfExists('report_schedules');
  await knex('system_settings').whereIn('key', PRINT_SETTINGS).delete();
  // the permission to run reports became the permission to export asset lists; scheduling is gone
  await knex('role_permissions').where({ permission: 'report.view' }).update({ permission: 'asset.export' });
  await knex('role_permissions').where({ permission: 'report.schedule' }).delete();
}

export async function down(knex) {
  await knex('role_permissions').where({ permission: 'asset.export' }).update({ permission: 'report.view' });
  await knex.schema.createTable('report_schedules', (t) => {
    t.increments('id');
    t.string('report_slug', 60).notNullable();
    t.string('frequency', 10).notNullable();
    t.string('recipients', 500).notNullable();
    t.string('format', 5).notNullable().defaultTo('csv');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.date('last_run_on').nullable();
    t.integer('created_by').unsigned().notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}
