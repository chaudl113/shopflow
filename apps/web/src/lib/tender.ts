export type Method = 'cash' | 'card' | 'other';
export interface Tender {
  method: Method;
  amountCents: number;
}

/** What is still owed and the change due, mirroring the server's settlement rules. */
export function tenderStatus(totalCents: number, tenders: Tender[]) {
  const paid = tenders.reduce((s, t) => s + (t.amountCents > 0 ? t.amountCents : 0), 0);
  const cash = tenders.filter((t) => t.method === 'cash').reduce((s, t) => s + Math.max(t.amountCents, 0), 0);
  const over = Math.max(paid - totalCents, 0);
  return {
    paidCents: paid,
    dueCents: Math.max(totalCents - paid, 0),
    changeCents: over,
    /** Card/other cannot be over-tendered; change must come from cash. */
    valid: paid >= totalCents && over <= cash,
  };
}

/** Quick cash buttons: exact, then the next round bills above the amount due. */
export function quickCash(dueCents: number): number[] {
  if (dueCents <= 0) return [];
  const out = new Set<number>([dueCents]);
  for (const step of [500, 1000, 2000, 5000, 10000]) {
    const next = Math.ceil(dueCents / step) * step;
    if (next > dueCents) out.add(next);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}
