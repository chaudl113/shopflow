import { and, asc, eq } from 'drizzle-orm';
import { config } from './config.js';
import { db } from './db/client.js';
import { stores } from './db/schema.js';

/** What the web app needs to know before sign-in: demo mode and where the public booking page lives. */
export async function appMeta() {
  const [booking] = await db
    .select({ slug: stores.slug, name: stores.name })
    .from(stores)
    .where(and(eq(stores.kind, 'store'), eq(stores.bookingEnabled, true)))
    .orderBy(asc(stores.code))
    .limit(1);
  return { demo: config.demoPublic, bookingPage: booking ?? null };
}
