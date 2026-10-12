import { db } from '../db.js';
import { seedMaster } from './masterData.js';

try {
  await seedMaster();
  console.log('Master data seeded: 3 Kifle Ketemas, 13 Kebeles, 13 working sectors, asset categories and types,');
  console.log('default approval workflows and notification rules.');
  console.log('All of it is marked "not validated" until Jimma City confirms it.');
  console.log('The 13 Kebeles are listed WITHOUT a Kifle Ketema: link each one in Master data once the City confirms the mapping.');
  console.log('Departments are not seeded; an administrator must enter the official list.');
} catch (err) {
  console.error('Seeding failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
