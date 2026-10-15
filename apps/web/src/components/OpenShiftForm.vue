<script setup lang="ts">
import { ref } from 'vue';
import { parseMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { useShift } from '@/stores/shift';
import { useToast } from '@/stores/toast';

const session = useSession();
const shift = useShift();
const toast = useToast();
const float = ref('150.00');
const busy = ref(false);

async function open() {
  const cents = parseMoney(float.value);
  if (cents === null) return toast.error('Enter the cash in the drawer');
  busy.value = true;
  try {
    await shift.open(session.storeId!, cents);
    toast.success('Shift opened');
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card mx-auto max-w-sm p-6 text-center" @submit.prevent="open">
    <div class="mb-1 text-3xl">🧾</div>
    <h2 class="text-lg font-semibold">Open your shift</h2>
    <p class="mb-4 text-sm text-slate-500">Count the cash in the drawer before the first sale at {{ session.currentStore?.name }}.</p>
    <label class="label text-left" for="float">Opening float ($)</label>
    <input id="float" v-model="float" class="input mb-3 text-center text-lg tabular-nums" inputmode="decimal" />
    <button class="btn-primary w-full" :disabled="busy">Open shift</button>
  </form>
</template>
