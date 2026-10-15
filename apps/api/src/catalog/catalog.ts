import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';

export interface VariantView {
  id: string;
  productId: string;
  productName: string;
  name: string;
  label: string;
  sku: string;
  barcode: string | null;
  type: 'product' | 'service';
  category: string;
  durationMin: number | null;
  priceCents: number;
  defaultPriceCents: number;
  storePriceCents: number | null;
  costCents: number;
  reorderLevel: number;
  active: boolean;
  onHand: number | null;
}

export interface CatalogFilter {
  storeId?: string;
  q?: string;
  type?: 'product' | 'service';
  code?: string;
  variantIds?: string[];
  includeInactive?: boolean;
}

/** Variants with their effective price (store override or default) and on-hand at the store. */
export async function findVariants(db: DbOrTx, f: CatalogFilter): Promise<VariantView[]> {
  const storeId = f.storeId ?? null;
  const like = f.q ? `%${f.q.replace(/[%_]/g, '\\$&')}%` : null;
  const res = await db.execute(sql`
    select v.id, p.id as "productId", p.name as "productName", v.name, v.sku, v.barcode,
           p.type, p.category, p.duration_min as "durationMin",
           coalesce(sp.price_cents, v.price_cents) as "priceCents",
           v.price_cents as "defaultPriceCents", sp.price_cents as "storePriceCents",
           v.cost_cents as "costCents", v.reorder_level as "reorderLevel",
           (v.active and p.active) as active,
           case when ${storeId}::uuid is null or p.type = 'service' then null
                else coalesce((select sum(m.qty) from stock_movements m
                               where m.store_id = ${storeId}::uuid and m.variant_id = v.id), 0)::int end as "onHand"
      from variants v
      join products p on p.id = v.product_id
      left join store_prices sp on sp.variant_id = v.id and sp.store_id = ${storeId}::uuid
     where (${f.includeInactive ?? false} or (v.active and p.active))
       and (${f.type ?? null}::product_type is null or p.type = ${f.type ?? null}::product_type)
       and (${like}::text is null or p.name ilike ${like} or v.sku ilike ${like} or v.name ilike ${like} or p.category ilike ${like})
       and (${f.code ?? null}::text is null or v.barcode = ${f.code ?? null} or lower(v.sku) = lower(${f.code ?? null}))
       ${f.variantIds ? sql`and v.id = any(${f.variantIds}::uuid[])` : sql``}
     order by p.name, v.name`);
  return (res.rows as unknown as Omit<VariantView, 'label'>[]).map((r) => ({
    ...r,
    label: r.name === 'Default' ? r.productName : `${r.productName} – ${r.name}`,
  }));
}
