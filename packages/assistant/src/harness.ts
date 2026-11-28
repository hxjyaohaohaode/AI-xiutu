import { ZodError } from 'zod';

/**
 * Deterministic harness pieces around the model loop.
 *
 * The model is probabilistic; recovery, loop limits and run-state reporting are
 * enforced here. Tool failures return a stable reason code and a recovery hint
 * so the model can fix its input once instead of guessing or repeating the call.
 * Only allow-listed codes and schema paths are exposed. Free-form error text
 * (which could carry provider, storage or permission detail) is never forwarded.
 */

export const TOOL_REJECTED = 'TOOL_INPUT_OR_ACCESS_REJECTED';

const HINTS: Record<string, string> = {
  INVALID_ARGUMENTS: 'Arguments did not match the tool schema. Correct the listed fields and call once more.',
  INVALID_JSON: 'Arguments were not valid JSON. Send one JSON object that matches the schema.',
  TOOL_NOT_ALLOWED: 'This tool is not offered in this round. Use a listed tool or answer the user.',
  NO_CURRENT_IMAGE: 'No editable image is open. Ask the user to open or select an image first.',
  CANDIDATE_LIMIT: 'The candidate limit is reached. Inspect or select an existing candidate instead.',
  CANDIDATE_NOT_FOUND: 'Use a candidateIndex listed in harness.candidates.',
  CANDIDATE_REVIEW_REQUIRED: 'Inspect the candidate first, then select it in a later response after reviewing the returned image.',
  CANDIDATE_INSPECTION_UNAVAILABLE: 'Inspection needs a shared canvas, an edit candidate and remaining inspections. Explain the result without inspection.',
  CANDIDATE_PREVIEW_INVALID: 'The render could not be checked. Report the candidate as unverified.',
  CANVAS_INSPECTION_UNAVAILABLE: 'The current canvas was not shared or was already measured this turn. Use the existing measurement.',
  GENERATION_REFERENCE_UNGROUNDED: 'Use only explicitly selected reference IDs or IDs returned by search_resources in this turn.',
  MEMORY_EVIDENCE_NOT_FOUND: 'Memory evidence must be an exact quote from the user. Quote the user verbatim or skip the suggestion.',
  MEMORY_SUGGESTION_LIMIT: 'Enough memory suggestions were made this turn.',
  ARCHIVE_UNAVAILABLE: 'Pass sourceTurnId to read_history or an artifactId from a previous output to read_tool_result.',
  SPECIALIST_BUDGET: 'Specialists were already consulted or the request budget is too small. Synthesize from available evidence.',
  RESEARCH_BUDGET: 'The research budget for this turn is used. Answer from collected evidence.',
  CHART_SOURCE_REQUIRED: 'Select a project document with a structured table first, or tell the user which columns are needed.',
  PROJECT_FILE_DRAFT_LIMIT: 'Four drafts were already prepared. Refer the user to those drafts.',
  REPEATED_FAILED_CALL: 'This exact call already failed in this turn. Change the arguments using the earlier hint, or answer the user.',
  OUT_OF_RANGE: 'A value is outside the allowed range. Use describe_editor ranges and absolute values.',
  REGION_UNAVAILABLE: 'The recipe has no regions or groups for that target. Use target "global" or ask the user to create a selection.',
  REGION_NOT_FOUND: 'Use an existing region or group ID from describe_editor.',
  GLOBAL_TARGET_ID_INVALID: 'A global target requires targetId null.',
  PARAMETER_NOT_ALLOWED: 'Use each parameter path once, exactly as listed by describe_editor.',
  PARAMETER_RANGE: 'A value is outside the parameter min/max. Use describe_editor ranges and absolute values.',
  PARAMETER_UNAVAILABLE_FOR_TARGET: 'That parameter does not exist for this target. Choose a parameter supported by the target.',
  SPATIAL_SELECTION_NOT_FOUND: 'Reference an existing selection from describe_editor, or ask the user to draw one.',
  SPATIAL_REQUIRES_V4: 'Local retouch and healing need a v4 recipe. Use global adjustments or explain the limit.',
  SPATIAL_OPERATION_NOT_FOUND: 'Use operationId null to add a new operation, or an existing manual operation ID.',
  SPATIAL_AUTOMATIC_OPERATION_OWNED: 'That operation was created automatically and cannot be edited by the assistant. Add a new operation instead.',
  SPATIAL_CHROMA_REQUIRES_NEW_OPERATION: 'chromaSpots can only be set on a new operation (operationId null).',
  SPATIAL_NO_EFFECT: 'The proposal would not change pixels. Set a non-zero strength or skip it.',
  SPATIAL_PATCH_RADIUS_NOT_APPLICABLE: 'patchRadius applies only to the patch algorithm. Remove it or change the algorithm.',
};

/** Error codes thrown as plain `Error(CODE)` inside the agent and its compilers. */
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface ToolFailure {
  error: typeof TOOL_REJECTED;
  reason: string;
  hint: string;
  issues?: { path: string; problem: string }[];
  message: string;
}

export function classifyToolError(error: unknown): ToolFailure {
  const base = {
    error: TOOL_REJECTED,
    message: 'Nothing was applied. Use only current supported ranges and authorized resources.',
  } as const;
  if (error instanceof ZodError) {
    const issues = error.issues.slice(0, 6).map((issue) => ({
      path: issue.path.map(String).join('.').slice(0, 120) || '(root)',
      problem: issue.code,
    }));
    return { ...base, reason: 'INVALID_ARGUMENTS', hint: HINTS.INVALID_ARGUMENTS!, issues };
  }
  if (error instanceof SyntaxError)
    return { ...base, reason: 'INVALID_JSON', hint: HINTS.INVALID_JSON! };
  if (error instanceof RangeError)
    return { ...base, reason: 'OUT_OF_RANGE', hint: HINTS.OUT_OF_RANGE! };
  const code = error instanceof Error ? error.message : '';
  if (CODE.test(code) && HINTS[code]) return { ...base, reason: code, hint: HINTS[code]! };
  // Permission, storage and unknown errors stay indistinguishable to the model.
  return {
    ...base,
    reason: 'REJECTED',
    hint: 'The request was rejected by application checks. Do not retry it; explain what the user can do.',
  };
}

export function repeatedFailure(): ToolFailure {
  return {
    error: TOOL_REJECTED,
    reason: 'REPEATED_FAILED_CALL',
    hint: HINTS.REPEATED_FAILED_CALL!,
    message: 'Nothing was applied.',
  };
}

/** Normalizes argument JSON so whitespace or key order cannot evade the repeat guard. */
export function callSignature(name: string, args: string) {
  try {
    return `${name}:${JSON.stringify(sortKeys(JSON.parse(args)))}`;
  } catch {
    return `${name}:${args}`;
  }
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  return value;
}

export interface LedgerCandidate {
  kind: 'edit' | 'generation';
  summary: string;
  inspected: boolean;
}

export interface RunLedgerInput {
  round: number;
  requestsUsed: number;
  maxRequests: number;
  candidates: LedgerCandidate[];
  inspectionsUsed: number;
  maxInspections: number;
  selectedCandidateIndex?: number;
  files: number;
  failedCallsThisRound: number;
  callsThisRound: number;
  canInspect: boolean;
}

/**
 * Structured run state appended to the newest tool output (append-only, so the
 * cached prompt prefix is never rewritten). It works like a maintained to-do:
 * the model sees what exists, what was verified and what it should do next.
 */
export function runLedger(input: RunLedgerInput) {
  const remaining = Math.max(0, input.maxRequests - input.requestsUsed);
  const uninspected = input.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.kind === 'edit' && !candidate.inspected)
    .map(({ index }) => index);
  let next: string;
  if (remaining <= 1)
    next = 'final_request: answer the user now from verified evidence; at most one select_candidate.';
  else if (input.callsThisRound > 0 && input.failedCallsThisRound === input.callsThisRound)
    next = 'all_calls_failed: fix inputs using the hints once, or explain the limitation.';
  else if (input.selectedCandidateIndex !== undefined)
    next = 'nominated: summarize for the user and stop calling tools.';
  else if (input.canInspect && uninspected.length && input.inspectionsUsed < input.maxInspections)
    next = `verify: inspect candidate ${uninspected[0]} before selecting.`;
  else if (input.candidates.length || input.files)
    next = 'review: select at most one verified candidate or summarize the drafts for the user.';
  else next = 'continue: call the next needed tool or answer.';
  return {
    round: input.round + 1,
    modelRequestsRemaining: remaining,
    candidates: input.candidates.slice(0, 12).map((candidate, index) => ({
      index,
      kind: candidate.kind,
      summary: candidate.summary.slice(0, 120),
      inspected: candidate.inspected,
    })),
    inspectionsRemaining: input.canInspect
      ? Math.max(0, input.maxInspections - input.inspectionsUsed)
      : 0,
    ...(input.selectedCandidateIndex !== undefined
      ? { nominated: input.selectedCandidateIndex }
      : {}),
    projectFiles: input.files,
    next,
  };
}

/** Adds the ledger to a serialized tool output without disturbing its own fields. */
export function withLedger(serialized: string, ledger: ReturnType<typeof runLedger>) {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return JSON.stringify({ ...parsed, harness: ledger });
    return JSON.stringify({ result: parsed, harness: ledger });
  } catch {
    return JSON.stringify({ result: serialized, harness: ledger });
  }
}
