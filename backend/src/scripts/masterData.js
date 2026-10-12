// Starting master data, taken from the project documents.
// EVERYTHING here is a WORKING LABEL (is_validated = false) until Jimma City confirms it:
//  - the three Kifle Ketemas were named in discussion but not yet confirmed
//  - the 13 sectors are working project labels, not an official classification
//  - the asset categories/types are candidates to validate with the City
//  - the 13 Kebele names were supplied by the project owner (6 October 2026). WHICH Kifle Ketema each belongs to
//    has NOT been confirmed, so they are seeded unlinked; link them in Master data once the City confirms.
// Departments are intentionally NOT seeded: their official list is unknown.

export const KIFLE_KETEMAS = ['Hirmata', 'Jiren', 'Gibe'];

// The 13 Kebeles of Jimma City (3 Kifle Ketemas). Spelling as supplied; to be confirmed by the City.
export const KEBELES = [
  'Jiren', 'Ginjo', 'Ginjo Guduru', 'Mendera Kochi', 'Awetu Mendera', 'Bosa Addis Ketema', 'Bosa Kito',
  'Hirmata Mentina', 'Mentina', 'Hirmata', 'Hirmata Merkato', 'Becho Bore', 'Seto Semero',
];

export const SECTORS = [
  ['AGR', 'Agriculture (Lemat Trufat)', 'Agricultural activities and related City-authorised revenue.'],
  ['LND', 'Land', 'Land lease, land-use related revenue and other authorised land charges.'],
  ['INV', 'Investment', 'Investment-related revenue. To confirm: revenue source, administrative function, or cross-office category?'],
  ['BUS', 'Business & Trade', 'Businesses, commercial activities, licences, taxes and fees.'],
  ['EXP', 'Export', 'Export-related activities. To confirm: does the City have an authorised revenue role?'],
  ['SRV', 'Services', 'Municipal and administrative services. To confirm overlap with Goods & Services.'],
  ['MFG', 'Manufacturing', 'Manufacturing and industrial activities. To confirm overlap with Business & Trade.'],
  ['CON', 'Construction', 'Construction permits, inspections, and construction equipment and facilities.'],
  ['TOU', 'Tourism', 'Tourism-related facilities, sites and charges.'],
  ['TRN', 'Transportation', 'Parking, terminals, vehicles and other transport-related assets and revenue.'],
  ['GDS', 'Goods & Services', 'City-provided goods and services. To confirm overlap with Services.'],
  ['RNT', 'Rent', 'Rental income from City-owned land, buildings, shops, markets, halls and other facilities.'],
  ['ASK', 'Assura / Kote', 'Local Jimma category. Official spelling, meaning, legal basis and payer MUST be verified.'],
];

export const CATEGORIES = {
  Land: ['Agricultural land', 'Farm (agricultural property)', 'Commercial land', 'Industrial land', 'Institutional land', 'Other city land', 'Land/property leased for use'],
  Buildings: [
    'Office building', 'School', 'Health facility', 'Market', 'Shop', 'Stall', 'Kiosk', 'Commercial building', 'Rental building',
    'Residential building/house', 'Warehouse', 'Hall', 'Restaurant/cafeteria premises', 'Workshop premises', 'Garage',
  ],
  Infrastructure: ['Road', 'Bridge', 'Drainage', 'Water infrastructure', 'Streetlight', 'Other public infrastructure'],
  Vehicles: ['Bus', 'Truck', 'Pickup', 'Service vehicle', 'Ambulance', 'Motorcycle'],
  'Machinery & Equipment': ['Excavator', 'Loader', 'Tractor', 'Generator', 'Workshop equipment', 'Office equipment'],
  'Public Facilities': ['Parking facility', 'Recreation facility', 'Sports facility'],
  'Other Assets': ['Other'],
};

import { db } from '../db.js';
import { DEFAULT_WORKFLOWS, NOTIFICATION_TYPES } from '../lib/constants.js';

/** Insert the starting master data. Safe to run repeatedly: existing rows are left untouched. */
export async function seedMaster(conn = db) {
  for (const name of KIFLE_KETEMAS) {
    await conn('kifle_ketemas').insert({ name, is_validated: false }).onConflict('name').ignore();
  }
  for (const name of KEBELES) {
    // names are unique across the City, whether or not the Kifle Ketema is known yet
    const exists = await conn('kebeles').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first();
    if (!exists) await conn('kebeles').insert({ name, kifle_ketema_id: null, is_validated: false });
  }
  for (const [code, name, description] of SECTORS) {
    await conn('sectors').insert({ code, name, description, is_validated: false }).onConflict('code').ignore();
  }
  for (const [category, types] of Object.entries(CATEGORIES)) {
    await conn('asset_categories').insert({ name: category, is_validated: false }).onConflict('name').ignore();
    const { id } = await conn('asset_categories').where({ name: category }).first();
    for (const type of types) {
      await conn('asset_types').insert({ category_id: id, name: type }).onConflict(['category_id', 'name']).ignore();
    }
  }
  await seedSystem(conn);
}

/** Default approval policy and notification rules. Safe to run repeatedly. */
export async function seedSystem(conn = db) {
  for (const [type, cfg] of Object.entries(DEFAULT_WORKFLOWS)) {
    await conn('workflow_configs').insert({ request_type: type, ...cfg }).onConflict('request_type').ignore();
  }
  for (const [type, meta] of Object.entries(NOTIFICATION_TYPES)) {
    await conn('notification_rules').insert({ type, enabled: true, lead_days: meta.lead ?? null, email: false, sms: false }).onConflict('type').ignore();
  }
}
