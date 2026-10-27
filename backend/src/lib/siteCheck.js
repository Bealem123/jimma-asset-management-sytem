import { z } from 'zod';
import { CONDITIONS } from './constants.js';
import { CARD_RE } from './publicAsset.js';
import { latInJimma, lngInJimma } from './jimma.js';
import { idRef, oneOf, optStr } from './schemas.js';

// On-site verification of a newly registered asset by the Kebele Administrator (the "review" step).

// a verifier on site is in Jimma: a position elsewhere comes from a device without GPS guessing it
const OUTSIDE = 'Your location is outside Jimma City, so it cannot be right. Turn on GPS (location) on your phone, step outside and try again.';

/** What the Kebele Administrator brings back from the site. */
export const evidenceSchema = z.object({
  latitude: z.coerce.number({ error: 'Your location is needed: allow location access on your phone.' }).min(-90).max(90).refine(latInJimma, OUTSIDE),
  longitude: z.coerce.number({ error: 'Your location is needed: allow location access on your phone.' }).min(-180).max(180).refine(lngInJimma, OUTSIDE),
  // how precise the phone says its reading is: without it, nobody can tell whether the verifier stood at the asset
  accuracy_m: z.coerce.number({ error: 'Your phone did not say how precise its location is. Measure again with location (GPS) turned on.' }).min(0).max(100000),
  qr_code: optStr(300), // the text read from the label, if one was scanned
  found_condition: oneOf(CONDITIONS, 'Condition found'),
  photo_document_id: idRef,
  note: optStr(500),
});

/** Distance in metres between two points on the earth (haversine). */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Is the scanned text this asset's own label? Its QR code holds the public card address /a/<token> (a replaced label's
 * old token does not count); its barcode, and labels printed before, hold the asset code or a URL ending in /scan/<code>.
 */
export function isOwnLabel(text, asset) {
  const s = String(text || '').trim();
  const card = CARD_RE.exec(s);
  if (card) return Boolean(asset.public_token) && card[1] === asset.public_token;
  return Boolean(s) && (s === asset.asset_code || s.endsWith(`/scan/${asset.asset_code}`));
}

/**
 * Compare where the verifier stood with where the asset is recorded. "Far" means further than the allowed distance;
 * a rough reading no longer widens it (readings rougher than the accuracy limit are refused before this).
 * Without a recorded location, this one is used.
 */
export function placeCheck(asset, e, maxDistance) {
  const recorded = asset.latitude != null && asset.longitude != null;
  const distance = recorded ? Math.round(distanceMeters(asset.latitude, asset.longitude, e.latitude, e.longitude)) : null;
  return { distance_m: distance, far: recorded && distance > maxDistance, location_saved: !recorded };
}
