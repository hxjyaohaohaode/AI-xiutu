import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { AiResultDecision, AiResultDecisionRequest } from '@ai-xiutu/contracts';
import type { Artwork, Asset, ProjectDocument, Revision } from '../lib/types';
import { secureUuid } from '../lib/uuid';
import type { AIJob } from './types';

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'protocolVersion' | 'idempotencyKey'> : never;
export type DecisionDraft = WithoutEnvelope<AiResultDecisionRequest>;
export type DecisionResponse = {
  decision: AiResultDecision;
  replayed: boolean;
  artwork?: Artwork;
  revision?: Revision;
  asset?: Asset;
  document?: ProjectDocument;
};
export type DecisionStorage = Pick<Storage, 'getItem' | 'setItem'>;
const memoryKeys = new Map<string, string>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(record[key]))
      .join(',') +
    '}'
  );
}

/** Store only a digest and random token, never prompts or edited document text.
 * Identical retries in this tab retain their key after ambiguous network failures.
 * Actor + project scope prevents one account replaying another account's intent. */
export function decisionAttempt(
  scope: string,
  jobId: string,
  draft: DecisionDraft,
  storage?: DecisionStorage,
  makeUuid: () => string = secureUuid,
): AiResultDecisionRequest {
  const fingerprint = bytesToHex(
    sha256(new TextEncoder().encode(canonical({ scope, jobId, draft }))),
  );
  const key = 'ai-result-decision:v1:' + fingerprint;
  let token = memoryKeys.get(key);
  if (!token) {
    try {
      const stored = storage?.getItem(key);
      if (stored && uuidPattern.test(stored)) token = stored;
    } catch {
      /* private mode may deny storage */
    }
  }
  if (!token) token = makeUuid();
  memoryKeys.set(key, token);
  // Bound process memory without changing persisted retry identities.
  if (memoryKeys.size > 500) memoryKeys.delete(memoryKeys.keys().next().value!);
  try {
    storage?.setItem(key, token);
  } catch {
    /* the in-memory attempt is still stable */
  }
  return { ...draft, protocolVersion: 1, idempotencyKey: token } as AiResultDecisionRequest;
}

export function currentResultBlock(
  job: AIJob,
  artwork: Artwork | null,
  dirty: boolean,
): string | null {
  if (!artwork) return '先打开需要接收结果的作品，或另存为新作品。';
  if (job.projectId && artwork.projectId !== job.projectId) return '只能接收当前项目内的结果。';
  if (dirty) return '当前作品还有本地修改。先保存或撤销这些修改，再采用到当前作品；另存不受影响。';
  if (job.output?.kind === 'edit-plan') {
    if (job.output.artworkId !== artwork.id) return '这条建议属于另一件作品，可以另存为独立作品。';
    if (job.output.baseVersion !== artwork.headVersion)
      return '建议基于旧版本。为保护后续修改，请另存为独立作品。';
  }
  return null;
}

export const decisionLabels: Record<AiResultDecision['action'], string> = {
  reject: '暂不采用',
  fork: '已另存作品',
  replace: '已替换来源并保留旧版本',
  layer: '已加入合成图层',
  'apply-plan': '已采纳调整建议',
  'save-text': '已存为项目文档',
};
