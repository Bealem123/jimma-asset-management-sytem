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
  // how far (metres) the Kebele Administrator may stand from an asset's recorded location when verifying it on site
  siteCheckMaxDistanceM: Number(process.env.SITE_CHECK_MAX_DISTANCE_M || 300),
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
