import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';

/**
 * Reporting rules
 * - Revenue is net of discounts and excludes tax (what the business keeps).
 * - Refunds count on the day they happen, so a past day's numbers never change.
 * - Dates are local to each store (a 10 pm sale in New York belongs to that day, not the next UTC day).
 * - Service lines are credited to the person who performed them, retail lines to the cashier.
 */
export interface ReportQuery {
  storeIds: string[];
  /** Inclusive local dates, YYYY-MM-DD. */
  from: string;
  to: string;
}

const inList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
const rows = async <T>(q: SQL) => (await db.execute(q)).rows as unknown as T[];

/** Signed revenue events: +sale lines on the sale date, −return lines on the return date. */
function events(q: ReportQuery) {
  return sql`
    with ev as (
      select s.store_id, (s.created_at at time zone st.timezone)::date as day, s.id as sale_id,
             sl.variant_id, sl.name, sl.is_service, coalesce(sl.staff_id, s.cashier_id) as person_id,
             sl.qty, sl.net_cents, sl.tax_cents,
             case when sl.is_service then 0 else sl.unit_cost_cents * sl.qty end as cost_cents
        from sale_lines sl
        join sales s on s.id = sl.sale_id
        join stores st on st.id = s.store_id
       where s.store_id in (${inList(q.storeIds)})
         and (s.created_at at time zone st.timezone)::date between ${q.from}::date and ${q.to}::date
      union all
      select r.store_id, (r.created_at at time zone st.timezone)::date, null,
             sl.variant_id, sl.name, sl.is_service, coalesce(sl.staff_id, s.cashier_id),
             -rl.qty, -rl.net_cents, -rl.tax_cents,
             -- Restocked goods come back at cost; damaged ones stay a cost of the sale.
             case when sl.is_service or not rl.restock then 0 else -sl.unit_cost_cents * rl.qty end
        from return_lines rl
        join sale_returns r on r.id = rl.return_id
        join sale_lines sl on sl.id = rl.sale_line_id
        join sales s on s.id = sl.sale_id
        join stores st on st.id = r.store_id
       where r.store_id in (${inList(q.storeIds)})
         and (r.created_at at time zone st.timezone)::date between ${q.from}::date and ${q.to}::date
    )`;
}

export async function salesReport(q: ReportQuery) {
  if (!q.storeIds.length) return null;
  const ev = events(q);
  const [totals] = await rows<{
    netSalesCents: number;
    refundsCents: number;
    taxCents: number;
    costCents: number;
    servicesCents: number;
    retailCents: number;
    salesCount: number;
    itemsSold: number;
  }>(sql`${ev}
    select coalesce(sum(net_cents), 0)::int as "netSalesCents",
           coalesce(-sum(net_cents) filter (where qty < 0), 0)::int as "refundsCents",
           coalesce(sum(tax_cents), 0)::int as "taxCents",
           coalesce(sum(cost_cents), 0)::int as "costCents",
           coalesce(sum(net_cents) filter (where is_service), 0)::int as "servicesCents",
           coalesce(sum(net_cents) filter (where not is_service), 0)::int as "retailCents",
           count(distinct sale_id)::int as "salesCount",
           coalesce(sum(qty) filter (where not is_service), 0)::int as "itemsSold"
      from ev`);

  const byDay = await rows<{ day: string; netSalesCents: number; servicesCents: number; retailCents: number; salesCount: number }>(sql`${ev}
    select to_char(d.day, 'YYYY-MM-DD') as day,
           coalesce(sum(ev.net_cents), 0)::int as "netSalesCents",
           coalesce(sum(ev.net_cents) filter (where ev.is_service), 0)::int as "servicesCents",
           coalesce(sum(ev.net_cents) filter (where not ev.is_service), 0)::int as "retailCents",
           count(distinct ev.sale_id)::int as "salesCount"
      from generate_series(${q.from}::date, ${q.to}::date, interval '1 day') as d(day)
      left join ev on ev.day = d.day::date
     group by d.day order by d.day`);

  const byStore = await rows<{ storeId: string; name: string; code: string; netSalesCents: number; salesCount: number }>(sql`${ev}
    select st.id as "storeId", st.name, st.code,
           coalesce(sum(ev.net_cents), 0)::int as "netSalesCents",
           count(distinct ev.sale_id)::int as "salesCount"
      from stores st left join ev on ev.store_id = st.id
     where st.id in (${inList(q.storeIds)}) and st.kind = 'store'
     group by st.id order by "netSalesCents" desc, st.name`);

  const byStaff = await rows<{ userId: string; name: string; color: string; role: string; servicesCents: number; retailCents: number; netSalesCents: number; services: number }>(sql`${ev}
    select u.id as "userId", u.name, u.color, u.role,
           coalesce(sum(ev.net_cents) filter (where ev.is_service), 0)::int as "servicesCents",
           coalesce(sum(ev.net_cents) filter (where not ev.is_service), 0)::int as "retailCents",
           sum(ev.net_cents)::int as "netSalesCents",
           coalesce(sum(ev.qty) filter (where ev.is_service), 0)::int as services
      from ev join users u on u.id = ev.person_id
     group by u.id order by "netSalesCents" desc, u.name`);

  const topSellers = await rows<{ variantId: string; name: string; isService: boolean; qty: number; netSalesCents: number }>(sql`${ev}
    select variant_id as "variantId", min(name) as name, bool_or(is_service) as "isService",
           sum(qty)::int as qty, sum(net_cents)::int as "netSalesCents"
      from ev group by variant_id
    having sum(qty) > 0
     order by "netSalesCents" desc, name limit 10`);

  const payments = await rows<{ method: string; amountCents: number }>(sql`
    select p.method, sum(p.amount_cents)::int as "amountCents"
      from payments p
      join shifts sh on sh.id = p.shift_id
      join stores st on st.id = sh.store_id
     where sh.store_id in (${inList(q.storeIds)})
       and (p.created_at at time zone st.timezone)::date between ${q.from}::date and ${q.to}::date
     group by p.method order by "amountCents" desc`);

  const [salesTotals] = await rows<{ grossCents: number }>(sql`
    select coalesce(sum(s.total_cents), 0)::int as "grossCents"
      from sales s join stores st on st.id = s.store_id
     where s.store_id in (${inList(q.storeIds)})
       and (s.created_at at time zone st.timezone)::date between ${q.from}::date and ${q.to}::date`);

  const t = totals!;
  return {
    totals: {
      ...t,
      grossMarginCents: t.netSalesCents - t.costCents,
      avgTicketCents: t.salesCount ? Math.round(salesTotals!.grossCents / t.salesCount) : 0,
    },
    byDay,
    byStore,
    byStaff,
    topSellers,
    payments,
  };
}

/** Items at or below their reorder level, with what is already on the way. */
export async function lowStock(storeIds: string[]) {
  if (!storeIds.length) return [];
  return rows<{
    storeId: string;
    storeName: string;
    variantId: string;
    label: string;
    sku: string;
    onHand: number;
    reorderLevel: number;
    inboundQty: number;
  }>(sql`
    with oh as (
      select store_id, variant_id, sum(qty)::int as on_hand
        from stock_movements where store_id in (${inList(storeIds)})
       group by store_id, variant_id
    ), inbound as (
      select t.to_store_id as store_id, tl.variant_id, sum(tl.qty_sent)::int as qty
        from transfers t join transfer_lines tl on tl.transfer_id = t.id
       where t.status = 'in_transit' and t.to_store_id in (${inList(storeIds)})
       group by 1, 2
    )
    select st.id as "storeId", st.name as "storeName", v.id as "variantId",
           case when v.name = 'Default' then p.name else p.name || ' – ' || v.name end as label,
           v.sku, coalesce(oh.on_hand, 0) as "onHand", v.reorder_level as "reorderLevel",
           coalesce(inbound.qty, 0) as "inboundQty"
      from stores st
      cross join variants v
      join products p on p.id = v.product_id
      left join oh on oh.store_id = st.id and oh.variant_id = v.id
      left join inbound on inbound.store_id = st.id and inbound.variant_id = v.id
     where st.id in (${inList(storeIds)})
       and p.type = 'product' and v.active and p.active
       and v.reorder_level > 0
       and coalesce(oh.on_hand, 0) <= v.reorder_level
     order by coalesce(oh.on_hand, 0) - v.reorder_level, st.name, label`);
}
