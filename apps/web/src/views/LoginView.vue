<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod';
import { useForm } from 'vee-validate';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import DemoEntry from '@/components/DemoEntry.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useAppMeta } from '@/lib/meta';
import { homeFor } from '@/lib/nav';
import { toast } from '@/lib/notify';
import { useSession } from '@/stores/session';

const session = useSession();
const router = useRouter();
const route = useRoute();
const { meta } = useAppMeta();
const busy = ref(false);
const next = computed(() => (typeof route.query.next === 'string' ? route.query.next : undefined));

const form = useForm({
  validationSchema: toTypedSchema(z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') })),
});

const submit = form.handleSubmit(async (values) => {
  busy.value = true;
  try {
    await session.login(values.email, values.password);
    router.push(next.value ?? homeFor(session.user!.role));
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
});
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
          <CardTitle>{{ meta?.demo ? 'Try the live demo' : 'Demo accounts' }}</CardTitle>
          <CardDescription>
            <template v-if="meta?.demo">No sign-up needed. Accounts are shared and the demo data resets every night.</template>
            <template v-else>Signs in with the seeded accounts (password demo1234).</template>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DemoEntry :next="next" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Sign in with email</CardTitle>
          <CardDescription v-if="meta?.demo">Demo accounts use the password demo1234.</CardDescription>
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
            <Button type="submit" variant="secondary" class="w-full" :disabled="busy">Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
