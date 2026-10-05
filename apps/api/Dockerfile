# Mission Control API — production image (NestJS + Prisma).
# Build from repo root: docker compose build api (context = repo root)
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# npm workspaces hoist every api dependency to /app/node_modules, so
# apps/api/node_modules usually does not exist — and the `COPY --from=deps
# /app/apps/api/node_modules` lines below then fail the build ("not found").
# Creating the (possibly empty) dir keeps those COPYs valid whether or not npm
# nests anything there. No-op when npm did create it.
RUN npm ci --workspace api --include-workspace-root && mkdir -p apps/api/node_modules

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN cd apps/api && npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# Prisma 7 reads the datasource URL from prisma.config.ts (not schema.prisma);
# without it `prisma migrate deploy` in CMD exits with "datasource.url property
# is required" and the container crash-loops. URL still comes from the
# compose-injected DATABASE_URL env — the file holds no secrets.
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
WORKDIR /app/apps/api
EXPOSE 3000
# Runtime env (DATABASE_URL, PORT, HOST, WEB_ORIGIN, INGEST_TOKEN, SOCKET_TOKEN, …)
# is injected by docker-compose `environment:` — the image contains no .env file,
# so --env-file=.env would fail fatally (crash-loop on a fresh clone).
# Mirrors the `start:prod` script: migrate, then run the compiled Nest app.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
