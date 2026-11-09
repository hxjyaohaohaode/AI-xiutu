import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (existsSync('.env')) process.loadEnvFile('.env');
function tests(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (['node_modules', 'dist', '.data'].includes(entry.name)) return [];
    return entry.isDirectory() ? tests(path) : /\.test\.[cm]?[jt]s$/.test(path) ? [path] : [];
  });
}
const files = [...tests('packages'), ...tests('apps'), ...tests('tests')];
if (!files.length) throw new Error('No tests were discovered.');
// Suites share a database. Explicit Promise.all scenarios inside suites exercise concurrency.
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-concurrency=1', ...files],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
