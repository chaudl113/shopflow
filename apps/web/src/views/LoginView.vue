<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { homeFor } from '@/lib/nav';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';

const session = useSession();
const router = useRouter();
const route = useRoute();
const toast = useToast();
const email = ref('');
const password = ref('');
const busy = ref(false);

const demo = [
  { email: 'owner@shopflow.demo', label: 'Owner', hint: 'Everything, all stores' },
  { email: 'manager@shopflow.demo', label: 'Manager', hint: 'Downtown store + warehouse' },
  { email: 'cashier@shopflow.demo', label: 'Cashier', hint: 'POS, shifts, returns' },
  { email: 'mia@shopflow.demo', label: 'Stylist', hint: 'Own appointments' },
];

async function submit() {
  busy.value = true;
  try {
    await session.login(email.value, password.value);
    const next = typeof route.query.next === 'string' ? route.query.next : homeFor(session.user!.role);
    router.push(next);
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}

function useDemo(e: string) {
  email.value = e;
  password.value = 'demo1234';
  submit();
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-4">
    <div class="w-full max-w-md">
      <div class="mb-6 flex items-center justify-center gap-2">
        <img src="/favicon.svg" alt="" class="h-9 w-9" />
        <span class="text-2xl font-semibold tracking-tight">ShopFlow</span>
      </div>
      <form class="card space-y-4 p-6" @submit.prevent="submit">
        <h1 class="text-lg font-semibold">Sign in</h1>
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
        </div>
        <div>
          <label class="label" for="password">Password</label>
          <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn-primary w-full" :disabled="busy">Sign in</button>
      </form>
      <div class="card mt-4 p-4">
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Demo accounts (password demo1234)</p>
        <div class="grid grid-cols-2 gap-2">
          <button v-for="d in demo" :key="d.email" type="button" class="rounded-lg border border-slate-200 p-2.5 text-left hover:border-indigo-300 hover:bg-indigo-50" @click="useDemo(d.email)">
            <div class="text-sm font-medium">{{ d.label }}</div>
            <div class="text-xs text-slate-500">{{ d.hint }}</div>
          </button>
        </div>
      </div>
      <p class="mt-4 text-center text-xs text-slate-500">
        Customer-facing booking page: <RouterLink to="/book/downtown" class="text-indigo-600 underline">/book/downtown</RouterLink>
      </p>
    </div>
  </div>
</template>
