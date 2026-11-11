/** Alternating same-process old/new planner measurements on synthetic history. No provider call. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import assert from 'node:assert/strict';
import { planHistory } from '../../packages/assistant/src/context-budget.js';
if (process.env.CI !== 'true') throw new Error('Isolated QA only');
const output = resolve(process.env.ASSISTANT_LATENCY_DIR ?? 'artifacts/assistant-latency');
await mkdir(output, { recursive: true });
const sourceRef = process.env.ASSISTANT_REFERENCE_COMMIT ?? '311100a';
const originalSource = execFileSync(
  'git',
  ['show', `${sourceRef}:packages/assistant/src/context-budget.ts`],
  { encoding: 'utf8' },
);
const path = join(output, `.context-reference-${randomUUID()}.mjs`);
const report = { reference: sourceRef, order: 'ABBA', warmups: 2, rounds: [], paidCalls: 0 };
try {
  await writeFile(
    path,
    transpileModule(originalSource, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText,
  );
  const reference = (await import(pathToFileURL(path).href)).planHistory;
  const history = Array.from({ length: 30 }, (_, i) => [
    {
      role: 'user',
      sourceTurnId: `t-${i}`,
      content: `保留人物、球衣数字和背景，只优化第${i}次修改的光线。`,
    },
    {
      role: 'assistant',
      sourceTurnId: `t-${i}`,
      content: '这是尚未确认的建议与观察，保持每次修改来源。'.repeat(130),
      candidateTrace: JSON.stringify([{ id: `c-${i}`, decision: 'previewed', base_version: i }]),
    },
  ]).flat();
  const budget = { contextWindowTokens: 8192, maxOutputTokens: 1024, visualTokenReserve: 4096 };
  const measure = (fn) => {
    const start = performance.now(),
      result = fn(history, { user: '继续优化' }, 0, budget);
    return { ms: performance.now() - start, result };
  };
  for (let warmup = 0; warmup < 2; warmup++) {
    measure(reference);
    measure(planHistory);
  }
  for (let round = 0; round < 5; round++) {
    const a1 = measure(reference),
      b1 = measure(planHistory),
      b2 = measure(planHistory),
      a2 = measure(reference);
    for (const result of [b1, b2, a2]) assert.deepEqual(result.result, a1.result);
    report.rounds.push({ referenceMs: [a1.ms, a2.ms], optimizedMs: [b1.ms, b2.ms] });
    report.outputSha256 = createHash('sha256').update(JSON.stringify(a1.result)).digest('hex');
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  report.referenceMedianMs = median(report.rounds.flatMap((r) => r.referenceMs));
  report.optimizedMedianMs = median(report.rounds.flatMap((r) => r.optimizedMs));
  report.sourceSha256 = createHash('sha256')
    .update(await readFile('packages/assistant/src/context-budget.ts'))
    .digest('hex');
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
} finally {
  await unlink(path).catch(() => {});
}
