/** Full native regression on an owned temporary PostgreSQL cluster. Requires
 * both VERIFY flags, pinned MEDIA_QA_PYTHON and the documented MEDIA_QA_RAW.
 * No production connection is read and no fixture is downloaded implicitly. */
import { mkdtemp, rm, readFile, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { fullVerificationPreflight, terminateOwnedTree } from '../verify.mjs';

const root = resolve(import.meta.dirname, '../..');
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error(
    'Use an isolated TEST_DATABASE_URL and npm run verify on this platform; the embedded native runner supports Linux x64.',
  );
if (process.getuid?.() === 0)
  throw new Error('Run native PostgreSQL verification as a non-root user.');
const rounds = Number(process.argv[2] ?? 6),
  prefix = process.argv[3] ?? 'v4-final';
if (
  !Number.isSafeInteger(rounds) ||
  rounds < 1 ||
  rounds > 12 ||
  !/^[a-zA-Z0-9_-]{1,30}$/.test(prefix)
)
  throw new Error('Invalid rounds or label.');
const dependencies = fullVerificationPreflight(process.env, root);
const bin = resolve(
  process.env.PG_BINDIR ?? join(root, 'node_modules/@embedded-postgres/linux-x64/native/bin'),
);
await access(join(bin, 'initdb'), constants.X_OK);
await access(join(bin, 'postgres'), constants.X_OK);
const temporary = await mkdtemp(join(tmpdir(), 'xiutu-full-native-')),
  dbDir = join(temporary, 'db');
const reports = [];
let server,
  child,
  interrupted = false,
  stopping,
  failure = null,
  databaseVersion = null,
  clusterStopped = false;
function live(handle) {
  return handle?.pid && handle.exitCode === null && handle.signalCode === null;
}
const interrupt = () => {
  interrupted = true;
  if (live(child)) stopping ??= terminateOwnedTree(child);
  if (live(server)) server.kill('SIGINT');
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
function exited(handle, timeout) {
  if (!live(handle)) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const finish = (value) => {
      clearTimeout(timer);
      handle.off('close', done);
      resolveExit(value);
    };
    const done = () => finish(true),
      timer = setTimeout(() => finish(false), timeout);
    handle.once('close', done);
  });
}
try {
  const portFinder = createServer();
  await new Promise((resolvePort, reject) => {
    portFinder.once('error', reject);
    portFinder.listen(0, '127.0.0.1', resolvePort);
  });
  const port = portFinder.address().port;
  await new Promise((resolveClose) => portFinder.close(resolveClose));
  if (interrupted) throw new Error('Verification interrupted before database initialization.');
  child = spawn(
    join(bin, 'initdb'),
    ['-D', dbDir, '-U', 'postgres', '-A', 'trust', '--no-locale'],
    { env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let initError = '';
  child.stderr.on('data', (chunk) => {
    if (initError.length < 4096) initError += String(chunk).slice(0, 4096 - initError.length);
  });
  const initHandle = child,
    initTimer = setTimeout(() => {
      stopping ??= terminateOwnedTree(initHandle);
    }, 30_000);
  const initialized = await new Promise((resolveInit, reject) => {
    child.once('error', reject);
    child.once('close', resolveInit);
  }).finally(() => clearTimeout(initTimer));
  if (stopping) {
    await stopping;
    stopping = null;
  }
  child = null;
  if (initialized !== 0 || interrupted)
    throw new Error(
      `Temporary PostgreSQL initialization failed${interrupted ? ' (interrupted)' : ''}: ${initError.trim()}`,
    );
  server = spawn(
    join(bin, 'postgres'),
    ['-D', dbDir, '-p', String(port), '-h', '127.0.0.1', '-c', 'unix_socket_directories='],
    { env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  await new Promise((resolveReady, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('PostgreSQL startup timeout')), 10_000);
    server.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8192);
      if (stderr.includes('database system is ready to accept connections')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`PostgreSQL exited before readiness: ${code}`));
    });
  });
  if (interrupted) throw new Error('Verification interrupted during database startup.');
  const database = `xiutu_verify_${randomBytes(10).toString('hex')}`;
  const bootstrap = new pg.Client({
    connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  try {
    await bootstrap.connect();
    const connectedDirectory = (await bootstrap.query('SHOW data_directory')).rows[0]
      .data_directory;
    if ((await realpath(connectedDirectory)) !== (await realpath(dbDir)))
      throw new Error(
        'Refusing verification: connection is not the temporary cluster owned by this runner.',
      );
    databaseVersion = (await bootstrap.query('SELECT version() AS version')).rows[0].version;
    await bootstrap.query(`CREATE DATABASE "${database}"`);
  } finally {
    await bootstrap.end();
  }
  const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/${database}?sslmode=disable`;
  for (let round = 1; round <= rounds; round++) {
    if (interrupted || !live(server))
      throw new Error('Verification interrupted or the owned PostgreSQL cluster stopped.');
    const label = `${prefix}-${round}`,
      roundStarted = Date.now();
    child = spawn(process.execPath, ['scripts/verify.mjs', label], {
      cwd: root,
      // These explicit URLs override inherited .env/production values. Each run
      // uses a new cluster AND a randomly named database inside that cluster.
      env: {
        ...process.env,
        TEST_DATABASE_URL: databaseUrl,
        DATABASE_URL: databaseUrl,
        DB_POOL_MAX: '8',
        NODE_ENV: 'test',
        AI_LITE_ACTIVE: 'false',
        REQUIRE_DB_TESTS: '1',
        VERIFY_FULL: '1',
      },
      stdio: 'inherit',
    });
    const status = await new Promise((resolveRound, reject) => {
      child.once('error', reject);
      child.once('close', resolveRound);
    });
    child = null;
    if (stopping) {
      await stopping;
      stopping = null;
    }
    if (interrupted) throw new Error('Verification interrupted; this round is not counted.');
    const report = JSON.parse(
      await readFile(join(root, `artifacts/verification/${label}.json`), 'utf8'),
    );
    if (
      Date.parse(report.startedAt) < roundStarted ||
      !Number.isFinite(Date.parse(report.startedAt))
    )
      throw new Error('The round report is stale or missing a start time.');
    reports.push(report);
    if (status !== 0 || !report.passed || report.full !== true || report.checks.length !== 6)
      throw new Error(`Full round ${round} failed; no later round is counted.`);
    if (
      reports[0].sourceFingerprint !== report.sourceFingerprint ||
      dependencies.fingerprint !== report.dependencyFingerprint
    )
      throw new Error(
        'Source/native dependencies/photo inputs changed between rounds; restart all frozen rounds.',
      );
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (live(child)) await terminateOwnedTree(child);
  if (stopping) await stopping;
  if (live(server)) {
    server.kill('SIGINT');
    if (!(await exited(server, 8000))) await terminateOwnedTree(server);
  }
  clusterStopped = await exited(server, 2000);
  if (clusterStopped) await rm(temporary, { recursive: true, force: true });
  else {
    failure ??= 'The owned PostgreSQL cluster did not stop; its temporary directory was preserved.';
    process.exitCode = 1;
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  await mkdir(join(root, 'artifacts/verification'), { recursive: true });
  await writeFile(
    join(root, `artifacts/verification/${prefix}-summary.json`),
    JSON.stringify(
      {
        requestedRounds: rounds,
        attemptedReports: reports.length,
        completedRounds: reports.filter((report) => report.passed && report.full).length,
        full: true,
        interrupted,
        failure,
        clusterStopped,
        databaseVersion,
        dependencyFingerprint: dependencies.fingerprint,
        sameFingerprint:
          !failure &&
          !interrupted &&
          clusterStopped &&
          reports.length === rounds &&
          reports.every(
            (report) =>
              report.passed &&
              report.full &&
              report.sourceFingerprint === reports[0].sourceFingerprint &&
              report.dependencyFingerprint === dependencies.fingerprint,
          ),
        reports,
      },
      null,
      2,
    ) + '\n',
  );
}
