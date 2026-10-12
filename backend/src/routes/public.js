import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { notFound } from '../middleware/errors.js';
import { assetByToken, publicCard } from '../lib/publicAsset.js';

// No sign-in: what a printed QR code opens on any phone. Only the asset behind a (random) token, and only what is
// safe to show anyone (see lib/publicAsset.js).
const router = Router();

router.get('/assets/:token', async (req, res) => {
  const card = await publicCard(req.params.token);
  if (!card) throw notFound('No asset matches this label.');
  res.set('Cache-Control', 'no-store');
  res.json(card);
});

/** A photo of that asset (photos only: no other document is ever served here). */
router.get('/assets/:token/photos/:id', async (req, res) => {
  const asset = await assetByToken(req.params.token);
  if (!asset) throw notFound();
  const doc = await db('asset_documents').where({ id: Number(req.params.id) || 0, asset_id: asset.id, doc_type: 'PHOTO' }).first();
  const file = doc && path.join(config.uploadDir, path.basename(doc.stored_name));
  if (!file || !fs.existsSync(file)) throw notFound();
  res.set('Cache-Control', 'public, max-age=3600');
  res.type(doc.mime_type);
  fs.createReadStream(file).pipe(res);
});

export default router;
