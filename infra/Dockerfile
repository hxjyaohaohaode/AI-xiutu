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
RUN apt-get update && apt-get install -y --no-install-recommends util-linux tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
ENV TESSDATA_PREFIX=/opt/ocr-tessdata
RUN node --use-env-proxy scripts/prepare-ocr.mjs /opt/ocr-tessdata
RUN mkdir -p /app/.data/private /app/.data/ai-dispatch-journal && chown -R node:node /app/.data
USER node
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]

# Optional native RAW/HDR decoder runtime. The standard server supports libvips
# formats; this target keeps the additional Python/native footprint opt-in.
FROM server AS server-media
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/media && /opt/media/bin/pip install --no-cache-dir -r /app/packages/media/native/requirements.txt
ENV MEDIA_PYTHON=/opt/media/bin/python
USER node

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
