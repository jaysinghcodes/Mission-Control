# Mission Control Web — production image (Vite build + static server).
# Build from repo root: docker compose build web (context = repo root)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace web --include-workspace-root
COPY apps/web ./apps/web
COPY config/timezones.json /app/config/timezones.json
# Blank means the browser calls this page. nginx proxies /api and /socket.io.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
# Display-only operator name (account label and team owner). Blank means a neutral first run.
ARG VITE_OPERATOR_NAME=
ENV VITE_OPERATOR_NAME=$VITE_OPERATOR_NAME
# Optional operator-owned Discord server id (channel deep links). Blank → none.
ARG VITE_DISCORD_GUILD_ID=
ENV VITE_DISCORD_GUILD_ID=$VITE_DISCORD_GUILD_ID
# Owner port the /connect page prints. Compose passes MC_WEB_PORT. nginx
# still listens on 5173 inside the container.
ARG MC_WEB_PORT=5173
ENV MC_WEB_PORT=$MC_WEB_PORT
RUN cd apps/web && npm run build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# The template has no secrets. The filter matches nothing so nginx keeps $host.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=^$$
EXPOSE 5173
EXPOSE 3011
CMD ["nginx", "-g", "daemon off;"]
