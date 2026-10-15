# Single image: the API also serves the built web app (one container, one port).
#   docker buildx build --platform linux/amd64 -t shopflow:latest .

# 1. Build API (tsc) and web (vue-tsc + vite) with dev dependencies.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY apps apps
RUN npm run build -w apps/api && npm run build -w apps/web

# 2. Production dependencies of the API only. `npm ci -w` would still install the web workspace's
#    toolchain, so drop the web workspace and let `npm install` resolve from the existing lockfile.
FROM node:22-alpine AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.workspaces=['apps/api'];delete p.devDependencies;fs.writeFileSync('package.json',JSON.stringify(p))" \
  && npm install --omit=dev --no-audit --no-fund \
  && rm -rf node_modules/@shopflow node_modules/.package-lock.json

# 3. Runtime.
FROM node:22-alpine
ENV NODE_ENV=production \
    API_PORT=3201 \
    WEB_DIST=/app/web
WORKDIR /app
# Yarn and corepack are never used at runtime; npm stays for `npm run demo:reset`.
RUN rm -rf /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/lib/node_modules/corepack /usr/local/bin/corepack
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/apps/api/dist ./dist
COPY apps/api/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./web
COPY deploy/app-package.json ./package.json
USER node
EXPOSE 3201
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s CMD wget -qO- http://127.0.0.1:3201/api/health >/dev/null || exit 1
# Migrations are idempotent; SEED_DEMO=if-empty loads demo data only into an empty database.
CMD ["node", "dist/start.js"]
