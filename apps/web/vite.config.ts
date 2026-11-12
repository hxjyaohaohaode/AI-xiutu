import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const apiPort = Number(process.env.PORT ?? 3001);
if (!Number.isSafeInteger(apiPort) || apiPort < 1 || apiPort > 65535)
  throw new Error('PORT must be a valid API port');

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(),
    {
      name: 'local-vision-module-loader',
      configureServer(server) {
        // MediaPipe imports its Emscripten loader dynamically. Vite's public-file
        // transform guard otherwise rejects the added ?import query in development.
        // Serve only this pinned, first-party loader; never expose arbitrary paths.
        server.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/vision/wasm/vision_wasm_module_internal.js')
            return next();
          const path = fileURLToPath(
            new URL('./public/vision/wasm/vision_wasm_module_internal.js', import.meta.url),
          );
          try {
            const info = await stat(path);
            response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            response.setHeader('Content-Length', info.size);
            response.setHeader('Cache-Control', 'no-cache');
            if (request.method === 'HEAD') {
              response.end();
              return;
            }
            if (request.method !== 'GET') {
              response.statusCode = 405;
              response.end();
              return;
            }
            const stream = createReadStream(path);
            stream.on('error', () => response.destroy());
            response.on('close', () => stream.destroy());
            stream.pipe(response);
          } catch {
            response.statusCode = 404;
            response.end('Portrait resources not installed.');
          }
        });
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['terminal.local'],
    proxy: { '/v1': { target: `http://127.0.0.1:${apiPort}`, ws: true } },
  },
  optimizeDeps: { include: ['onnxruntime-web/wasm', '@mediapipe/tasks-vision'] },
  build: { target: 'es2022', sourcemap: false },
});
