import { z } from 'zod';
import { CONDITIONS } from './constants.js';
import { idRef, oneOf, optStr } from './schemas.js';

// On-site verification of a newly registered asset by the Kebele Administrator (the "review" step).

/** What the Kebele Administrator brings back from the site. */
export const evidenceSchema = z.object({
  latitude: z.coerce.number({ error: 'Your location is needed: allow location access on your phone.' }).min(-90).max(90),
  longitude: z.coerce.number({ error: 'Your location is needed: allow location access on your phone.' }).min(-180).max(180),
  accuracy_m: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().min(0).max(100000).nullable()).default(null),
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

/** Is the scanned text this asset's own label? A label holds the asset code, or a URL ending in /scan/<code>. */
export function isOwnLabel(text, code) {
  const s = String(text || '').trim();
  return Boolean(s) && (s === code || s.endsWith(`/scan/${code}`));
}

/**
 * Compare where the verifier stood with where the asset is recorded. "Far" means further than the allowed distance
 * (or than the phone's own stated accuracy, when that is larger). Without a recorded location, this one is used.
 */
export function placeCheck(asset, e, maxDistance) {
  const recorded = asset.latitude != null && asset.longitude != null;
  const distance = recorded ? Math.round(distanceMeters(asset.latitude, asset.longitude, e.latitude, e.longitude)) : null;
  const allowed = Math.max(maxDistance, Math.round(e.accuracy_m || 0));
  return { distance_m: distance, far: recorded && distance > allowed, location_saved: !recorded };
}
