<script setup lang="ts">
import { CalendarPlusIcon, LayoutDashboardIcon, LoaderCircleIcon, ShoppingCartIcon } from '@lucide/vue';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button } from '@/components/ui/button';
import { useAppMeta } from '@/lib/meta';
import { homeFor } from '@/lib/nav';
import { toast } from '@/lib/notify';
import { useSession } from '@/stores/session';

/** One-click ways into the demo: a role to try, or the public booking page as a customer. */
const props = defineProps<{ next?: string }>();

type DemoRole = 'owner' | 'manager' | 'cashier' | 'stylist';
const EMAILS: Record<DemoRole, string> = {
  owner: 'owner@shopflow.demo',
  manager: 'manager@shopflow.demo',
  cashier: 'cashier@shopflow.demo',
  stylist: 'mia@shopflow.demo',
};

const session = useSession();
const router = useRouter();
const { meta } = useAppMeta();
const busy = ref<DemoRole | null>(null);

async function enter(as: DemoRole) {
  busy.value = as;
  try {
    // A public demo signs in without a password; a local install uses the documented one.
    if (meta.value?.demo) await session.loginDemo(as);
    else await session.login(EMAILS[as], 'demo1234');
    router.push(props.next ?? homeFor(session.user!.role));
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = null;
  }
}

const main = [
  { as: 'owner', label: 'Try as Owner', hint: 'Dashboard, reports, stock across stores', icon: LayoutDashboardIcon },
  { as: 'cashier', label: 'Try as Cashier', hint: 'POS, cash shift, returns', icon: ShoppingCartIcon },
] as const;
</script>

<template>
  <div class="space-y-3">
    <div class="grid gap-2 sm:grid-cols-2">
      <Button
        v-for="r in main"
        :key="r.as"
        size="lg"
        class="h-auto justify-start gap-3 py-3 text-left"
        :disabled="!!busy"
        @click="enter(r.as)"
      >
        <LoaderCircleIcon v-if="busy === r.as" class="size-5 shrink-0 animate-spin" />
        <component :is="r.icon" v-else class="size-5 shrink-0" />
        <span class="flex flex-col">
          <span class="font-semibold">{{ r.label }}</span>
          <span class="text-xs font-normal whitespace-normal opacity-80">{{ r.hint }}</span>
        </span>
      </Button>
    </div>
    <Button variant="outline" size="lg" class="h-auto w-full justify-start gap-3 py-3 text-left" as-child>
      <RouterLink :to="`/book/${meta?.bookingPage?.slug ?? 'downtown'}`">
        <CalendarPlusIcon class="size-5 shrink-0 text-primary" />
        <span class="flex flex-col">
          <span class="font-semibold">Book an appointment as a customer</span>
          <span class="text-xs font-normal whitespace-normal text-muted-foreground">The public, phone-sized booking page of {{ meta?.bookingPage?.name ?? 'the Downtown store' }}</span>
        </span>
      </RouterLink>
    </Button>
    <p class="text-center text-xs text-muted-foreground">
      Also try
      <Button variant="link" size="sm" class="h-auto px-1 text-xs" :disabled="!!busy" @click="enter('manager')">Manager</Button>
      or
      <Button variant="link" size="sm" class="h-auto px-1 text-xs" :disabled="!!busy" @click="enter('stylist')">Stylist</Button>
    </p>
  </div>
</template>
