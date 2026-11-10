import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { collaborationLimits, type CollaborationSnapshot } from '@ai-xiutu/contracts';
import { CollaborationOverlay } from '../src/collaboration/CollaborationOverlay';
import { renderTestMarkup } from './support/render';

function fixture(): CollaborationSnapshot {
  const presence = {
    id: 'peer-session',
    artworkId: 'work',
    userId: 'peer',
    displayName: '<img src=x onerror=alert(1)>',
    cursor: { x: 0.25, y: 0.5 },
    tool: '局部',
    selection: null,
    sequence: 1,
    expiresAt: '2026-11-10T18:00:00Z',
  };
  return {
    artwork: {},
    revision: null,
    asset: {},
    limits: collaborationLimits,
    serverTime: '2026-11-10T17:59:00Z',
    previews: [],
    presences: [presence, { ...presence, id: 'self-session', displayName: '本窗口' }],
    leases: [
      {
        id: 'lease',
        sessionId: 'peer-session',
        userId: 'peer',
        displayName: presence.displayName,
        target: { kind: 'region', collection: 'regionEdits', id: 'region' },
        fence: '1',
        expiresAt: presence.expiresAt,
        bounds: { x: 0.2, y: 0.3, width: 0.2, height: 0.2 },
      },
    ],
  };
}

test('remote cursors use source projection, retain readable size under zoom, and escape member names', () => {
  const markup = renderTestMarkup(
    createElement(CollaborationOverlay, {
      snapshot: fixture(),
      sessionId: 'self-session',
      zoom: 2,
      toDisplay: (point) => ({ x: point.x + 0.1, y: point.y }),
    }),
  );
  assert.match(markup, /left:35%;top:50%;transform:scale\(0\.5\)/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(markup, /<img|本窗口/);
  assert.equal((markup.match(/class="collaboration-cursor"/g) ?? []).length, 1);
  assert.match(markup, /<polygon/);
  assert.match(markup, /stroke-width="0.15"/);
});

test('cropped, nonfinite, or horizon-crossing peer locations cannot crash the canvas or draw phantom cursors', () => {
  for (const [index, toDisplay] of [
    () => {
      throw new Error('homography horizon');
    },
    () => ({ x: Number.NaN, y: Infinity }),
    () => ({ x: -1, y: 0.5 }),
  ].entries()) {
    const markup = renderTestMarkup(
      createElement(CollaborationOverlay, {
        snapshot: fixture(),
        sessionId: 'self-session',
        zoom: 1,
        toDisplay,
      }),
    );
    assert.doesNotMatch(markup, /class="collaboration-cursor"|NaN|Infinity/);
    if (index < 2) assert.doesNotMatch(markup, /<polygon/);
  }
});
