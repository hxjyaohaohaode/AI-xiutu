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
RUN apt-get update && apt-get install -y --no-install-recommends tini util-linux tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
ENV TESSDATA_PREFIX=/opt/ocr-tessdata
RUN node --use-env-proxy scripts/prepare-ocr.mjs /opt/ocr-tessdata
RUN mkdir -p /app/.data/private /app/.data/ai-dispatch-journal && chown -R node:node /app/.data
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]

FROM node:24-bookworm-slim AS ultrahdr-codec
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl cmake g++ make libjpeg62-turbo-dev && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 2 https://codeload.github.com/google/libultrahdr/tar.gz/5f117294cb701170b9198ed8eae16270aa84896c -o /tmp/ultrahdr.tar.gz \
    && echo 'a65bf84a4ca764449b6e52f2705036c5a324c453948d464bc212b5210a9f3808  /tmp/ultrahdr.tar.gz' | sha256sum -c - \
    && mkdir /tmp/ultrahdr && tar -xf /tmp/ultrahdr.tar.gz -C /tmp/ultrahdr --strip-components=1 \
    && cmake -S /tmp/ultrahdr -B /tmp/codec-build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/ultrahdr -DCMAKE_INSTALL_LIBDIR=lib -DUHDR_BUILD_EXAMPLES=OFF -DUHDR_ENABLE_HEIF=OFF \
    && cmake --build /tmp/codec-build --parallel 4 && cmake --install /tmp/codec-build

# Optional native RAW/HDR decoder runtime.
FROM server AS server-media
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 libjpeg62-turbo && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/media && /opt/media/bin/pip install --no-cache-dir -r /app/packages/media/native/requirements.txt
COPY --from=ultrahdr-codec /opt/ultrahdr/lib/libuhdr.so* /opt/ultrahdr/lib/
COPY --from=ultrahdr-codec /tmp/ultrahdr/LICENSE /usr/share/doc/ai-xiutu/libultrahdr-LICENSE
ENV MEDIA_PYTHON=/opt/media/bin/python
ENV MEDIA_UHDR_LIBRARY=/opt/ultrahdr/lib/libuhdr.so
USER node

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
