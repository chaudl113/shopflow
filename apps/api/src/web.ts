import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';

/** Serves the built SPA: hashed assets cached for a year, every other GET falls back to index.html. */
export function serveWeb(app: Express, dir: string) {
  const index = path.join(dir, 'index.html');
  if (!fs.existsSync(index)) throw new Error(`WEB_DIST has no index.html: ${dir}`);
  app.use(
    express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      },
    }),
  );
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
