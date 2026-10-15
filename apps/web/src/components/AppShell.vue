<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import DemoBanner from '@/components/DemoBanner.vue';
import { navItems } from '@/lib/nav';
import { useSession } from '@/stores/session';

const session = useSession();
const router = useRouter();
const open = ref(false);
const items = computed(() => navItems.filter((n) => session.user && n.roles.includes(session.user.role)));

function logout() {
  session.logout();
  router.push('/login');
}
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <DemoBanner class="print:hidden" />
    <div class="flex flex-1">
      <aside
        class="fixed inset-y-0 left-0 z-30 flex w-60 -translate-x-full flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 print:hidden"
        :class="{ 'translate-x-0': open }"
      >
        <div class="flex items-center gap-2 px-5 py-4">
          <img src="/favicon.svg" alt="" class="h-7 w-7" />
          <span class="text-lg font-semibold tracking-tight">ShopFlow</span>
        </div>
        <nav class="flex-1 space-y-0.5 px-3" aria-label="Main">
          <RouterLink
            v-for="item in items"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            active-class="!bg-indigo-50 !text-indigo-700"
            @click="open = false"
          >
            <span aria-hidden="true">{{ item.icon }}</span>{{ item.label }}
          </RouterLink>
        </nav>
        <div class="border-t border-slate-200 p-4 text-sm">
          <div class="font-medium">{{ session.user?.name }}</div>
          <div class="mb-2 text-xs capitalize text-slate-500">{{ session.user?.role }}</div>
          <button class="btn-secondary w-full" @click="logout">Sign out</button>
        </div>
      </aside>
      <div v-if="open" class="fixed inset-0 z-20 bg-slate-900/30 lg:hidden" @click="open = false" />

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur print:hidden">
          <button class="btn-ghost px-2 lg:hidden" aria-label="Open menu" @click="open = true">☰</button>
          <label class="sr-only" for="store-switch">Store</label>
          <select
            id="store-switch"
            class="input w-auto max-w-[60vw] py-1.5"
            :value="session.storeId ?? ''"
            @change="session.selectStore(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="s in session.stores" :key="s.id" :value="s.id">{{ s.name }}{{ s.kind === 'warehouse' ? ' (warehouse)' : '' }}</option>
          </select>
          <div class="flex-1" />
          <slot name="actions" />
        </header>
        <main class="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          <RouterView v-if="session.storeId" :key="session.storeId" />
          <div v-else class="card p-8 text-center text-slate-500">You are not assigned to any store yet. Ask the owner to add you.</div>
        </main>
      </div>
    </div>
  </div>
</template>
