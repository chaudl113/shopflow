<script setup lang="ts">
import { ChevronsUpDownIcon, LogOutIcon, StoreIcon, WarehouseIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DemoBanner from '@/components/DemoBanner.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { navGroups, navItems } from '@/lib/nav';
import { useSession } from '@/stores/session';

const session = useSession();
const router = useRouter();
const route = useRoute();

const groups = computed(() =>
  navGroups
    .map((g) => ({ name: g, items: navItems.filter((n) => n.group === g && session.user && n.roles.includes(session.user.role)) }))
    .filter((g) => g.items.length),
);
const initials = computed(() => (session.user?.name ?? '?').split(' ').map((p) => p[0]).join('').slice(0, 2));
const storeId = computed({
  get: () => session.storeId ?? undefined,
  set: (v) => v && session.selectStore(String(v)),
});

function logout() {
  session.logout();
  router.push('/login');
}
</script>

<template>
  <SidebarProvider>
    <Sidebar collapsible="icon" class="print:hidden">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" as-child>
              <RouterLink to="/">
                <img src="/favicon.svg" alt="" class="size-8" />
                <span class="text-base font-semibold tracking-tight">ShopFlow</span>
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup v-for="g in groups" :key="g.name">
          <SidebarGroupLabel>{{ g.name }}</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in g.items" :key="item.to">
              <SidebarMenuButton as-child :is-active="route.path.startsWith(item.to)" :tooltip="item.label">
                <RouterLink :to="item.to">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <SidebarMenuButton size="lg" data-testid="user-menu">
                  <Avatar class="size-8 rounded-lg">
                    <AvatarFallback class="rounded-lg">{{ initials }}</AvatarFallback>
                  </Avatar>
                  <div class="grid flex-1 text-left text-sm leading-tight">
                    <span class="truncate font-medium">{{ session.user?.name }}</span>
                    <span class="truncate text-xs capitalize text-muted-foreground">{{ session.user?.role }}</span>
                  </div>
                  <ChevronsUpDownIcon class="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" class="w-56">
                <DropdownMenuLabel class="font-normal">
                  <div class="text-sm font-medium">{{ session.user?.name }}</div>
                  <div class="text-xs text-muted-foreground">{{ session.user?.email }}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem @select="logout"><LogOutIcon /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="min-w-0">
      <DemoBanner class="print:hidden" />
      <header class="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur print:hidden">
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-1 data-[orientation=vertical]:h-5" />
        <Select v-model="storeId">
          <SelectTrigger class="w-auto min-w-48 max-w-[60vw]" aria-label="Store" data-testid="store-switch">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="s in session.stores" :key="s.id" :value="s.id">
              <WarehouseIcon v-if="s.kind === 'warehouse'" class="text-muted-foreground" />
              <StoreIcon v-else class="text-muted-foreground" />
              {{ s.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <div class="flex-1" />
        <ThemeToggle />
      </header>
      <main class="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
        <RouterView v-if="session.storeId" :key="session.storeId" />
        <div v-else class="rounded-xl border p-8 text-center text-muted-foreground">You are not assigned to any store yet. Ask the owner to add you.</div>
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
