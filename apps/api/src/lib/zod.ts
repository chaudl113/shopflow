import { z } from 'zod';

export const uuid = z.uuid();
export const cents = z.number().int().min(0).max(100_000_000);
export const qty = z.number().int().min(1).max(100_000);
