import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import * as React from 'react';
import { createRecipeV4 } from '@ai-xiutu/editor';
import { composerSubmitKey } from '../src/ai/ComposerInput.tsx';
import {
  acceptJobSubmission,
  freezeJobSubmission,
  saveJobSubmission,
} from '../src/ai/jobSubmission.ts';
import type { AIJob } from '../src/ai/types.ts';
import type { Project } from '../src/lib/types.ts';
import { renderTestMarkup } from './support/render.ts';

const stylesheetLoader = registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return next(url, context);
  },
});
// AIPanel has module-level icon elements. Root tsx uses the classic JSX runtime.
const initialReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
Object.defineProperty(globalThis, 'React', { value: React, configurable: true });
const { AIPanel } = await import('../src/components/AIPanel.tsx');
const { AIThread } = await import('../src/ai/AIThread.tsx');
if (initialReact) Object.defineProperty(globalThis, 'React', initialReact);
else Reflect.deleteProperty(globalThis, 'React');
stylesheetLoader.deregister();

const key = {
  key: 'Enter',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
};
test('the AI composer reserves ordinary Enter for multiline text and requires an explicit send chord', () => {
  assert.equal(composerSubmitKey(key), false);
  assert.equal(composerSubmitKey({ ...key, ctrlKey: true }), true);
  assert.equal(composerSubmitKey({ ...key, metaKey: true }), true);
  assert.equal(composerSubmitKey({ ...key, ctrlKey: true, shiftKey: true }), false);
  assert.equal(composerSubmitKey({ ...key, metaKey: true, altKey: true }), false);
});
test('Chinese input composition never submits a paid request on its confirmation key', () => {
  assert.equal(composerSubmitKey({ ...key, ctrlKey: true, isComposing: true }), false);
  assert.equal(composerSubmitKey({ ...key, metaKey: true, keyCode: 229 }), false);
  assert.equal(composerSubmitKey({ ...key, key: 'a', ctrlKey: true }), false);
});

const project: Project = {
  id: '20000000-0000-4000-8000-000000000001',
  spaceId: 'space',
  title: '测试项目',
  description: '',
  role: 'owner',
  version: 1,
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
};
const empty = () => undefined;
const panelProps = {
  project: null,
  artwork: null,
  recipe: createRecipeV4(),
  config: null,
  referenceFile: null,
  onClearReference: empty,
  onDraw: empty,
  onClose: empty,
  onPreview: empty,
  onSave: empty,
  onCreateProject: empty,
  onOpenArtwork: empty,
  onTaskChanged: empty,
  isLoggedIn: false,
  onAuth: empty,
};
test('the default AI panel exposes the text composer after its conversation and keeps settings inert', () => {
  const markup = renderTestMarkup(React.createElement(AIPanel, panelProps));
  assert.ok(markup.indexOf('ai-workbench-header') < markup.indexOf('ai-conversation-body'));
  assert.ok(markup.indexOf('ai-conversation-body') < markup.indexOf('ai-composer-region'));
  assert.match(markup, /aria-label="向智能体描述修改需求"/);
  assert.doesNotMatch(markup, />开始实时通话<|assistant-voice-orb|ai-task-tabs/);
  assert.match(markup, /aria-label="发送协作请求"[^>]*disabled=""/);
  const dialogs = [...markup.matchAll(/<dialog\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(dialogs.length > 0);
  assert.ok(dialogs.every((tag) => tag.includes('inert=""') && tag.includes('aria-hidden="true"')));
});

test('a recovered unknown job keeps its warning outside closed settings and blocks new sending', () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  const job: AIJob = {
    id: '40000000-0000-4000-8000-000000000001',
    projectId: project.id,
    operation: 'generate-image',
    modelId: 'configured-image-model',
    state: 'unknown',
    output: null,
    errorCode: null,
    reservedUnits: 20,
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
  };
  const pending = freezeJobSubmission({
    actorId: 'composer-unknown-user',
    projectId: project.id,
    projectTitle: project.title,
    recipeSnapshot: JSON.stringify(panelProps.recipe),
    body: {
      operation: 'generate-image',
      modelId: job.modelId,
      idempotencyKey: '10000000-0000-4000-8000-000000000001',
      prompt: '用户明确发送的要求',
      width: 1024,
      height: 1024,
    },
  });
  saveJobSubmission(storage, acceptJobSubmission(pending, job));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
  try {
    const markup = renderTestMarkup(
      React.createElement(AIPanel, {
        ...panelProps,
        project,
        userId: pending.actorId,
        isLoggedIn: true,
      }),
    );
    const visiblePanel = markup.slice(0, markup.indexOf('<dialog'));
    assert.match(visiblePanel, /结果待核验，暂不能提交新任务/);
    assert.match(visiblePanel, />核对请求<\/button>/);
    assert.match(visiblePanel, /aria-label="生成图片"[^>]*disabled=""/);
    assert.doesNotMatch(
      markup,
      /class="live-assistant /,
      'an unvisited assistant is not mounted while a frozen unknown task owns recovery',
    );
    assert.equal(entries.size, 1, 'rendering never clears or replaces the original request');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
    storage.removeItem([...entries.keys()][0]!);
  }
});

test('completed AI results receive both artwork-write guards from the containing workspace', () => {
  const before = async () => undefined;
  const after = async () => undefined;
  const job: AIJob = {
    id: 'completed',
    projectId: project.id,
    operation: 'generate-text',
    modelId: 'model',
    state: 'completed',
    output: { kind: 'text', title: '标题', body: '正文', summary: '摘要' },
    errorCode: null,
    reservedUnits: 1,
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', { value: React, configurable: true });
  try {
    // Inspect the component boundary without mounting a decision controller or issuing writes.
    const tree = AIThread({
      jobs: [job],
      project,
      onOpen: empty,
      onPreview: empty,
      onContinue: empty,
      onTranscript: empty,
      onChanged: empty,
      onBeforeArtworkWrite: before,
      onAfterArtworkWrite: after,
    });
    const resultProps: Record<string, unknown>[] = [];
    function visit(node: React.ReactNode) {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!React.isValidElement<Record<string, unknown>>(node)) return;
      if (
        typeof node.type === 'function' &&
        node.props.job === job &&
        node.props.project === project
      )
        resultProps.push(node.props);
      visit(node.props.children as React.ReactNode);
    }
    visit(tree);
    assert.equal(resultProps.length, 1);
    assert.equal(resultProps[0]!.onBeforeArtworkWrite, before);
    assert.equal(resultProps[0]!.onAfterArtworkWrite, after);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  }
});
