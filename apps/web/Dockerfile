# Mission Control Web — production image (Vite build + static server).
# Build from repo root: docker compose build web (context = repo root)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace web --include-workspace-root
COPY apps/web ./apps/web
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
# Socket handshake token — must match the api's SOCKET_TOKEN (compose passes the
# same root .env value as a build arg; default dev-socket-token matches compose).
ARG VITE_SOCKET_TOKEN=dev-socket-token
ENV VITE_SOCKET_TOKEN=$VITE_SOCKET_TOKEN
# Display-only operator name (greeting/avatar). Blank → neutral first run.
ARG VITE_OPERATOR_NAME=
ENV VITE_OPERATOR_NAME=$VITE_OPERATOR_NAME
# Optional operator-owned Discord server id (channel deep links). Blank → none.
ARG VITE_DISCORD_GUILD_ID=
ENV VITE_DISCORD_GUILD_ID=$VITE_DISCORD_GUILD_ID
RUN cd apps/web && npm run build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# Runtime only. The entrypoint substitutes INGEST_TOKEN. It is not a build arg
# and it is not in the JS bundle. The filter keeps nginx $host intact.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=^INGEST_TOKEN$
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
