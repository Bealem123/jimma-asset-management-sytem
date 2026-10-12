import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const forbidden = (msg = 'You do not have permission to do this.') => new HttpError(403, msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Validate `data` against a zod schema; throws a 400 with per-field messages. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const details = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    details[key] ||= issue.message;
  }
  throw new HttpError(400, 'Please correct the highlighted fields.', details);
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid input.' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File is too large (maximum 10 MB).' });
  }
  if (err?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'A record with the same unique value already exists.' });
  }
  if (err?.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'This record is in use by other records and cannot be removed. Deactivate it instead.' });
  }
  if (err?.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: 'One of the selected values does not exist.' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
}
