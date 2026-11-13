import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  lstatSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const NATIVE_CASES = Object.freeze([
  'exr',
  'radiance',
  'exr-alpha',
  'explicit-aces-rejected',
  'camera-raw',
  '200mp',
  'cancel-200mp',
  'timeout-200mp',
  'cancel-export-during-icc',
]);
const photoInputs = [
  'artifacts/portrait-cpu/portrait-hopper.canonical.png',
  'artifacts/portrait-cpu/portrait-hopper.analysis.json',
  'artifacts/portrait-cpu/mediapipe-portrait.canonical.png',
  'artifacts/portrait-cpu/mediapipe-portrait.analysis.json',
  'artifacts/browser-fixtures/architecture-china.jpg',
  'artifacts/browser-fixtures/flower.jpg',
  'artifacts/portrait-cpu/mediapipe-pose.canonical.png',
  'artifacts/portrait-cpu/mediapipe-pose.analysis.json',
];
function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}
function regularFile(path, maximum = 536_870_912) {
  const stat = lstatSync(path);
  requireCheck(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum,
    `Expected a bounded regular fixture: ${path}`,
  );
  return { bytes: stat.size, sha256: digest(readFileSync(path)) };
}

/** Full mode is explicit and cannot silently degrade to a smaller acceptance set. */
export function fullVerificationPreflight(env = process.env, cwd = projectRoot) {
  requireCheck(
    env.VERIFY_MEDIA_NATIVE === '1' && env.VERIFY_PHOTO_SWEEP === '1',
    'VERIFY_FULL=1 requires VERIFY_MEDIA_NATIVE=1 and VERIFY_PHOTO_SWEEP=1.',
  );
  requireCheck(
    process.platform === 'linux',
    'The complete native media acceptance requires Linux prlimit.',
  );
  accessSync('/usr/bin/prlimit', constants.X_OK);
  const python = env.MEDIA_QA_PYTHON,
    raw = env.MEDIA_QA_RAW;
  requireCheck(
    typeof python === 'string' && isAbsolute(python),
    'Full verification requires an absolute MEDIA_QA_PYTHON with the pinned native requirements installed.',
  );
  requireCheck(
    typeof raw === 'string' && isAbsolute(raw),
    'Full verification requires an absolute MEDIA_QA_RAW pointing to the documented real camera fixture.',
  );
  accessSync(python, constants.X_OK);
  const probe = spawnSync(
    python,
    [
      '-I',
      '-B',
      '-c',
      'import json,sys,rawpy,OpenImageIO as o,numpy; print(json.dumps({"python":sys.version.split()[0],"rawpy":rawpy.__version__,"openimageio":o.VERSION_STRING,"numpy":numpy.__version__,"libraw":".".join(map(str,rawpy.libraw_version))}))',
    ],
    {
      timeout: 10_000,
      maxBuffer: 16_384,
      encoding: 'utf8',
      env: { PATH: env.PATH ?? '/usr/bin:/bin', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
    },
  );
  requireCheck(
    probe.status === 0 && !probe.error,
    'The configured Python cannot import the pinned RAW/HDR dependencies. Install packages/media/native/requirements.txt first.',
  );
  const native = JSON.parse(probe.stdout);
  requireCheck(
    native.rawpy === '0.28.0' && native.openimageio === '3.2.2.0' && native.numpy === '2.4.2',
    'Native dependency versions differ from the frozen requirements.',
  );
  const rawInput = regularFile(raw);
  requireCheck(
    rawInput.sha256 === '5922721d13f11795557d97fdeb0a60b900086c402bc82a848ff280d15b99ffd4' &&
      /\.nef$/i.test(raw),
    'Full verification requires the documented iss030e122639.NEF bytes and its .NEF extension; no fixture is downloaded automatically.',
  );
  const fixtures = photoInputs.map((path) => ({
    path,
    ...regularFile(join(cwd, path), 32 * 1024 * 1024),
  }));
  const manifest = { native, rawInput, fixtures };
  return { ...manifest, fingerprint: digest(JSON.stringify(manifest)) };
}
function freshEvidence(evidence, startedMs) {
  const start = Date.parse(evidence?.startedAt),
    end = Date.parse(evidence?.completedAt);
  requireCheck(
    Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= startedMs &&
      end >= start &&
      end <= Date.now() + 1000,
    'Acceptance evidence is missing timestamps or belongs to an earlier invocation.',
  );
}
export function validateNativeEvidence(evidence, startedMs = 0) {
  freshEvidence(evidence, startedMs);
  const samples = evidence?.samples;
  requireCheck(
    Array.isArray(samples) && samples.length === NATIVE_CASES.length,
    'Full native media acceptance must contain exactly 9 cases.',
  );
  requireCheck(
    new Set(samples.map((item) => item.name)).size === NATIVE_CASES.length &&
      NATIVE_CASES.every((name) => samples.some((item) => item.name === name)),
    'Native case names are missing, duplicated or unexpected.',
  );
  requireCheck(
    samples.every((item) => item.success === true),
    'A native media case did not succeed.',
  );
  requireCheck(
    evidence.capabilities?.available === true && evidence.capabilities.nativeReady === true,
    'Native evidence did not exercise the installed RAW/HDR decoder runtime.',
  );
  for (const name of [
    'explicit-aces-rejected',
    'cancel-200mp',
    'timeout-200mp',
    'cancel-export-during-icc',
  ])
    requireCheck(
      samples.find((item) => item.name === name)?.cleanupConfirmed === true,
      `Missing actual cleanup evidence for ${name}.`,
    );
  requireCheck(
    samples.find((item) => item.name === 'cancel-export-during-icc')?.reachedIcc === true,
    'The export cancellation did not reach the ICC insertion stage.',
  );
  const large = samples.find((item) => item.name === '200mp')?.descriptor;
  requireCheck(
    large?.original?.width === 20000 &&
      large.original.height === 10000 &&
      large.master?.bitDepth === 16 &&
      large.tiles?.count > 0,
    'The 200MP case lacks the actual 20,000 by 10,000 master/tiles result.',
  );
  const camera = samples.find((item) => item.name === 'camera-raw')?.descriptor;
  requireCheck(
    camera?.sourceSha256 === '5922721d13f11795557d97fdeb0a60b900086c402bc82a848ff280d15b99ffd4',
    'RAW evidence used a different source fixture.',
  );
  return {
    cases: NATIVE_CASES.length,
    names: [...NATIVE_CASES],
    nativeVersions: evidence.capabilities.nativeVersions,
  };
}
function sameMultiset(actual, expected) {
  return (
    JSON.stringify(actual.map((value) => JSON.stringify(value)).sort()) ===
    JSON.stringify(expected.map((value) => JSON.stringify(value)).sort())
  );
}
export function validatePhotoEvidence(evidence, baseline, startedMs = 0) {
  freshEvidence(evidence, startedMs);
  requireCheck(
    evidence?.protocol === 'editor-v4-photographic-sweep-v1' &&
      Array.isArray(evidence.samples) &&
      Array.isArray(evidence.failures) &&
      evidence.failures.length === 0,
    'Photo sweep protocol/failure list is invalid.',
  );
  const renders = evidence.samples.filter((item) => item.unavailable !== true),
    unavailable = evidence.samples.filter((item) => item.unavailable === true);
  requireCheck(
    renders.length === 2630 &&
      renders.every(
        (item) =>
          item.fullTiledEqual === true &&
          item.sourceUnchanged === true &&
          /^[a-f0-9]{64}$/.test(item.rgbaSha256),
      ),
    'Full photo acceptance requires 2,630 actual full/tiled equal renders and unchanged sources.',
  );
  requireCheck(
    evidence.summary?.renderComparisons === 2630 &&
      evidence.summary.failures === 0 &&
      evidence.summary.numericControls === 80 &&
      evidence.summary.photographicFrames === 5 &&
      evidence.summary.unavailableTools === 12,
    'Photo summary does not match the frozen full coverage.',
  );
  const stableFields = ['frame', 'key', 'value', 'width', 'height', 'rgbaSha256', 'changedPixels'];
  requireCheck(
    Array.isArray(baseline?.columns) &&
      new Set(baseline.columns).size === baseline.columns.length &&
      stableFields.every((key) => baseline.columns.includes(key)),
    'Frozen photo evidence is missing unambiguous pixel columns.',
  );
  const column = new Map(baseline.columns.map((key, index) => [key, index]));
  requireCheck(
    baseline?.rows?.length === 2630 &&
      sameMultiset(
        renders.map((s) => [s.frame, s.key, s.value]),
        baseline.rows.map((row) => ['frame', 'key', 'value'].map((key) => row[column.get(key)])),
      ),
    'Photo sweep omitted/repeated a control or parameter value from the frozen coverage manifest.',
  );
  requireCheck(
    sameMultiset(
      renders.map((s) => stableFields.map((key) => s[key])),
      baseline.rows.map((row) => stableFields.map((key) => row[column.get(key)])),
    ),
    'Photo pixel dimensions, RGBA digest or changed-pixel count differ from the frozen source/recipe baseline.',
  );
  requireCheck(
    unavailable.length === 12 &&
      sameMultiset(
        unavailable.map((s) => [s.frame, s.key, s.reason]),
        baseline.unavailable.map((s) => [s.frame, s.key, s.reason]),
      ),
    'Unavailable body controls or their reasons differ from the explicitly documented twelve cases.',
  );
  const neckReason =
    '自动颈长暂不可用：耳肩锚点不足以保护面部与肩膀，尚未实现头颈分区和受约束网格。可使用手动液化并设置保护区。';
  requireCheck(
    sameMultiset(
      unavailable
        .filter((s) => s.key === 'portrait.neckLength')
        .map((s) => [s.frame, s.key, s.reason]),
      ['hopper', 'portrait', 'pose'].map((frame) => [frame, 'portrait.neckLength', neckReason]),
    ),
    'The three unsupported V4 automatic neck-length cases must remain explicit and must not be counted as successful renders.',
  );
  requireCheck(
    evidence.fixtures?.length === 5 &&
      sameMultiset(
        evidence.fixtures.map((f) => [f.id, f.encodedSha256, f.analysisSourceHash]),
        baseline.fixtures.map((f) => [f.id, f.encodedSha256, f.analysisSourceHash]),
      ),
    'Photo/landmark fixture identities changed.',
  );
  requireCheck(
    evidence.sheets?.length === 68 &&
      evidence.summary.sheets === 68 &&
      sameMultiset(
        evidence.sheets.map((s) => s.path),
        baseline.sheets.map((s) => s.path),
      ),
    'The photo sweep did not produce the complete 68 contact sheets.',
  );
  return {
    renderComparisons: renders.length,
    unavailableTools: unavailable.length,
    failures: 0,
    sheets: evidence.sheets.length,
  };
}

function processTree(rootPid) {
  if (!rootPid) return [];
  const all = [];
  if (process.platform === 'linux')
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const value = readFileSync(`/proc/${entry}/stat`, 'utf8'),
          fields = value.slice(value.lastIndexOf(')') + 2).split(' ');
        all.push({ pid: Number(entry), parent: Number(fields[1]), born: fields[19] });
      } catch {
        /* The process exited during enumeration. */
      }
    }
  const ids = new Set([rootPid]);
  let changed;
  do {
    changed = false;
    for (const item of all)
      if (ids.has(item.parent) && !ids.has(item.pid)) {
        ids.add(item.pid);
        changed = true;
      }
  } while (changed);
  return all.filter((item) => ids.has(item.pid));
}
function signalKnown(items, signal) {
  for (const item of [...items].reverse())
    try {
      const value = readFileSync(`/proc/${item.pid}/stat`, 'utf8'),
        born = value.slice(value.lastIndexOf(')') + 2).split(' ')[19];
      if (born === item.born && item.pid !== process.pid) process.kill(item.pid, signal);
    } catch {
      /* Already exited; never signal a reused PID. */
    }
}
/** Includes detached decoder children; a process-group-only kill would miss them. */
export async function terminateOwnedTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const known = processTree(child.pid);
  if (!known.length) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    return;
  }
  signalKnown(known, 'SIGTERM');
  await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
  // Only enumerate new descendants while our original parent is still alive.
  // Reusing its numeric PID must never make an unrelated tree ours to stop.
  const current =
    child.exitCode === null && child.signalCode === null ? processTree(child.pid) : [];
  const sameParent =
    current.find((item) => item.pid === child.pid)?.born ===
    known.find((item) => item.pid === child.pid)?.born;
  const remaining = new Map(
    [...known, ...(sameParent ? current : [])].map((item) => [`${item.pid}:${item.born}`, item]),
  );
  signalKnown([...remaining.values()], 'SIGKILL');
}
async function command(executable, args, env, signal) {
  return new Promise((resolveCommand) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      bytes = 0,
      failure = null,
      stopping;
    const stop = (message) => {
      failure ??= message;
      stopping ??= terminateOwnedTree(child);
    };
    const capture = (chunk) => {
      bytes += chunk.length;
      if (bytes <= 16 * 1024 * 1024) output += chunk.toString('utf8');
      else stop('Verification command exceeded its 16MiB log budget.');
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const abort = () => stop('Verification interrupted.');
    const timer = setTimeout(
      () => stop('Verification command exceeded its 30-minute wall-time budget.'),
      30 * 60_000,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.once('error', (error) => {
      failure = error.message;
    });
    child.once('close', async (status, killedBy) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (stopping) await stopping;
      resolveCommand({ status: failure ? 1 : status, output, error: failure, signal: killedBy });
    });
  });
}
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
    if (path === 'apps/web/public/vision') return [];
    return entry.isDirectory() ? files(path) : path.endsWith('.md') ? [] : [path];
  });
}
function fingerprint() {
  const hash = createHash('sha256');
  for (const path of files().sort()) {
    hash.update(path + '\0');
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}
export async function runVerification(label = process.argv[2] ?? 'manual') {
  requireCheck(/^[a-zA-Z0-9_-]{1,40}$/.test(label), 'Invalid verification label.');
  process.chdir(projectRoot);
  const full = process.env.VERIFY_FULL === '1';
  const dependencies = full ? fullVerificationPreflight() : null;
  const root = 'artifacts/verification';
  mkdirSync(root, { recursive: true });
  const inventory = files()
    .sort()
    .map((path) => {
      const bytes = readFileSync(path);
      return {
        path,
        bytes: bytes.length,
        sha256: digest(bytes),
        lines: /\.(?:[cm]?[jt]sx?|sql|css|ya?ml|json|html|sh|py)$/.test(path)
          ? bytes.toString('utf8').split('\n').length
          : null,
      };
    });
  writeFileSync(`${root}/${label}-inventory.json`, JSON.stringify(inventory, null, 2) + '\n');
  const before = fingerprint(),
    startedAt = new Date().toISOString(),
    checks = [];
  const commands = [
    ['typecheck', ['run', 'typecheck'], 'npm'],
    ['tests', ['test'], 'npm'],
    ['web-build', ['run', 'build', '-w', '@ai-xiutu/web'], 'npm'],
    ['production-dependencies', ['audit', '--omit=dev', '--audit-level=high'], 'npm'],
  ];
  if (process.env.VERIFY_MEDIA_NATIVE === '1')
    commands.push([
      'native-media',
      ['--import', 'tsx', 'scripts/qa/media-verify.ts', '--large'],
      'node',
    ]);
  if (process.env.VERIFY_PHOTO_SWEEP === '1')
    commands.push(['photo-sweep', ['--import', 'tsx', 'scripts/qa/editor-v4-sweep.ts'], 'node']);
  const controller = new AbortController(),
    interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    const npmCli =
      process.platform === 'win32'
        ? (process.env.npm_execpath ??
          join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'))
        : null;
    if (npmCli) accessSync(npmCli, constants.R_OK);
    for (const [name, args, runtime] of commands) {
      if (controller.signal.aborted) break;
      const start = Date.now();
      console.log(`Verification ${label}: ${name}`);
      const npmOnWindows = runtime === 'npm' && npmCli;
      const executable = runtime === 'node' || npmOnWindows ? process.execPath : 'npm';
      const result = await command(
        executable,
        npmOnWindows ? [npmCli, ...args] : args,
        { ...process.env, REQUIRE_DB_TESTS: '1' },
        controller.signal,
      );
      let evidence = null;
      if (result.status === 0 && ['native-media', 'photo-sweep'].includes(name))
        try {
          const path =
              name === 'native-media'
                ? 'artifacts/media-v4/evidence.json'
                : 'artifacts/editor-v4-sweep/evidence.json',
            bytes = readFileSync(path),
            parsed = JSON.parse(bytes);
          if (full) {
            evidence =
              name === 'native-media'
                ? validateNativeEvidence(parsed, start)
                : validatePhotoEvidence(
                    parsed,
                    JSON.parse(readFileSync('docs/verification/v4-image-sweep.json', 'utf8')),
                    start,
                  );
            if (name === 'photo-sweep')
              for (const sheet of parsed.sheets)
                requireCheck(
                  /^[a-zA-Z0-9_.-]+\.jpg$/.test(sheet.path) &&
                    digest(readFileSync(join('artifacts/editor-v4-sweep', sheet.path))) ===
                      sheet.sha256,
                  'A contact sheet is missing or differs from its recorded digest.',
                );
          }
          evidence = { ...evidence, sha256: digest(bytes), file: `${label}-${name}.json` };
          writeFileSync(`${root}/${label}-${name}.json`, bytes);
        } catch (error) {
          result.status = 1;
          result.error = `Evidence validation failed: ${error.message}`;
        }
      writeFileSync(
        `${root}/${label}-${name}.log`,
        result.output + (result.error ? `\n${result.error}\n` : ''),
      );
      checks.push({
        name,
        status: result.status,
        durationMs: Date.now() - start,
        log: `${label}-${name}.log`,
        ...(result.error ? { error: result.error } : {}),
        ...(evidence ? { evidence } : {}),
      });
      console.log(result.output.split('\n').slice(-14).join('\n'));
      if (result.error) console.error(result.error);
      if (result.status !== 0) break;
    }
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  const after = fingerprint();
  let dependenciesUnchanged = true,
    dependencyError = null;
  if (full)
    try {
      dependenciesUnchanged = fullVerificationPreflight().fingerprint === dependencies.fingerprint;
    } catch (error) {
      dependenciesUnchanged = false;
      dependencyError = error.message;
    }
  const report = {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    runtime: process.version,
    full,
    database:
      process.env.AI_LITE_ACTIVE === 'true'
        ? 'PostgreSQL 18.6 WASM/PGlite (single backend)'
        : 'native PostgreSQL via TEST_DATABASE_URL',
    sourceFingerprint: before,
    dependencyFingerprint: dependencies?.fingerprint ?? null,
    dependencies,
    inventory: `${label}-inventory.json`,
    files: inventory.length,
    sourceLines: inventory.reduce((sum, item) => sum + (item.lines ?? 0), 0),
    unchangedDuringChecks: before === after,
    dependenciesUnchanged,
    dependencyError,
    interrupted: controller.signal.aborted,
    checks,
    scope: full
      ? 'All discovered repository tests, typecheck, build, dependency audit, exactly 9 native media cases, 2630 photographic full/tiled comparisons matched to frozen pixel hashes, 12 explicit unavailable cases and 68 generated contact sheets. Does not assert human inspection of all sheets or all possible paths/parameters.'
      : 'All repository-discovered tests, typecheck, build and dependency audit; optional checks only when recorded. Not a proof of all paths or all parameter combinations.',
    passed:
      !controller.signal.aborted &&
      before === after &&
      dependenciesUnchanged &&
      checks.length === commands.length &&
      checks.every((check) => check.status === 0),
  };
  writeFileSync(`${root}/${label}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runVerification();
