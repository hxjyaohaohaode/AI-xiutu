import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const label = process.argv[2] ?? 'manual';
if (!/^[a-zA-Z0-9_-]{1,40}$/.test(label)) throw new Error('Invalid verification label.');
const root = 'artifacts/verification';
mkdirSync(root, { recursive: true });
function files(directory = '.') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      ['node_modules', '.git', '.data', 'dist', 'artifacts', '.postgres', '.env'].includes(
        entry.name,
      ) ||
      (entry.name.startsWith('.env.') && entry.name !== '.env.example') ||
      entry.name.endsWith('.log')
    )
      return [];
    const path = directory === '.' ? entry.name : `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : path.endsWith('.md') ? [] : [path];
  });
}
const fingerprint = () => {
  const hash = createHash('sha256');
  for (const path of files().sort()) {
    hash.update(path + '\0');
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
};
const before = fingerprint();
const startedAt = new Date().toISOString();
const checks = [];
const commands = [
  ['typecheck', ['run', 'typecheck']],
  ['tests', ['test']],
  ['web-build', ['run', 'build', '-w', '@ai-xiutu/web']],
  ['production-dependencies', ['audit', '--omit=dev', '--audit-level=high']],
];
for (const [name, args] of commands) {
  const start = Date.now();
  console.log(`Verification ${label}: ${name}`);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    encoding: 'utf8',
    env: { ...process.env, REQUIRE_DB_TESTS: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(`${root}/${label}-${name}.log`, output);
  checks.push({
    name,
    status: result.status,
    durationMs: Date.now() - start,
    log: `${label}-${name}.log`,
  });
  console.log(output.split('\n').slice(-14).join('\n'));
  if (result.status !== 0) break;
}
const after = fingerprint();
const report = {
  label,
  startedAt,
  finishedAt: new Date().toISOString(),
  runtime: process.version,
  database:
    process.env.AI_LITE_ACTIVE === 'true'
      ? 'PostgreSQL 18.6 WASM/PGlite (single backend)'
      : 'native PostgreSQL via TEST_DATABASE_URL',
  sourceFingerprint: before,
  unchangedDuringChecks: before === after,
  checks,
  passed:
    before === after &&
    checks.length === commands.length &&
    checks.every((check) => check.status === 0),
};
writeFileSync(`${root}/${label}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
