import knex from 'knex';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

export const db = knex({
  client: 'mysql2',
  connection: { ...config.db, dateStrings: true, decimalNumbers: true },
  pool: { min: 0, max: 10 },
  migrations: { directory: fileURLToPath(new URL('./migrations', import.meta.url)) },
});
