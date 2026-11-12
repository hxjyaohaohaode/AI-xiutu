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

FROM node:24-bookworm-slim AS heic-codec
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl cmake g++ make pkg-config && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 2 https://codeload.github.com/strukturag/libde265/tar.gz/refs/tags/v1.1.3 -o /tmp/libde265.tar.gz \
    && echo '189baa08fd6d2dd34db099de411bd6b2e6bd5eb88e81236a3d0fa3826b9715c4  /tmp/libde265.tar.gz' | sha256sum -c - \
    && mkdir /tmp/de265 && tar -xf /tmp/libde265.tar.gz -C /tmp/de265 --strip-components=1 \
    && cmake -S /tmp/de265 -B /tmp/de265-build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/heic -DCMAKE_INSTALL_LIBDIR=lib -DENABLE_SDL=OFF -DENABLE_ENCODER=OFF \
    && cmake --build /tmp/de265-build --parallel 4 && cmake --install /tmp/de265-build
RUN curl --fail --location --retry 2 https://codeload.github.com/strukturag/libheif/tar.gz/refs/tags/v1.23.7 -o /tmp/libheif.tar.gz \
    && echo '90e389caad285ca4946461d56d1c115e56bcbb5141d9038050282af91064fbc7  /tmp/libheif.tar.gz' | sha256sum -c - \
    && mkdir /tmp/heif && tar -xf /tmp/libheif.tar.gz -C /tmp/heif --strip-components=1 \
    && PKG_CONFIG_PATH=/opt/heic/lib/pkgconfig cmake -S /tmp/heif -B /tmp/heif-build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/heic -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_PREFIX_PATH=/opt/heic -DCMAKE_INSTALL_RPATH=/opt/heic/lib \
      -DWITH_LIBDE265=ON -DWITH_LIBDE265_PLUGIN=OFF -DENABLE_PLUGIN_LOADING=OFF -DWITH_X265=OFF -DWITH_AOM_DECODER=OFF -DWITH_AOM_ENCODER=OFF -DWITH_DAV1D=OFF -DWITH_JPEG_DECODER=OFF -DWITH_JPEG_ENCODER=OFF -DWITH_LIBSHARPYUV=OFF -DWITH_EXAMPLES=OFF -DWITH_GDK_PIXBUF=OFF -DBUILD_TESTING=OFF -DBUILD_DOCUMENTATION=OFF \
    && cmake --build /tmp/heif-build --parallel 4 && cmake --install /tmp/heif-build
COPY packages/media/native/heic-hdr.c /tmp/heic-hdr.c
RUN mkdir -p /opt/heic/bin \
    && cc -std=c11 -Wall -Wextra -Werror -O2 -I/opt/heic/include -L/opt/heic/lib -Wl,-rpath,/opt/heic/lib /tmp/heic-hdr.c -lheif -o /opt/heic/bin/heic-pq \
    && /opt/heic/bin/heic-pq --probe-hlg

# Optional native RAW/HDR decoder runtime.
FROM server AS server-media
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 libjpeg62-turbo && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/media && /opt/media/bin/pip install --no-cache-dir -r /app/packages/media/native/requirements.txt
COPY --from=ultrahdr-codec /opt/ultrahdr/lib/libuhdr.so* /opt/ultrahdr/lib/
COPY --from=ultrahdr-codec /tmp/ultrahdr/LICENSE /usr/share/doc/ai-xiutu/libultrahdr-LICENSE
COPY --from=heic-codec /opt/heic/bin/heic-pq /opt/heic/bin/heic-pq
COPY --from=heic-codec /opt/heic/lib/libheif.so* /opt/heic/lib/libde265.so* /opt/heic/lib/
COPY --from=heic-codec /tmp/heif/COPYING /usr/share/doc/ai-xiutu/libheif-COPYING
COPY --from=heic-codec /tmp/de265/COPYING /usr/share/doc/ai-xiutu/libde265-COPYING
ENV MEDIA_PYTHON=/opt/media/bin/python
ENV MEDIA_UHDR_LIBRARY=/opt/ultrahdr/lib/libuhdr.so
ENV MEDIA_HEIC_DECODER=/opt/heic/bin/heic-pq
USER node

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
