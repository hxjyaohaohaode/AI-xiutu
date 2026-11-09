import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';

if (process.env.NODE_ENV === 'production')
  throw new Error('The WASM database wrapper is for development/tests only.');
if (existsSync('.env')) process.loadEnvFile('.env');
const mode = process.argv[2] ?? 'test';
if (!['test', 'dev', 'migrate', 'admin', 'doctor', 'verify'].includes(mode))
  throw new Error('Use with-lite.mjs test|dev|migrate|admin|doctor|verify.');
mkdirSync('.data', { recursive: true, mode: 0o700 });
const isolated = ['test', 'verify'].includes(mode);
const db = await PGlite.create(isolated ? 'memory://' : '.data/pglite-dev');
const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 });
await server.start();
const url = `postgresql://postgres@${server.getServerConn()}/postgres`;
const env = {
  ...process.env,
  AI_LITE_ACTIVE: 'true',
  DATABASE_URL: url,
  TEST_DATABASE_URL: url,
  DB_POOL_MAX: '1',
  SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  APP_ORIGIN:
    process.env.APP_ORIGIN ||
    'http://localhost:5173,http://127.0.0.1:5173,http://terminal.local:4173',
  HOST: '127.0.0.1',
  PORT: process.env.PORT || '3001',
  NODE_ENV: isolated ? 'test' : 'development',
};
console.log(
  `Running ${mode} against isolated PostgreSQL 18 WASM. Native PostgreSQL CI remains required.`,
);
function child(args) {
  return new Promise((resolve) => {
    const processHandle = spawn(process.execPath, args, { stdio: 'inherit', env });
    const stop = () => processHandle.kill('SIGTERM');
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    processHandle.on('exit', (code) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve(code ?? 1);
    });
  });
}
let code = 1;
try {
  if (mode === 'test') code = await child(['scripts/test.mjs']);
  else if (mode === 'verify') code = await child(['scripts/verify.mjs', ...process.argv.slice(3)]);
  else {
    code = await child(['--import', 'tsx', 'packages/db/src/migrate.ts']);
    if (code === 0 && mode === 'dev')
      code = await child(['scripts/dev.mjs', ...process.argv.slice(3)]);
    if (code === 0 && mode === 'admin')
      code = await child(['--import', 'tsx', 'apps/api/src/bootstrap.ts']);
    if (code === 0 && mode === 'doctor')
      code = await child(['--import', 'tsx', 'scripts/doctor.ts']);
  }
} finally {
  await server.stop();
  await db.close();
}
process.exitCode = code;
