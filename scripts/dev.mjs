import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const flags = process.argv.slice(2);
const port = (value, name) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 65535)
    throw new Error(`${name} must be a valid port`);
  return number;
};
let webPort = process.env.WEB_PORT ?? '5173';
for (let index = 0; index < flags.length; index++) {
  const arg = flags[index];
  if (arg === '--port') webPort = flags[++index];
  else if (arg.startsWith('--port=')) webPort = arg.slice('--port='.length);
}
const apiPort = port(process.env.PORT ?? '3001', 'PORT');
const frontPort = port(webPort, 'WEB_PORT / --port');
if (apiPort === frontPort) throw new Error('PORT and WEB_PORT must be different');
process.env.PORT = String(apiPort);
process.env.WEB_PORT = String(frontPort);
process.env.APP_ORIGIN ??= `http://localhost:${frontPort},http://127.0.0.1:${frontPort}`;
const loopbackOrigins = process.env.APP_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin));
if (
  loopbackOrigins.length &&
  !loopbackOrigins.some((origin) => {
    const parsed = new URL(origin);
    return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) === frontPort;
  })
)
  throw new Error(
    `APP_ORIGIN still points to a different web port; update it for port ${frontPort}`,
  );

if (process.env.AI_DEV_DATABASE === 'lite' && process.env.AI_LITE_ACTIVE !== 'true') {
  const wrapper = spawn(process.execPath, ['scripts/with-lite.mjs', 'dev', ...flags], {
    stdio: 'inherit',
    env: process.env,
  });
  process.on('SIGINT', () => wrapper.kill('SIGTERM'));
  process.on('SIGTERM', () => wrapper.kill('SIGTERM'));
  const code = await new Promise((resolve) => wrapper.on('exit', resolve));
  process.exit(code ?? 1);
}
// The worker may query jobs immediately when real AI credentials are enabled.
// Finish migrations before starting any long-running child, including on a new DB.
const migration = spawn(process.execPath, ['--import', 'tsx', 'packages/db/src/migrate.ts'], {
  stdio: 'inherit',
  env: process.env,
});
const cancelMigration = () => migration.kill('SIGTERM');
process.once('SIGINT', cancelMigration);
process.once('SIGTERM', cancelMigration);
const migrated = await new Promise((resolve) => {
  migration.once('error', () => resolve(1));
  migration.once('exit', (code) => resolve(code ?? 1));
});
process.off('SIGINT', cancelMigration);
process.off('SIGTERM', cancelMigration);
if (migrated !== 0) process.exit(Number(migrated));
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'apps/worker-ai/src/index.ts'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(
    process.execPath,
    [resolve('node_modules/vite/bin/vite.js'), '--config', 'apps/web/vite.config.ts', ...flags],
    { cwd: process.cwd(), stdio: 'inherit', env: process.env },
  ),
];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300).unref();
};
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
