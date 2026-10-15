import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { config } from './config.js';
import { errorHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { bookingsRouter } from './routes/bookings.js';
import { inventoryRouter } from './routes/inventory.js';
import { productsRouter } from './routes/products.js';
import { reportsRouter } from './routes/reports.js';
import { publicRouter } from './routes/public.js';
import { salesRouter } from './routes/sales.js';
import { shiftsRouter } from './routes/shifts.js';
import { storesRouter } from './routes/stores.js';
import { transfersRouter } from './routes/transfers.js';
import { usersRouter } from './routes/users.js';
import { serveWeb } from './web.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // TLS is terminated in front of the app (Cloudflare); upgrading would break plain-http local runs.
          upgradeInsecureRequests: null,
          // Camera barcode scanning draws video frames into blob: and data: images.
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
        },
      },
    }),
  );
  app.use(cors({ origin: config.webOrigin }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/stores', storesRouter);
  api.use('/users', usersRouter);
  api.use('/products', productsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/sales', salesRouter);
  api.use('/shifts', shiftsRouter);
  api.use('/transfers', transfersRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/reports', reportsRouter);
  app.use('/api', api);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } });
  });
  if (config.webDist) serveWeb(app, config.webDist);
  app.use(errorHandler);
  return app;
}
