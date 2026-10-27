// Migration 012: Enforce database-level data integrity constraints.
// Adds MySQL CHECK constraints on monetary, date, coordinate, and quantity ranges.

const CONSTRAINTS = [
  {
    table: 'assets',
    name: 'chk_assets_acquisition_cost',
    check: 'acquisition_cost IS NULL OR acquisition_cost >= 0',
  },
  {
    table: 'assets',
    name: 'chk_assets_salvage_value',
    check: 'salvage_value IS NULL OR salvage_value >= 0',
  },
  {
    table: 'assets',
    name: 'chk_assets_current_valuation',
    check: 'current_valuation IS NULL OR current_valuation >= 0',
  },
  {
    table: 'assets',
    name: 'chk_assets_latitude',
    check: 'latitude IS NULL OR (latitude >= -90.0 AND latitude <= 90.0)',
  },
  {
    table: 'assets',
    name: 'chk_assets_longitude',
    check: 'longitude IS NULL OR (longitude >= -180.0 AND longitude <= 180.0)',
  },
  {
    table: 'assets',
    name: 'chk_assets_useful_life',
    check: 'useful_life_years IS NULL OR (useful_life_years >= 1 AND useful_life_years <= 200)',
  },
  {
    table: 'asset_acquisitions',
    name: 'chk_acquisitions_cost',
    check: 'cost IS NULL OR cost >= 0',
  },
  {
    table: 'asset_valuations',
    name: 'chk_valuations_value',
    check: 'value >= 0',
  },
  {
    table: 'asset_revenues',
    name: 'chk_revenues_amount',
    check: 'amount >= 0',
  },
  {
    table: 'asset_disposals',
    name: 'chk_disposals_value',
    check: 'disposal_value IS NULL OR disposal_value >= 0',
  },
  {
    table: 'maintenance_records',
    name: 'chk_maintenance_cost',
    check: 'cost IS NULL OR cost >= 0',
  },
  {
    table: 'utilizations',
    name: 'chk_utilizations_dates',
    check: 'end_date IS NULL OR end_date >= start_date',
  },
  {
    table: 'asset_reservations',
    name: 'chk_reservations_dates',
    check: 'end_at > start_at',
  },
];

export async function up(knex) {
  for (const c of CONSTRAINTS) {
    await knex.raw(`ALTER TABLE \`${c.table}\` ADD CONSTRAINT \`${c.name}\` CHECK (${c.check})`);
  }
}

export async function down(knex) {
  for (const c of CONSTRAINTS) {
    try {
      await knex.raw(`ALTER TABLE \`${c.table}\` DROP CHECK \`${c.name}\``);
    } catch {
      // ignore if constraint does not exist
    }
  }
}
