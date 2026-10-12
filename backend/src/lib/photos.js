import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { badRequest, notFound } from '../middleware/errors.js';

// Profile pictures. They are stored in the upload folder as photo-<uuid>.<ext> (so the files backup copies them),
// and are only served to signed-in users. The browser crops and shrinks a picture before sending it.

const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_BYTES = 3 * 1024 * 1024;

// the first bytes must match the declared type: a renamed file is refused
const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
}).single('photo');

/** A short token that changes with every new picture, so the browser can cache each one. */
export const photoVersion = (name) => (name ? name.slice(6, 18) : null);

/** Store `file` as the picture of `userId`, replacing (and deleting) the previous one. Returns the new file name. */
export async function savePhoto(userId, file) {
  if (!file) throw badRequest('Choose a picture to upload.', { photo: 'Choose a picture.' });
  if (!TYPES[file.mimetype] || !SIGNATURES[file.mimetype](file.buffer)) throw badRequest('Use a JPG, PNG or WebP picture.', { photo: 'Use a JPG, PNG or WebP picture.' });
  if (file.size > MAX_BYTES) throw badRequest('The picture is too large (maximum 3 MB).', { photo: 'Maximum 3 MB.' });
  const name = `photo-${crypto.randomUUID()}${TYPES[file.mimetype]}`;
  await fs.promises.mkdir(config.uploadDir, { recursive: true });
  await fs.promises.writeFile(path.join(config.uploadDir, name), file.buffer);
  const old = await db('users').where({ id: userId }).first('photo_name');
  await db('users').where({ id: userId }).update({ photo_name: name });
  if (old?.photo_name) await unlinkPhoto(old.photo_name);
  return name;
}

/** Remove the picture of `userId`. Returns true when there was one. */
export async function removePhoto(userId) {
  const row = await db('users').where({ id: userId }).first('photo_name');
  if (!row?.photo_name) return false;
  await db('users').where({ id: userId }).update({ photo_name: null });
  await unlinkPhoto(row.photo_name);
  return true;
}

/** Send the picture of `userId`, or 404 when there is none. */
export async function sendPhoto(res, userId) {
  const row = await db('users').where({ id: userId }).first('photo_name');
  if (!row?.photo_name) throw notFound('No profile picture.');
  const file = path.join(config.uploadDir, path.basename(row.photo_name));
  if (!fs.existsSync(file)) throw notFound('No profile picture.');
  // a new picture gets a new version in its URL, so each version can be cached
  res.set('Cache-Control', 'private, max-age=604800, immutable');
  res.type(path.extname(file));
  fs.createReadStream(file).pipe(res);
}

const unlinkPhoto = (name) => fs.promises.unlink(path.join(config.uploadDir, path.basename(name))).catch(() => {});
