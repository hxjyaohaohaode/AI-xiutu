import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { messageBlocks, messageLink } from '../src/ai/message-format.ts';
import {
  isResearchBranch,
  mergeResearchBranches,
  researchDisplayState,
  type ResearchBranch,
} from '../src/ai/research-graph-model.ts';
import { renderTestMarkup } from './support/render.ts';

const stylesheetLoader = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: 'export {};', shortCircuit: true }
      : next(url, context);
  },
});
const { AssistantText } = await import('../src/ai/AssistantText.tsx');
stylesheetLoader.deregister();

test('assistant output is readable text and cannot execute HTML, load images or use unsafe URLs', () => {
  const html = renderTestMarkup(
    createElement(AssistantText, {
      text: [
        '## 调整建议',
        '- **保留肤质**，使用 `曝光` 参数',
        '- [官方说明](https://example.com/docs?q=1)',
        '',
        '<script>alert(1)</script>',
        '[危险](javascript:alert) ![追踪](https://example.com/pixel.png)',
        '[凭据](https://user:pass@example.com/)',
      ].join('\n'),
    }),
  );
  assert.match(html, /<h4>调整建议<\/h4>/);
  assert.match(html, /<ul><li><strong>保留肤质<\/strong>/);
  assert.match(html, /href="https:\/\/example.com\/docs\?q=1"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<img|href="javascript|href="https:\/\/user/);
  assert.match(html, /!\[追踪\]/);
});

test('streaming unclosed fences remain literal code and keep earlier block keys stable', () => {
  const prefix = '第一段\n\n```json\n{"exposure":';
  const early = messageBlocks(prefix);
  const later = messageBlocks(prefix + ' 0.2}\n```\n\n下一段');
  assert.equal(early[1]!.kind, 'code');
  assert.deepEqual(later[0], early[0]);
  assert.equal(later[1]!.line, early[1]!.line);
  assert.equal(later[2]!.kind, 'paragraph');
  const html = renderTestMarkup(
    createElement(AssistantText, { text: '```html\n<img onerror=alert(1)>\n```' }),
  );
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

test('numbered instructions and small parameter tables preserve reported values', () => {
  const blocks = messageBlocks(
    '3. 调低高光\n5. 保留原片\n\n| 参数 | 建议 |\n| --- | ---: |\n| 曝光 | +0.3 |\n| 对比度 | -8 |',
  );
  assert.equal(blocks[0]!.kind, 'list');
  if (blocks[0]!.kind === 'list')
    assert.deepEqual(
      blocks[0]!.items.map((item) => item.number),
      [3, 5],
    );
  const html = renderTestMarkup(
    createElement(AssistantText, { text: '| 参数 | 建议 |\n| --- | ---: |\n| 曝光 | +0.3 |' }),
  );
  assert.match(html, /<th scope="col">参数<\/th>/);
  assert.match(html, /<td>\+0.3<\/td>/);
  assert.match(html, /assistant-table-scroll/);
  assert.equal(messageLink('data:text/html,a'), null);
  assert.equal(messageLink('//example.com'), null);
  assert.equal(messageLink('https://example.com/\nsecret'), null);
});

const branch = (id: string, state: ResearchBranch['state'] = 'running'): ResearchBranch => ({
  id,
  state,
  parentId: 'root',
  kind: 'cloud',
  execution: 'server',
  dependsOn: [],
});
test('resumed live branch updates retain snapshot dependencies and completed results', () => {
  const snapshot = [branch('root'), { ...branch('a', 'completed'), resultCount: 3 }, branch('b')];
  const live = [{ ...branch('b', 'completed'), dependsOn: ['a'] }];
  const combined = mergeResearchBranches(snapshot, live, true);
  assert.deepEqual(
    combined.map((item) => item.id),
    ['root', 'a', 'b'],
  );
  assert.equal(combined[1]!.resultCount, 3);
  assert.equal(combined[2]!.state, 'completed');
  assert.deepEqual(combined[2]!.dependsOn, ['a']);
});
test('terminal snapshots supersede earlier streaming states without inventing completion', () => {
  const combined = mergeResearchBranches([branch('a', 'interrupted')], [branch('a')], false);
  assert.equal(combined[0]!.state, 'interrupted');
  assert.equal(researchDisplayState(branch('a'), false, false), 'syncing');
  assert.equal(researchDisplayState(branch('a'), false, true), 'running');
  assert.equal(researchDisplayState(branch('a', 'completed'), false, false), 'completed');
  assert.equal(isResearchBranch({ ...branch('a'), state: 'syncing' }), false);
  assert.equal(isResearchBranch({ ...branch('a'), dependsOn: Array(49).fill('x') }), false);
});
