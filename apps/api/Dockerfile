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
ARG GIT_SHA=
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
# The runtime image has no .git. Write the commit next to the API package
# so GET /health can read it. GIT_SHA wins. A checkout context falls back to git.
RUN apk add --no-cache git \
 && sha="$GIT_SHA"; \
 if [ -z "$sha" ]; then sha="$(git -C /app rev-parse HEAD 2>/dev/null || true)"; fi; \
 printf '%s\n' "$sha" > /app/apps/api/git-sha.txt
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN cd apps/api && npx prisma generate && npm run build

FROM base AS runtime
# Compose runs this client inside the api container when the host has no curl.
RUN apk add --no-cache curl
ARG GIT_SHA=
ENV NODE_ENV=production
ENV GIT_SHA=${GIT_SHA}
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# Loopback only. Under Compose: docker compose exec api npm run login:reset
COPY --from=build /app/apps/api/scripts/login-reset.mjs ./apps/api/scripts/login-reset.mjs
# Loopback only. Under Compose: docker compose exec api npm run password:reset
COPY --from=build /app/apps/api/scripts/password-reset.mjs ./apps/api/scripts/password-reset.mjs
# Compose install runs doctor here so the host does not need Node.
# Runtime workdir is /app/apps/api, so the command is: node scripts/doctor.mjs
COPY --from=build /app/scripts/doctor.mjs ./apps/api/scripts/doctor.mjs
COPY --from=build /app/apps/api/git-sha.txt ./apps/api/git-sha.txt
# Prisma 7 reads the datasource URL from prisma.config.ts (not schema.prisma);
# without it `prisma migrate deploy` in CMD exits with "datasource.url property
# is required" and the container crash-loops. URL still comes from the
# compose-injected DATABASE_URL env — the file holds no secrets.
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
# Default config. A plain docker run serves GET /settings from crew.json.
# Compose mounts ./config over /app/config, and that mount overrides these files.
COPY --from=build /app/config/prices.json /app/config/prices.json
COPY --from=build /app/config/timezones.json /app/config/timezones.json
COPY --from=build /app/config/crew.json /app/config/crew.json
WORKDIR /app/apps/api
EXPOSE 3000
# Runtime env (DATABASE_URL, PORT, HOST, WEB_ORIGIN, INGEST_TOKEN,
# DASHBOARD_PASSWORD_HASH, SESSION_SECRET, SESSION_STATE_PATH) is injected by docker-compose
# `environment:`. The image contains no .env file.
# dist/main.js loads a .env when one is present, then runs prisma migrate deploy.
CMD ["node", "dist/main.js"]
