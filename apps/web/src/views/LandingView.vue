<script setup lang="ts">
import { ArrowRightLeftIcon, BookOpenIcon, CalendarCheckIcon, LogInIcon, WalletIcon } from '@lucide/vue';
import DemoEntry from '@/components/DemoEntry.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppMeta } from '@/lib/meta';

const { meta } = useAppMeta();

const points = [
  {
    icon: BookOpenIcon,
    title: 'Stock is a ledger',
    lead: 'No quantity column to overwrite.',
    body: 'Receiving, selling, returning, counting and transferring each append a movement; on hand is their sum, with a running balance per item. A per store + item advisory lock means two tills can never both sell the last unit.',
  },
  {
    icon: ArrowRightLeftIcon,
    title: 'Two-step transfers',
    lead: 'Sent is not the same as received.',
    body: 'Sending moves stock out of the source and into transit, where both stores can see it. Receiving lands it, and a short delivery records the missing units with a reason. A transfer can be received only once, and cancelling puts the stock back.',
  },
  {
    icon: WalletIcon,
    title: 'Cash shifts',
    lead: 'Every cash payment belongs to a drawer.',
    body: 'Open with a float, record pay-ins and pay-outs, close with a count by denomination. The shift report shows expected against counted cash and the over or short, so a missing $20 has a time and a name.',
  },
  {
    icon: CalendarCheckIcon,
    title: 'No double booking',
    lead: 'Enforced by Postgres, not the UI.',
    body: 'A btree_gist exclusion constraint on staff and time range rejects overlapping appointments from any code path. When five browsers race for one slot, exactly one booking is made. Slots follow the store’s time zone and its daylight-saving changes.',
  },
];
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <img src="/favicon.svg" alt="" class="size-7" />
        <span class="text-lg font-semibold tracking-tight">ShopFlow</span>
        <div class="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" as-child>
            <RouterLink to="/login"><LogInIcon /> Sign in</RouterLink>
          </Button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl space-y-14 px-4 py-10 md:py-14">
      <section class="grid items-center gap-8 lg:grid-cols-[1fr_1.15fr]">
        <div class="space-y-5">
          <Badge variant="secondary">Demo data · resets nightly · store time New York</Badge>
          <h1 class="text-3xl font-semibold tracking-tight text-balance md:text-4xl">Point of sale, multi-store stock and appointments in one system</h1>
          <p class="text-pretty text-muted-foreground">
            A salon and retail business with two stores and a warehouse. The till sells products and checks out appointments, and stores move stock between them.
            Every sale, stock movement and booking is written in one Postgres transaction, so the dashboard and the shelves always agree.
          </p>
          <DemoEntry class="max-w-xl" />
        </div>
        <figure class="space-y-2">
          <img
            src="/landing/dashboard.jpg"
            width="1440"
            height="900"
            alt="Owner dashboard: net sales, margin, sales by day and by store, top sellers"
            class="w-full rounded-lg border shadow-sm"
          />
          <figcaption class="text-xs text-muted-foreground">Owner dashboard, from the running demo.</figcaption>
        </figure>
      </section>

      <section class="space-y-4">
        <div class="space-y-1">
          <h2 class="text-xl font-semibold tracking-tight">What is worth a look</h2>
          <p class="text-sm text-muted-foreground">The parts where shop software usually goes wrong, and how this one handles them. Each has tests that fire real concurrent requests.</p>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <Card v-for="p in points" :key="p.title" class="gap-3">
            <CardHeader>
              <CardTitle class="flex items-center gap-2 text-base">
                <component :is="p.icon" class="size-4 text-primary" /> {{ p.title }}
              </CardTitle>
              <CardDescription class="font-medium text-foreground">{{ p.lead }}</CardDescription>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">{{ p.body }}</CardContent>
          </Card>
        </div>
      </section>

      <section class="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
        <figure class="space-y-2">
          <img
            src="/landing/pos.jpg"
            width="1440"
            height="900"
            alt="Point of sale: a cart of scanned items with the server-priced total"
            class="w-full rounded-lg border shadow-sm"
          />
          <figcaption class="text-xs text-muted-foreground">The POS for a cashier, from the running demo.</figcaption>
        </figure>
        <div class="space-y-3">
          <h2 class="text-xl font-semibold tracking-tight">At the till</h2>
          <ul class="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Scan-first cart: USB scanner, typed barcode or the phone camera.</li>
            <li>The server prices every cart; the screen never shows a total it would not charge.</li>
            <li>Split cash and card with change. A double-click on Charge books one sale.</li>
            <li>Returns refund to the cent, even across several partial returns.</li>
            <li>A finished appointment becomes a sale, credited to the stylist.</li>
          </ul>
          <p class="text-xs text-muted-foreground">Vue 3 · shadcn-vue · Express 5 · Drizzle · PostgreSQL 16 · Vitest · Playwright</p>
        </div>
      </section>
    </main>

    <footer class="border-t">
      <div class="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground">
        Demo data: every store, person, product and sale is fictional.
        <template v-if="meta?.demo">Visitors share the demo accounts; everything resets at night.</template>
      </div>
    </footer>
  </div>
</template>
