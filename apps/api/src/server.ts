import { createApp } from './app.js';
import { config } from './config.js';
import { simulateDemoDay } from './demo/simulate.js';

createApp().listen(config.port, () => {
  console.log(`ShopFlow API listening on http://localhost:${config.port}${config.demoPublic ? ' (public demo mode)' : ''}`);
});

if (config.demoPublic) {
  // Keep "today" moving in the public demo: walk-ins up to now, finished appointments paid.
  const tick = () =>
    simulateDemoDay()
      .then((r) => r && (r.sales || r.checkedOut || r.closedShifts) && console.log(`[demo] simulated ${JSON.stringify(r)}`))
      .catch((e) => console.error('[demo] simulation failed', e));
  void tick();
  setInterval(tick, 5 * 60_000).unref();
}
