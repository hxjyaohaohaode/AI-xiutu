import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const root = fileURLToPath(new URL('.', import.meta.url));
const envRoot = fileURLToPath(new URL('../..', import.meta.url));
function port(value: string | undefined, fallback: number, key: string) {
  const result = Number(value ?? fallback);
  if (!Number.isSafeInteger(result) || result < 1 || result > 65535)
    throw new Error(`${key} must be a valid port`);
  return result;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envRoot, ['PORT', 'WEB_PORT']);
  const apiPort = port(env.PORT, 3001, 'PORT');
  const webPort = port(env.WEB_PORT, 5173, 'WEB_PORT');
  const target = `http://127.0.0.1:${apiPort}`;
  const proxy = {
    '^/v1(?:/|[?]|$)': { target, ws: true },
    '^/health(?:[?]|$)': { target },
  };
  return {
    root,
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
      port: webPort,
      strictPort: true,
      allowedHosts: ['terminal.local'],
      proxy,
    },
    preview: { strictPort: true, proxy },
    resolve: { dedupe: ['react', 'react-dom'] },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'motion/react',
        'onnxruntime-web/wasm',
        '@mediapipe/tasks-vision',
      ],
    },
    build: { target: 'es2022', sourcemap: false },
  };
});
