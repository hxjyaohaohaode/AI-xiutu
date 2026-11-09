FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
ARG WITH_PORTRAIT_MODELS=true
RUN npm ci
RUN if [ "$WITH_PORTRAIT_MODELS" = "true" ]; then npm run vision:prepare; fi
RUN npm run build

FROM node:24-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.data/private /app/.data/ai-dispatch-journal && chown -R node:node /app/.data
USER node
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
