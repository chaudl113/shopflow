import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { config } from './config.js';
import { errorHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { inventoryRouter } from './routes/inventory.js';
import { productsRouter } from './routes/products.js';
import { salesRouter } from './routes/sales.js';
import { shiftsRouter } from './routes/shifts.js';
import { storesRouter } from './routes/stores.js';
import { transfersRouter } from './routes/transfers.js';
import { usersRouter } from './routes/users.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/stores', storesRouter);
  api.use('/users', usersRouter);
  api.use('/products', productsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/sales', salesRouter);
  api.use('/shifts', shiftsRouter);
  api.use('/transfers', transfersRouter);
  app.use('/api', api);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } });
  });
  app.use(errorHandler);
  return app;
}
