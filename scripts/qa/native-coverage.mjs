/** Actual Node execution coverage, with an inventory of source files not loaded.
 * Does not load .env or infer browser/photographic acceptance from percentages. */
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('Supply an isolated TEST_DATABASE_URL explicitly.');
const database = new URL(process.env.TEST_DATABASE_URL);
if (
  !['postgres:', 'postgresql:'].includes(database.protocol) ||
  !decodeURIComponent(database.pathname).includes('test')
)
  throw new Error('Coverage requires a disposable PostgreSQL database with test in its name.');
const target = 'artifacts/coverage/native';
mkdirSync(target, { recursive: true });
function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.data', 'public'].includes(entry.name)) return [];
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
}
const all = [...files('packages'), ...files('apps'), ...files('tests')];
const tests = all.filter((path) => /\.test\.[cm]?[jt]s$/.test(path)).sort();
const sources = all
  .filter((path) => /\/src\/.*\.[cm]?[jt]sx?$/.test(path) && !path.endsWith('.d.ts'))
  .sort();
if (!tests.length) throw new Error('No tests discovered.');
const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
const commit = process.env.QA_COMMIT ?? (git.status === 0 ? git.stdout.trim() : null);
if (commit && !/^[a-f0-9]{40}$/.test(commit))
  throw new Error('QA_COMMIT must be a full Git commit.');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileHashes = Object.fromEntries(
  [...new Set([...sources, ...tests])].sort().map((file) => [file, sha256(readFileSync(file))]),
);
const inventory = {
  commit,
  commitSource: process.env.QA_COMMIT
    ? 'caller-provided QA_COMMIT'
    : git.status === 0
      ? 'git HEAD'
      : 'unavailable',
  sourceAndTestDigest: sha256(JSON.stringify(fileHashes)),
  sources,
  tests,
  fileHashes,
  scope:
    'Node test-runner V8 execution coverage; unloaded files and browser executions are not inferred covered.',
};
writeFileSync(`${target}/inventory.json`, JSON.stringify(inventory, null, 2));
for (const key of [
  'OPENAI_API_KEY',
  'OPENAI_REALTIME_API_KEY',
  'GEMINI_API_KEY',
  'DASHSCOPE_API_KEY',
  'ARK_API_KEY',
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
])
  process.env[key] = '';
for (const key of [
  'AI_PLAN_ENABLED',
  'AI_TEXT_ENABLED',
  'AI_IMAGE_ENABLED',
  'AI_SPEECH_ENABLED',
  'AI_ASSISTANT_ENABLED',
  'AI_VOICE_ENABLED',
])
  process.env[key] = 'false';
process.env.REQUIRE_DB_TESTS = '1';
process.env.NODE_ENV = 'test';
// Clear generated report files, never source files, so failure cannot leave an old green report.
writeFileSync(`${target}/lcov.info`, '');
writeFileSync(`${target}/files.csv`, '');
writeFileSync(`${target}/summary.json`, JSON.stringify({ status: 'running', commit }, null, 2));
const result = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
    '--test-coverage-include=**/packages/*/src/**',
    '--test-coverage-include=**/apps/*/src/**',
    '--test-coverage-exclude=**/node_modules/**',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${target}/lcov.info`,
    ...tests,
  ],
  { stdio: 'inherit', env: process.env },
);
const records = readFileSync(`${target}/lcov.info`, 'utf8')
  .split('end_of_record')
  .map((block) => {
    const rows = block.trim().split(/\r?\n/);
    const file = rows
      .find((line) => line.startsWith('SF:'))
      ?.slice(3)
      .replaceAll('\\', '/');
    if (!file) return null;
    const prefix = process.cwd().replaceAll('\\', '/') + '/';
    const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file;
    const value = (key) =>
      Number(rows.find((line) => line.startsWith(`${key}:`))?.slice(key.length + 1) ?? 0);
    return {
      file: relative,
      lines: { found: value('LF'), hit: value('LH') },
      functions: { found: value('FNF'), hit: value('FNH') },
      branches: { found: value('BRF'), hit: value('BRH') },
      unexecutedLines: rows
        .filter((line) => line.startsWith('DA:'))
        .map((line) => line.slice(3).split(',').map(Number))
        .filter((row) => row[1] === 0)
        .map((row) => row[0]),
    };
  })
  .filter(Boolean);
const represented = new Set(records.map((record) => record.file));
function totals(rows) {
  return Object.fromEntries(
    ['lines', 'functions', 'branches'].map((key) => {
      const found = rows.reduce((n, row) => n + row[key].found, 0);
      const hit = rows.reduce((n, row) => n + row[key].hit, 0);
      return [key, { found, hit, percent: found ? +((hit * 100) / found).toFixed(2) : null }];
    }),
  );
}
const groups = {};
for (const file of sources) {
  const name = file.split('/').slice(0, 2).join('/');
  groups[name] ??= { inventoryFiles: 0, representedFiles: 0, absentFiles: [] };
  groups[name].inventoryFiles++;
  if (represented.has(file)) groups[name].representedFiles++;
  else groups[name].absentFiles.push(file);
}
for (const [name, group] of Object.entries(groups))
  group.executedFileCoverage = totals(
    records.filter((record) => record.file.startsWith(`${name}/`)),
  );
const summary = {
  status: result.status === 0 && records.length ? 'passed' : 'failed',
  testExitCode: result.status,
  commit,
  commitSource: inventory.commitSource,
  sourceAndTestDigest: inventory.sourceAndTestDigest,
  scope: inventory.scope,
  limitations: [
    'Native V8 coverage is experimental. Source mapping through tsx can count generated helpers or non-executable source lines.',
    'Percentages only describe files represented in LCOV. Unloaded source files are listed separately; they do not count as covered.',
    'React UI and browser Worker execution have separate integration tests and are not instrumented by this report.',
    'Executed lines do not establish assertion quality, all parameter combinations, photographic aesthetics or real-provider quality.',
  ],
  sourceFileCount: sources.length,
  testFileCount: tests.length,
  representedSourceFiles: sources.filter((file) => represented.has(file)).length,
  absentFiles: sources.filter((file) => !represented.has(file)),
  executedFileCoverage: totals(records),
  groups,
  files: records.sort((a, b) => a.file.localeCompare(b.file)),
};
writeFileSync(`${target}/summary.json`, JSON.stringify(summary, null, 2));
const byFile = new Map(records.map((record) => [record.file, record]));
const csv = [
  [
    'file',
    'node_execution',
    'lines_hit',
    'lines_found',
    'functions_hit',
    'functions_found',
    'branches_hit',
    'branches_found',
  ],
  ...sources.map((file) => {
    const row = byFile.get(file);
    return [
      file,
      row ? 'represented' : 'not_loaded',
      row?.lines.hit,
      row?.lines.found,
      row?.functions.hit,
      row?.functions.found,
      row?.branches.hit,
      row?.branches.found,
    ];
  }),
]
  .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
  .join('\n');
writeFileSync(`${target}/files.csv`, csv + '\n');
console.log(
  JSON.stringify(
    {
      report: `${target}/summary.json`,
      status: summary.status,
      sourceFileCount: sources.length,
      representedSourceFiles: summary.representedSourceFiles,
      executedFileCoverage: summary.executedFileCoverage,
    },
    null,
    2,
  ),
);
process.exit(summary.status === 'passed' ? 0 : result.status || 1);
