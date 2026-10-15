import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { setUnauthorizedHandler } from './lib/api';
import { router } from './router';
import { useSession } from './stores/session';
import './style.css';

const app = createApp(App).use(createPinia()).use(router);
setUnauthorizedHandler(() => {
  useSession().logout();
  if (!router.currentRoute.value.meta.public) router.push('/login');
});
app.mount('#app');
