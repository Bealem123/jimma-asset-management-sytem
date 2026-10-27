import { config } from '../config.js';

// Every asset of the City lies in Jimma. A position outside it is a typing error, or a laptop guessing where it is
// from its internet connection (it can be off by hundreds of kilometres), never the asset's real place.
const [SOUTH, WEST, NORTH, EAST] = config.jimmaBounds;

export const latInJimma = (v) => v == null || (v >= SOUTH && v <= NORTH);
export const lngInJimma = (v) => v == null || (v >= WEST && v <= EAST);
