# Architecture

```
                 ┌─────────────────────────── browser ───────────────────────────┐
                 │  Back office + POS (Vue 3, Pinia, shadcn-vue)   /book/:slug    │
                 └───────────────┬───────────────────────────────────┬───────────┘
                                 │ /api/* (JWT)                      │ /api/public/* (no auth, rate limited)
                 ┌───────────────▼───────────────────────────────────▼───────────┐
                 │  Express 5 API (also serves the built web app)                 │
                 │   routes/*        thin: auth, store scoping, zod validation    │
                 │   ─────────────────────────────────────────────────────────    │
                 │   pos/sales       quote · sell · return     ┐                  │
                 │   pos/shifts      open · pay in/out · close │ one DB           │
                 │   inventory/ledger lockStock · applyMovements│ transaction      │
                 │   transfers/      send · receive · cancel   │ per command      │
                 │   booking/        availability · book · check out ┘            │
                 │   reports/        read-only SQL over the same tables           │
                 └───────────────────────────────┬───────────────────────────────┘
                                                 │ Drizzle (typed queries + raw SQL)
                 ┌───────────────────────────────▼───────────────────────────────┐
                 │ PostgreSQL 16                                                  │
                 │  stock_movements (append-only)   sales / sale_lines / payments │
                 │  transfers / transfer_lines      shifts / cash_movements        │
                 │  bookings  ── EXCLUDE USING gist (staff, time range)           │
                 │  counters (receipt and transfer numbers per store)             │
                 └────────────────────────────────────────────────────────────────┘
```

## Decisions

**The ledger is the source of truth for stock.**
- There is no `quantity` column to update. Every change inserts a signed row into `stock_movements`, and on hand is `SUM(qty)`.
- This gives a full audit trail (who, when, why, at what cost) for free.
- It also means a stock count only posts the difference.
- At the current data size, summing per item is cheap and indexed. If it grows, a snapshot table can be added without changing the model.

**Concurrency is handled in the database, not in application memory.**
- **Stock:** `pg_advisory_xact_lock` per store+variant, taken in sorted order. The balance check and the insert happen while the lock is held.
- **Bookings:** an exclusion constraint makes overlapping live bookings impossible, whatever code path writes them. The API turns the violation into a 409.
- **Sales:**
  - The lock order is fixed (shift FOR SHARE → booking FOR UPDATE → stock locks → counter) so that two commands can't deadlock.
  - The counter comes last because it serialises receipt numbers per store; holding it for the shortest time keeps tills fast.
- **Transfers and returns:** the parent row is locked FOR UPDATE, so receiving twice or returning more than was sold is impossible.

**Money uses integer cents end to end.**
- Prices, discounts, tax and payments are integers.
- Order-level discounts and tax are allocated to lines by largest remainder, so lines always sum to the receipt.
- The server prices every cart from its own catalog. The client sends variant IDs and quantities, never prices.

**Time zones belong to the store.**
- Timestamps are stored as `timestamptz`.
- Working hours, booking slots, receipt dates and report days use the store's IANA zone (`America/New_York` in the demo), so a server or browser in another zone shows the same numbers.
- Slots are built from wall-clock times on each local day, which keeps "9:00" at 9:00 across daylight-saving changes.

**Reports read the operational tables directly.**
- One SQL CTE produces signed revenue events: sale lines on the sale day, return lines negative on the return day.
- Every breakdown (day, store, person, item) is a `GROUP BY` over that CTE, so the totals can't disagree with each other.
- Cost of goods uses the standard cost captured on each sale line at the time of sale.

**Why Express rather than NestJS.**
- The difficult parts here are transactions and locks.
- Plain modules with explicit `db.transaction` blocks keep them readable and testable.
- Domain functions accept an optional `at` time, which lets tests (and the seed) create backdated history through the same code path that real requests use.

**Front end.**
- Vue 3 with Pinia stores for the session, the cart and the current shift.
- The UI is built from shadcn-vue components, themed through CSS variables, with dark mode.
- The POS is scan-first, with the camera scanner as an option on phones.
- The cart is re-quoted by the server after each change, so the screen never shows a price the server would not charge.

## Testing strategy

| Layer | What it proves | Where |
| --- | --- | --- |
| API integration (Vitest + supertest, real Postgres) | Money, stock, shifts, transfers, bookings, reports, permissions, demo mode and the simulator. Races are fired as real parallel requests. | `apps/api/test/*.test.ts` |
| Pure unit | Price, discount, tax and refund rounding | `apps/api/src/lib/money.test.ts` |
| Web unit | Cart behaviour, tender and change, formatting | `apps/web/src/**/__tests__` |
| End to end (Playwright) | Online booking → POS checkout → stock −1 → dashboard +subtotal; landing → one click into each role | `e2e/flow.spec.ts`, `e2e/landing.spec.ts` |

## Deployment shape

One multi-stage `Dockerfile` builds one image (`node:22-alpine`, about 66 MB compressed):

- **Build stage.** Compiles the API with `tsc` and the web app with Vite.
- **Dependency stage.** Installs only the API's production dependencies. The workspace list is cut down to the API first, so the web toolchain never reaches the image.
- **Runtime stage.** Holds the compiled API, its migrations and the static web build, and runs as the `node` user.
  - Express serves `/api/*`, then static assets: hashed files are cached as immutable, and every other path falls back to `index.html` with `no-cache`.
  - Its entry point, `src/start.ts`, applies migrations, loads demo data into an empty database, then serves.

The local `docker-compose.yml` adds a Postgres container with a named volume. `deploy/compose.vps.yml` runs the same image behind a shared Postgres and reverse proxy, with no host ports.

## Public demo mode

`DEMO_PUBLIC=1` (see the README) adds four things without touching the domain modules:

- one-click sign-in;
- a lock on the shared demo accounts;
- tighter rate limits;
- a simulator in `src/demo/` that keeps "today" alive.

The simulator works like a robot cashier:

- It replays a deterministic plan of walk-ins per store and local day through `createSale`, and checks out finished appointments through the same path as the POS.
- Walk-ins carry a client reference derived from the store, the day and the walk-in's index, so the sale idempotency added for double-clicks also makes every run safe to repeat.
- The nightly `demo:reset` and the 5-minute run share a session advisory lock.
- The reset truncates only the tables defined in `schema.ts`, so it is safe on a shared database server.
