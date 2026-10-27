import 'dotenv/config';
import path from 'node:path';

const isTest = process.env.NODE_ENV === 'test';

export const config = {
  isTest,
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  uploadDir: path.resolve(`${process.env.UPLOAD_DIR || 'uploads'}${isTest ? '-test' : ''}`),
  maxUploadBytes: 10 * 1024 * 1024,
  separationOfDuties: (process.env.SEPARATION_OF_DUTIES ?? 'true') !== 'false',
  // verifying a registration on site: the Kebele Administrator must stand within this many metres of the asset's
  // recorded location (further is refused), with a phone reading at least this precise (a rougher one is refused)
  siteCheckMaxDistanceM: Number(process.env.SITE_CHECK_MAX_DISTANCE_M || 50),
  siteCheckMaxAccuracyM: Number(process.env.SITE_CHECK_MAX_ACCURACY_M || 50),
  // Jimma City as a box (south, west, north, east): asset locations outside it are refused, and the map stays inside it
  jimmaBounds: (process.env.JIMMA_BOUNDS || '7.58,36.72,7.78,36.95').split(',').map(Number),
  // the city centre (latitude, longitude): where the map draws an asset with no position and no area centre set yet
  jimmaCentre: (process.env.JIMMA_CENTRE || '7.6738,36.8346').split(',').map(Number),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: isTest ? process.env.DB_NAME_TEST : process.env.DB_NAME,
  },
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  throw new Error('JWT_SECRET is missing or too short. Copy .env.example to .env and set it.');
}
