/**
 * Publish only images captured by the successful, exact-head frontend review.
 * No force push, no merge, no retry, no provider or production interaction.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  REPOSITORY, BRANCH, BASE_BRANCH, MANIFEST_PATH, PUBLISH_IMAGE_PATHS, PUBLISH_PATHS, SCENARIOS,
} from './system-redesign-policy.mjs';

assert.equal(process.env.CI, 'true', 'Publication is restricted to this CI workflow.');
assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY);
assert.match(process.env.REVIEW_HEAD ?? '', /^[a-f0-9]{40}$/);
assert.ok(process.env.GITHUB_TOKEN, 'The dedicated publication job token is required.');
const expectedHead = process.env.REVIEW_HEAD;
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
  assert.equal(event.pull_request.head.repo.full_name, REPOSITORY);
  assert.equal(event.pull_request.head.ref, BRANCH);
  assert.equal(event.pull_request.base.ref, BASE_BRANCH);
  assert.equal(event.pull_request.head.sha, expectedHead);
} else {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/' + BRANCH);
  assert.equal(process.env.GITHUB_SHA, expectedHead);
}
const root = process.cwd();
const artifact = resolve(process.argv[2] ?? 'artifacts/frontend-review');
const sourceRoot = resolve(artifact, 'publish');
const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
  GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + process.env.GITHUB_TOKEN).toString('base64'),
};
function git(args, authenticated = false) {
  try {
    return execFileSync('git', args, {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: authenticated ? gitEnv : process.env,
    }).trim();
  } catch {
    // A child-process error can include environment or credential-bearing command
    // context. Emit a bounded diagnostic instead of forwarding its object.
    throw new Error('Git operation failed: ' + args[0] + '. No force push or retry was attempted.');
  }
}
assert.equal(git(['rev-parse', 'HEAD']), expectedHead);
assert.equal(git(['status', '--porcelain']), '', 'Publication requires a clean checkout.');
function assertRemoteHead() {
  const actual = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/' + BRANCH], true).split(/\s+/)[0];
  assert.equal(actual, expectedHead, 'Feature head moved after review. Refuse stale screenshots; do not retry automatically.');
}
assertRemoteHead();
const sourceManifest = resolve(sourceRoot, MANIFEST_PATH);
assert.equal((await lstat(sourceManifest)).isFile(), true);
const manifest = JSON.parse(await readFile(sourceManifest, 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.testedCommit, expectedHead);
assert.equal(manifest.state, 'passed');
assert.equal(manifest.manualVisualReview, false);
assert.deepEqual(
  [...manifest.scenarios.map((entry) => entry.id)].sort(),
  SCENARIOS.map((entry) => entry.id).sort(),
);
assert.ok(manifest.scenarios.every((entry) => entry.state === 'passed'));
assert.deepEqual([...manifest.files.map((entry) => entry.path)].sort(), [...PUBLISH_IMAGE_PATHS].sort());
const report = JSON.parse(await readFile(resolve(artifact, 'report.json'), 'utf8'));
assert.equal(report.testedCommit, expectedHead);
assert.equal(report.state, 'passed');
assert.equal(report.pageErrors.length, 0);
assert.equal(report.unexpectedOrigins.length, 0);

// This is a classification of already-blocked attempts, never permission to send.
const sdkName = '@mediapipe/tasks-vision';
const sdkTelemetryEndpoint = 'https://odml.pa.googleapis.com/v1/log';
const webPackage = JSON.parse(await readFile(resolve(root, 'apps/web/package.json'), 'utf8'));
const sdkVersion = webPackage.dependencies[sdkName];
const dependencyLock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
assert.equal(sdkVersion, '1.2.2');
assert.equal(dependencyLock.packages['node_modules/' + sdkName].version, sdkVersion);
assert.ok(Array.isArray(report.blockedSdkTelemetryAttempts));
assert.ok(Array.isArray(manifest.blockedSdkTelemetryAttempts));
assert.deepEqual(manifest.blockedSdkTelemetryAttempts, report.blockedSdkTelemetryAttempts,
  'Published telemetry evidence must exactly match the actual browser report.');
const passedCases = new Set(report.cases.filter((entry) => entry.state === 'passed').map((entry) => entry.name));
for (const attempt of report.blockedSdkTelemetryAttempts) {
  assert.deepEqual(Object.keys(attempt).sort(), ['blocked', 'case', 'endpoint', 'method']);
  assert.ok(passedCases.has(attempt.case));
  assert.equal(attempt.endpoint, sdkTelemetryEndpoint);
  assert.equal(attempt.method, 'POST');
  assert.equal(attempt.blocked, true);
}
const expectedTelemetrySummary = {
  sdk: sdkName, sdkVersion, endpoint: sdkTelemetryEndpoint, method: 'POST', blocked: true,
  count: report.blockedSdkTelemetryAttempts.length,
  enforcement: 'isolated-vite-context-route-abort', productionHeadersVerified: false,
};
assert.deepEqual(report.sdkTelemetrySummary, expectedTelemetrySummary);
assert.deepEqual(manifest.sdkTelemetrySummary, expectedTelemetrySummary);

// Font readiness alone can pass while every Chinese character is a missing glyph.
const cjkFontFamilies = { 'zh-CN': 'Noto Sans CJK SC', 'zh-TW': 'Noto Sans CJK TC' };
assert.ok(Array.isArray(report.cjkFontEvidence));
assert.ok(Array.isArray(manifest.cjkFontEvidence));
assert.deepEqual(manifest.cjkFontEvidence, report.cjkFontEvidence,
  'Published font evidence must match the actual browser report.');
const cjkCaptures = report.screenshots.filter((entry) =>
  entry.state === 'captured' && !entry.failure && Object.hasOwn(cjkFontFamilies, entry.locale));
const captureKey = (entry) => entry.case + '\n' + (entry.capture ?? entry.file);
assert.deepEqual(report.cjkFontEvidence.map(captureKey).sort(), cjkCaptures.map(captureKey).sort(),
  'Each Chinese screenshot needs its own rendered-font evidence.');
assert.equal(new Set(report.cjkFontEvidence.map(captureKey)).size, report.cjkFontEvidence.length);
for (const locale of Object.keys(cjkFontFamilies))
  assert.ok(cjkCaptures.some((entry) => entry.locale === locale), 'Missing Chinese capture locale: ' + locale);
for (const evidence of report.cjkFontEvidence) {
  const capture = cjkCaptures.find((entry) => captureKey(entry) === captureKey(evidence));
  assert.equal(evidence.locale, capture.locale);
  assert.ok(passedCases.has(evidence.case));
  assert.equal(evidence.method, 'CDP.CSS.getPlatformFontsForNode');
  assert.ok(Array.isArray(evidence.samples) && evidence.samples.length > 0 && evidence.samples.length <= 3);
  for (const sample of evidence.samples) {
    assert.match(sample.selector, /^html > /);
    assert.match(sample.text, /^\p{Script=Han}+$/u);
    assert.equal(sample.hanCount, [...sample.text].length);
    assert.ok(sample.hanCount > 0 && sample.hanCount <= 32);
    assert.ok(Array.isArray(sample.fonts) && sample.fonts.length > 0);
    for (const font of sample.fonts) {
      assert.equal(typeof font.familyName, 'string');
      assert.equal(typeof font.postScriptName, 'string');
      assert.equal(typeof font.isCustomFont, 'boolean');
      assert.ok(Number.isInteger(font.glyphCount) && font.glyphCount >= 0);
    }
    const rendered = sample.fonts.filter((font) => font.familyName === cjkFontFamilies[evidence.locale])
      .reduce((count, font) => count + font.glyphCount, 0);
    assert.ok(rendered >= sample.hanCount, 'Chinese text used a missing or incorrect regional font.');
  }
}

let totalBytes = 0;
for (const file of manifest.files) {
  assert.ok(PUBLISH_IMAGE_PATHS.includes(file.path));
  const input = resolve(sourceRoot, file.path);
  assert.ok(input.startsWith(sourceRoot + '/'));
  const info = await lstat(input);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Only ordinary captured image files may be published.');
  const bytes = await readFile(input);
  assert.equal(bytes.length, file.bytes);
  assert.ok(bytes.length > 100 && bytes.length < 12 * 1024 * 1024);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  const isWebp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(file.path.endsWith('.webp') ? isWebp : isPng);
  totalBytes += bytes.length;
}
assert.ok(totalBytes < 64 * 1024 * 1024, 'Capture publication exceeds the bounded byte budget.');
for (const path of PUBLISH_PATHS) {
  const destination = resolve(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(sourceRoot, path), destination);
}
git(['add', '--', ...PUBLISH_PATHS]);
const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
assert.ok(staged.every((path) => PUBLISH_PATHS.includes(path)));
assert.equal(git(['diff', '--cached', '--name-only', '--diff-filter=D']), '');
assert.equal(git(['diff', '--name-only']), '');
assertRemoteHead();
if (!staged.length) {
  console.log('All reviewed screenshots already match; no commit or push needed.');
} else {
  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(['commit', '-m', 'docs: capture current system UI from ' + expectedHead.slice(0, 12) + ' [skip ci]']);
  assert.equal(git(['rev-parse', 'HEAD^']), expectedHead);
  assertRemoteHead();
  git(['push', 'origin', 'HEAD:refs/heads/' + BRANCH], true);
  const captureCommit = git(['rev-parse', 'HEAD']);
  console.log('Published ' + staged.length + ' approved capture files at ' + captureCommit);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      '## Current UI screenshots\n\nTested source: \`' + expectedHead + '\`.\n\n' +
      'Capture-only commit: [' + captureCommit.slice(0, 12) + '](https://github.com/' + REPOSITORY + '/commit/' + captureCommit + ').\n\n' +
      'The publication contains only the explicit image/manifest allowlist. No production deployment or provider calls occurred.\n');
}
