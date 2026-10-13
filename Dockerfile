# Mileage Tracker — single image (app + API). Works with Dokploy (Dockerfile build type),
# docker compose, or any container host. Needs a PostgreSQL database via DATABASE_URL.

# ── 1. Build the mobile app ──
FROM node:22-alpine AS client
WORKDIR /client
COPY client/package.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm test && npm run build

# ── 2. API server ──
FROM node:22-alpine
# pg_dump/pg_restore must be the same major version as your PostgreSQL server (or newer).
# Dokploy: set the build argument PG_CLIENT_VERSION=17 if your database is Postgres 17.
ARG PG_CLIENT_VERSION=16
RUN apk add --no-cache "postgresql${PG_CLIENT_VERSION}-client" tzdata wget
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=client /client/dist ./public
ENV NODE_ENV=production PORT=3000 BACKUP_DIR=/backups TZ=Europe/London
RUN mkdir -p /backups && chown node:node /backups
USER node
EXPOSE 3000
VOLUME ["/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "src/index.js"]
