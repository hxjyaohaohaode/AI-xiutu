import type { AssistantCandidate } from '@ai-xiutu/contracts';
import { parseEditorRecipe, type EditorRecipe } from '@ai-xiutu/editor';

export interface AssistantOperationToken {
  readonly scope: string;
  readonly epoch: number;
  readonly sequence: number;
}

/** A request can release only its own lock; returning to an old scope does not revive it. */
export class AssistantOperationGate {
  private scope = '';
  private epoch = 0;
  private sequence = 0;
  private owner: AssistantOperationToken | null = null;

  setScope(scope: string): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.invalidate();
  }

  invalidate(): void {
    this.epoch++;
    this.owner = null;
  }

  get busy(): boolean {
    return this.owner !== null;
  }

  begin(): AssistantOperationToken | null {
    if (this.owner) return null;
    const token = Object.freeze({
      scope: this.scope,
      epoch: this.epoch,
      sequence: ++this.sequence,
    });
    this.owner = token;
    return token;
  }

  beginLatest(): AssistantOperationToken {
    this.invalidate();
    return this.begin()!;
  }

  owns(token: AssistantOperationToken): boolean {
    return this.owner === token && token.scope === this.scope && token.epoch === this.epoch;
  }

  finish(token: AssistantOperationToken): boolean {
    if (!this.owns(token)) return false;
    this.owner = null;
    return true;
  }
}

export interface AssistantEditorState {
  loggedIn: boolean;
  projectId: string | null;
  spaceId: string | null;
  artworkId: string | null;
  assetId: string | null;
  version: number | null;
  recipe: EditorRecipe;
}

export function assistantScopeKey(
  value: Pick<AssistantEditorState, 'loggedIn' | 'projectId' | 'spaceId'>,
): string {
  return JSON.stringify([value.loggedIn, value.projectId, value.spaceId]);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function assistantEditorKey(value: AssistantEditorState): string {
  return canonical({ ...value, recipe: parseEditorRecipe(value.recipe) });
}

/** The only await is before the final identity check; applying the preview is synchronous. */
export async function acknowledgeEditCandidate(
  candidate: AssistantCandidate,
  options: {
    readCurrent: () => AssistantEditorState;
    isActive: () => boolean;
    acknowledge: (body: {
      decision: 'previewed';
      recipe: EditorRecipe;
      expectedVersion: number;
    }) => Promise<unknown>;
    apply: (recipe: EditorRecipe) => void;
  },
): Promise<boolean> {
  if (!options.isActive()) return false;
  const before = options.readCurrent();
  if (
    !before.loggedIn ||
    !before.projectId ||
    !before.artworkId ||
    !before.assetId ||
    before.version === null ||
    candidate.kind !== 'edit' ||
    candidate.artworkId !== before.artworkId ||
    candidate.baseVersion !== before.version ||
    canonical(parseEditorRecipe(candidate.baseRecipe)) !==
      canonical(parseEditorRecipe(before.recipe))
  )
    throw new Error('图片或参数已经变化，请更新上下文后重新生成建议。');
  const baseline = assistantEditorKey(before);
  const proposed = parseEditorRecipe(candidate.recipe);
  await options.acknowledge({
    decision: 'previewed',
    recipe: parseEditorRecipe(before.recipe),
    expectedVersion: before.version,
  });
  if (!options.isActive()) return false;
  if (assistantEditorKey(options.readCurrent()) !== baseline)
    throw new Error(
      '确认记录已保存，但图片或参数在等待期间发生变化；建议没有应用，请重新获取当前画面建议。',
    );
  options.apply(proposed);
  return true;
}
