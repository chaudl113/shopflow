<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod';
import { ArrowRightIcon } from '@lucide/vue';
import { useForm } from 'vee-validate';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { homeFor } from '@/lib/nav';
import { toast } from '@/lib/notify';
import { useSession } from '@/stores/session';

const session = useSession();
const router = useRouter();
const route = useRoute();
const busy = ref(false);

const form = useForm({
  validationSchema: toTypedSchema(z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') })),
});

const submit = form.handleSubmit(async (values) => {
  busy.value = true;
  try {
    await session.login(values.email, values.password);
    const next = typeof route.query.next === 'string' ? route.query.next : homeFor(session.user!.role);
    router.push(next);
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
});

const demo = [
  { email: 'owner@shopflow.demo', label: 'Owner', hint: 'Everything, all stores' },
  { email: 'manager@shopflow.demo', label: 'Manager', hint: 'Downtown + warehouse' },
  { email: 'cashier@shopflow.demo', label: 'Cashier', hint: 'POS, shifts, returns' },
  { email: 'mia@shopflow.demo', label: 'Stylist', hint: 'Own appointments' },
];

function useDemo(email: string) {
  form.setValues({ email, password: 'demo1234' });
  submit();
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center bg-muted/40 p-4">
    <ThemeToggle class="absolute top-3 right-3" />
    <div class="w-full max-w-md space-y-4">
      <div class="flex items-center justify-center gap-2">
        <img src="/favicon.svg" alt="" class="size-9" />
        <span class="text-2xl font-semibold tracking-tight">ShopFlow</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Multi-store POS, inventory and bookings.</CardDescription>
        </CardHeader>
        <CardContent>
          <form class="space-y-4" novalidate @submit="submit">
            <FormField v-slot="{ componentField }" name="email">
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input id="email" type="email" autocomplete="username" v-bind="componentField" /></FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField v-slot="{ componentField }" name="password">
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl><Input id="password" type="password" autocomplete="current-password" v-bind="componentField" /></FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <Button type="submit" class="w-full" :disabled="busy">Sign in</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Demo accounts</CardTitle>
          <CardDescription>Password for all: demo1234</CardDescription>
        </CardHeader>
        <CardContent class="grid grid-cols-2 gap-2">
          <Button v-for="d in demo" :key="d.email" variant="outline" class="h-auto flex-col items-start gap-0.5 py-2 text-left" @click="useDemo(d.email)">
            <span class="text-sm font-medium">{{ d.label }}</span>
            <span class="text-xs font-normal whitespace-normal text-muted-foreground">{{ d.hint }}</span>
          </Button>
        </CardContent>
      </Card>
      <p class="text-center text-xs text-muted-foreground">
        Customer booking page:
        <RouterLink to="/book/downtown" class="inline-flex items-center gap-0.5 text-primary underline-offset-4 hover:underline">/book/downtown <ArrowRightIcon class="size-3" /></RouterLink>
      </p>
    </div>
  </div>
</template>
