/** Local development only. Production uses an independently managed PostgreSQL service. */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  throw new Error(
    'Run db:local as a regular non-root user. For containers use the PostgreSQL service in compose.yaml.',
  );
}

await mkdir('.data', { recursive: true, mode: 0o700 });
const configPath = '.data/local-postgres.json';
let config;
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  config = { user: 'xiutu', password: randomBytes(24).toString('hex'), port: 55432 };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
}
const pg = new EmbeddedPostgres({
  databaseDir: resolve('.data/postgres'),
  ...config,
  authMethod: 'scram-sha-256',
  persistent: true,
  createPostgresUser: false,
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: () => {},
});
try {
  await access('.data/postgres/PG_VERSION');
} catch {
  await pg.initialise();
}
await pg.start();
const client = pg.getPgClient('postgres');
await client.connect();
for (const name of ['xiutu', 'xiutu_test']) {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if (result.rowCount === 0) await pg.createDatabase(name);
}
await client.end();
const url = `postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}`;
const environment = [
  '# Generated for local development; never commit this file.',
  `DATABASE_URL=${url}/xiutu`,
  `TEST_DATABASE_URL=${url}/xiutu_test`,
  `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
  `OTP_SECRET=${randomBytes(32).toString('hex')}`,
  'NODE_ENV=development',
  'PORT=3001',
  'HOST=127.0.0.1',
  'APP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://terminal.local:4173',
  'STORAGE_DIR=.data/assets',
  '',
].join('\n');
try {
  await writeFile('.env', environment, { mode: 0o600, flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
console.log(
  'Local PostgreSQL is ready on 127.0.0.1:55432. Credentials are in ignored .env / .data/local-postgres.json.',
);
console.log(
  'Keep this terminal running. Run npm run db:migrate in another terminal. Ctrl+C stops PostgreSQL without deleting data.',
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 30_000);
