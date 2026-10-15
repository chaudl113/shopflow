<script setup lang="ts">
import { LockOpenIcon } from '@lucide/vue';
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { parseMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { useShift } from '@/stores/shift';
import { toast } from '@/lib/notify';

const session = useSession();
const shift = useShift();
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
  <form class="mx-auto max-w-sm" @submit.prevent="open">
    <Card class="text-center">
      <CardHeader>
        <div class="mx-auto mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"><LockOpenIcon class="size-5" /></div>
        <CardTitle>Open your shift</CardTitle>
        <CardDescription>Count the cash in the drawer before the first sale at {{ session.currentStore?.name }}.</CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel for="float">Opening float ($)</FieldLabel>
          <Input id="float" v-model="float" class="h-11 text-center text-lg tabular-nums" inputmode="decimal" />
        </Field>
      </CardContent>
      <CardFooter>
        <Button type="submit" class="w-full" :disabled="busy">Open shift</Button>
      </CardFooter>
    </Card>
  </form>
</template>
