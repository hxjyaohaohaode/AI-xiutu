import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createRecipeV4 } from '@ai-xiutu/editor';
import { assistantModelConfigSchema, runEditorAgent, type AgentContext } from '../src/index.js';
import { buildSystemPrompt, promptSections, PROMPT_POLICY_VERSION } from '../src/prompt.js';
import {
  callSignature,
  classifyToolError,
  runLedger,
  withLedger,
  TOOL_REJECTED,
} from '../src/harness.js';

const settings = assistantModelConfigSchema.parse({
  enabled: true,
  provider: 'openai',
  operations: ['assistant-turn'],
  unitCost: 5,
  imageInput: true,
  webSearch: true,
});
const context = (overrides: Partial<AgentContext> = {}): AgentContext => ({
  prompt: '把曝光降低一点',
  recipe: createRecipeV4(),
  allowWebSearch: false,
  async assertAccess() {},
  async moderate() {},
  async search() {
    return { resources: [] };
  },
  async validateReferenceIds() {},
  ...overrides,
});
const response = (output: unknown[]) =>
  new Response(JSON.stringify({ status: 'completed', output, usage: { output_tokens: 10 } }), {
    headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-request' },
  });
const text = (value: string) => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text: value, annotations: [] }],
});
const tool = (name: string, args: unknown, callId = name) => ({
  type: 'function_call',
  name,
  call_id: callId,
  arguments: JSON.stringify(args),
});

test('prompt keeps stable policy first, run facts last and only usable tool guidance', () => {
  const base = {
    sharedCurrent: false,
    executionMode: 'confirm' as const,
    hasRecipe: true,
    hasProjectDocument: false,
    jsonAnswer: false,
  };
  const editing = buildSystemPrompt({ ...base, tools: new Set(['propose_edit', 'select_candidate']) });
  const office = buildSystemPrompt({
    ...base,
    hasRecipe: false,
    tools: new Set(['draft_project_file', 'draft_data_chart']),
  });
  assert.ok(editing.startsWith(`Policy ${PROMPT_POLICY_VERSION}.\n## Role`));
  assert.match(editing, /## Editing/);
  assert.doesNotMatch(editing, /## Project files|## Data charts/);
  assert.match(office, /## Project files[\s\S]*## Data charts/);
  assert.doesNotMatch(office, /## Editing|## Canvas/);
  // Per-turn values must not move the cached prefix: they appear only in the final section.
  const sections = promptSections({ ...base, tools: new Set(['propose_edit']) });
  assert.equal(sections.at(-1)!.id, 'run');
  for (const section of sections.slice(0, -1)) assert.doesNotMatch(section.body, /Current preview supplied/);
  const auto = buildSystemPrompt({ ...base, sharedCurrent: true, executionMode: 'auto', tools: new Set(['propose_edit', 'select_candidate']) });
  assert.equal(
    editing.slice(0, editing.indexOf('## Run context')),
    auto.slice(0, auto.indexOf('## Run context')),
  );
  assert.match(auto, /budgeted auto[\s\S]*Current preview supplied: true/);
});

test('tool failures expose stable codes, schema paths and hints but never free-form errors', () => {
  const schema = z.object({ candidateIndex: z.number().int() }).strict();
  const zod = classifyToolError(schema.safeParse({ candidateIndex: 'x', extra: 1 }).error);
  assert.equal(zod.error, TOOL_REJECTED);
  assert.equal(zod.reason, 'INVALID_ARGUMENTS');
  assert.ok(zod.issues!.some((issue) => issue.path === 'candidateIndex'));
  assert.equal(classifyToolError(new Error('CANDIDATE_REVIEW_REQUIRED')).reason, 'CANDIDATE_REVIEW_REQUIRED');
  assert.match(classifyToolError(new Error('PARAMETER_RANGE')).hint, /min\/max/);
  const secret = classifyToolError(new Error('permission denied for /private/user-42/photo.jpg'));
  assert.equal(secret.reason, 'REJECTED');
  assert.doesNotMatch(JSON.stringify(secret), /user-42|private/);
  assert.equal(classifyToolError(new Error('UNLISTED_INTERNAL_CODE')).reason, 'REJECTED');
  assert.equal(callSignature('a', '{"b":1,"a":[2]}'), callSignature('a', '{ "a": [2], "b": 1 }'));
});

test('run ledger reports remaining budget, verification state and the next step', () => {
  const ledger = runLedger({
    round: 0,
    requestsUsed: 1,
    maxRequests: 4,
    candidates: [{ kind: 'edit', summary: '降曝光', inspected: false }],
    inspectionsUsed: 0,
    maxInspections: 3,
    files: 0,
    failedCallsThisRound: 0,
    callsThisRound: 1,
    canInspect: true,
  });
  assert.equal(ledger.modelRequestsRemaining, 3);
  assert.match(ledger.next, /^verify: inspect candidate 0/);
  const last = runLedger({ ...ledgerBase(), requestsUsed: 3 });
  assert.match(last.next, /^final_request/);
  assert.deepEqual(JSON.parse(withLedger('{"status":"ok"}', ledger)).status, 'ok');
  assert.deepEqual(JSON.parse(withLedger('[1]', ledger)).result, [1]);
});
const ledgerBase = () => ({
  round: 2,
  requestsUsed: 2,
  maxRequests: 4,
  candidates: [],
  inspectionsUsed: 0,
  maxInspections: 3,
  files: 0,
  failedCallsThisRound: 0,
  callsThisRound: 1,
  canInspect: false,
});

test('an identical failing call is not executed twice and repeated failure forces a text answer', async () => {
  const bodies: any[] = [];
  const bad = { summary: '过曝', target: 'global', targetId: null, changes: [{ path: 'adjustments.exposure', value: 99 }] };
  let compiled = 0;
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      async moderate(value) {
        if (value === '过曝') compiled++;
      },
    }),
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      if (bodies.length <= 2) return response([tool('propose_edit', bad, `call-${bodies.length}`)]);
      return response([text('曝光上限为允许范围内的值，请确认目标。')]);
    },
  );
  assert.equal(result.termination, 'completed');
  const first = JSON.parse(bodies[1].input.at(-1).output);
  assert.equal(first.error, TOOL_REJECTED);
  assert.equal(first.reason, 'PARAMETER_RANGE');
  assert.equal(first.harness.modelRequestsRemaining, 3);
  assert.match(first.harness.next, /^all_calls_failed/);
  const second = JSON.parse(bodies[2].input.at(-1).output);
  assert.equal(second.reason, 'REPEATED_FAILED_CALL');
  // Two consecutive all-failed rounds: the next request may only answer.
  assert.equal(bodies[2].tool_choice, 'none');
  assert.equal(bodies[1].tool_choice, undefined);
  // The cached instruction prefix is identical across rounds.
  assert.equal(bodies[0].instructions, bodies[2].instructions);
  assert.equal(compiled, 0);
});

test('a successful proposal receives a verification hint in the ledger', async () => {
  const bodies: any[] = [];
  await runEditorAgent('fixture', 'fixture', settings, context(), async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    bodies.push(body);
    if (bodies.length === 1)
      return response([
        tool('propose_edit', {
          summary: '降曝光',
          target: 'global',
          targetId: null,
          changes: [{ path: 'adjustments.exposure', value: -0.3 }],
        }),
      ]);
    return response([text('已准备候选。')]);
  });
  const output = JSON.parse(bodies[1].input.at(-1).output);
  assert.equal(output.candidateIndex, 0);
  assert.deepEqual(output.harness.candidates, [{ index: 0, kind: 'edit', summary: '降曝光', inspected: false }]);
  // No shared canvas: the agent cannot inspect, so it is told to review/select or summarize.
  assert.match(output.harness.next, /^review/);
});
