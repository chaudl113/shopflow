import { sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';

/** Gap-free per-scope document numbers, allocated inside the caller's transaction. */
export async function nextNumber(tx: Tx, scope: string, kind: string): Promise<number> {
  const res = await tx.execute<{ value: number }>(sql`
    insert into counters (scope, kind, value) values (${scope}, ${kind}, 1)
    on conflict (scope, kind) do update set value = counters.value + 1
    returning value`);
  return Number(res.rows[0]!.value);
}

export const formatNumber = (prefix: string, storeCode: string, n: number) => `${prefix}-${storeCode}-${String(n).padStart(6, '0')}`;
