import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const apiPort = Number(process.env.PORT ?? 3001);
if (!Number.isSafeInteger(apiPort) || apiPort < 1 || apiPort > 65535)
  throw new Error('PORT must be a valid API port');

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['terminal.local'],
    proxy: { '/v1': `http://127.0.0.1:${apiPort}` },
  },
  build: { target: 'es2022', sourcemap: false },
});
