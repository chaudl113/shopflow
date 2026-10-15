import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details);
export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(400, 'VALIDATION', 'Invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

/** Postgres error codes we translate into domain errors. */
const PG_UNIQUE = '23505';
const PG_EXCLUSION = '23P01';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause ?? err;
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (cause?.code === PG_UNIQUE) {
    res.status(409).json({ error: { code: 'DUPLICATE', message: `Duplicate value (${cause.constraint ?? 'unique'})` } });
    return;
  }
  if (cause?.code === PG_EXCLUSION) {
    res.status(409).json({ error: { code: 'SLOT_TAKEN', message: 'That time slot was just taken. Please pick another.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
