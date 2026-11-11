import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import type { EditorState } from '../src/editor/useEditor.ts';
import type { Project } from '../src/lib/types.ts';
import { renderTestMarkup } from './support/render.ts';

// Node checks rendered controls. The browser checks the corresponding stylesheet.
const stylesheetLoader = registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return next(url, context);
  },
});
const {
  canResolveProjectComment,
  workspacePermissions,
  CollaborateView,
  CompareView,
  DocumentsView,
  WorksView,
} = await import('../src/components/WorkspaceViews.tsx');
stylesheetLoader.deregister();

const cases = [
  { role: 'owner', edit: true, comment: true, share: true },
  { role: 'admin', edit: true, comment: true, share: true },
  { role: 'editor', edit: true, comment: true, share: false },
  // Reference grants are exposed by the API as reviewer, with comment permission.
  { role: 'reviewer', edit: false, comment: true, share: false },
  { role: 'viewer', edit: false, comment: false, share: false },
  { role: 'unrecognized-role', edit: false, comment: false, share: false },
] as const;

function project(role: string): Project {
  return {
    id: 'project-1',
    spaceId: 'space-1',
    title: '共同创作',
    description: '',
    version: 1,
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
    role,
  };
}

function buttonLabels(markup: string): string[] {
  return [...markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)].map((match) =>
    match[1]!.replace(/<[^>]*>/g, '').trim(),
  );
}

test('project role gates match the API collaboration and sharing policy', async (t) => {
  for (const { role, edit, comment, share } of cases)
    await t.test(role, () => {
      assert.deepEqual(workspacePermissions(role), { edit, comment, share });
    });
});

test('reviewers can resolve their own comments without managing other authors', () => {
  assert.equal(canResolveProjectComment('reviewer', 'me', 'me'), true);
  assert.equal(canResolveProjectComment('reviewer', 'me', 'another-author'), false);
  assert.equal(canResolveProjectComment('reviewer', 'me', undefined), false);
  assert.equal(canResolveProjectComment('reviewer', undefined, undefined), false);
});

test('comment authorship never bypasses a read-only or unknown project role', () => {
  assert.equal(canResolveProjectComment('viewer', 'me', 'me'), false);
  assert.equal(canResolveProjectComment('unrecognized-role', 'me', 'me'), false);
});

test('project editors and administrators can resolve comments from any author', () => {
  for (const role of ['owner', 'admin', 'editor']) {
    assert.equal(canResolveProjectComment(role, 'me', 'another-author'), true);
    assert.equal(canResolveProjectComment(role, undefined, undefined), true);
  }
});

test('works and collaboration render project-sharing controls only for administrators', async (t) => {
  for (const { role, share } of cases)
    await t.test(role, () => {
      const collaboration = renderTestMarkup(
        createElement(CollaborateView, {
          project: project(role),
          artwork: null,
          revision: null,
          refreshToken: 0,
          currentUserId: 'me',
          onShare: () => undefined,
        }),
      );
      assert.equal(buttonLabels(collaboration).includes('共享项目'), share);
      assert.match(collaboration, /正在读取讨论与任务/);
      assert.equal(
        /<textarea\b/.test(collaboration),
        false,
        'loading is not an empty comment form',
      );

      const works = renderTestMarkup(
        createElement(WorksView, {
          project: project(role),
          artworks: [],
          assets: [],
          onOpen: () => undefined,
          onImport: () => undefined,
          onCreate: () => undefined,
          onCopy: () => undefined,
          onShare: () => undefined,
        }),
      );
      assert.equal(buttonLabels(works).includes('共享'), share);
    });
});

test('read-only project documents do not expose new-document or save actions', async (t) => {
  for (const { role, edit } of cases)
    await t.test(role, () => {
      const markup = renderTestMarkup(
        createElement(DocumentsView, {
          actorId: 'permission-test-actor',
          project: project(role),
          refreshToken: 0,
          onDirtyChange: () => undefined,
        }),
      );
      const buttons = buttonLabels(markup);
      assert.equal(buttons.includes('新建文档'), edit);
      assert.equal(
        buttons.includes('保存文档'),
        false,
        'saving requires an explicitly opened draft',
      );
      assert.equal(/<textarea\b/.test(markup), false, 'initial view must not create a blank draft');
      if (!edit) assert.match(markup, /当前为浏览模式，可以查看和复制项目文档/);
    });
});

test('empty comparison renders without browser globals and cannot restore a version', () => {
  const editor = { file: null } as EditorState;
  const markup = renderTestMarkup(
    createElement(CompareView, {
      editor,
      artwork: null,
      onOpenRevision: async () => undefined,
      onRestoreRevision: async () => undefined,
    }),
  );
  assert.match(markup, /先打开一张图片/);
  assert.equal(
    buttonLabels(markup).some((label) => label.includes('恢复')),
    false,
  );
});
