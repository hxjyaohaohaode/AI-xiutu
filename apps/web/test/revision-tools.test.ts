import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/lib/api.ts';
import {
  clearRevisionFork,
  completeRevisionFork,
  fetchRevisionPng,
  freezeRevisionFork,
  openRevisionForkResult,
  persistRevisionFork,
  readRevisionFork,
  revisionForkReceipt,
  revisionForkRejected,
  revisionForkStorageKey,
  revisionRenderState,
  validateRevisionRenderInfo,
  type RevisionCheckpointStorage,
  type RevisionForkCheckpoint,
  type RevisionRenderInfo,
} from '../src/components/revision-tools-model.ts';

const id = (number: number) => `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`;
const actorId = id(1),
  artworkId = id(2),
  projectId = id(3),
  sourceId = id(4),
  revisionId = id(5);
const reference = { id: revisionId, artworkId, assetId: sourceId, version: 7 };
const input = { actorId, artworkId, projectId, revision: reference, title: '  新的分支  ' };
const frozen = () => freezeRevisionFork(input, () => id(6));
function storage(): RevisionCheckpointStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
function response(value: RevisionForkCheckpoint = frozen(), replayed = false) {
  return {
    artwork: {
      id: id(7),
      projectId,
      assetId: sourceId,
      title: value.body.title,
      headVersion: 1,
      headRevisionId: id(8),
    },
    revision: {
      id: id(8),
      artworkId: id(7),
      assetId: sourceId,
      version: 1,
      parentId: null,
      authorId: actorId,
      origin: { kind: 'history-fork', sourceRevisionId: revisionId },
    },
    asset: { id: sourceId, projectId },
    replayed,
  };
}
const renderInfo: RevisionRenderInfo = {
  artworkId,
  revisionId,
  version: 7,
  source: { assetId: sourceId, width: 1, height: 1, kind: 'canonical' },
  output: { width: 1, height: 1 },
  pixelFormat: 'srgb-rgba8',
  available: true,
  limits: [],
  encodedBytes: 70,
  estimatedWorkingBytes: 200,
  budget: {
    maxRasterPixels: 24_000_000,
    maxEncodedBytes: 72 * 1024 * 1024,
    maxWorkingBytes: 320 * 1024 * 1024,
  },
};
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const pngResponse = (overrides: Record<string, string> = {}) =>
  new Response(png, {
    headers: {
      'content-type': 'image/png',
      'x-xiutu-revision': revisionId,
      'x-xiutu-pixel-format': 'srgb-rgba8',
      ...overrides,
    },
  });

test('history fork freezes the actual three-field API body and binds the immutable selected source', () => {
  const value = frozen();
  assert.deepEqual(value.body, { revisionId, idempotencyKey: id(6), title: '新的分支' });
  assert.equal(Object.isFrozen(value.body), true);
  assert.equal(value.sourceAssetId, sourceId);
  assert.equal(value.sourceVersion, 7);
  assert.equal('expectedHeadVersion' in value.body, false);
  assert.equal('recipe' in value.body, false);
  assert.throws(
    () =>
      freezeRevisionFork({ ...input, revision: { ...reference, artworkId: id(30) } }, () => id(6)),
    /当前作品/,
  );
  assert.throws(() => freezeRevisionFork({ ...input, title: ' ' }, () => id(6)));
});

test('unknown fork survives reload in its account/work scope and blocks replacement by a new key', () => {
  const saved = storage(),
    value = frozen();
  persistRevisionFork(saved, value);
  assert.deepEqual(readRevisionFork(saved, actorId, artworkId)?.body, value.body);
  assert.equal(readRevisionFork(saved, id(99), artworkId), null);
  assert.equal(readRevisionFork(saved, actorId, id(99)), null);
  assert.throws(
    () =>
      persistRevisionFork(
        saved,
        freezeRevisionFork(input, () => id(9)),
      ),
    /另一条/,
  );
  assert.equal(saved.values.size, 1);
  assert.equal(readRevisionFork(saved, actorId, artworkId)?.body.idempotencyKey, id(6));
  assert.doesNotMatch([...saved.values.values()].join(''), /recipe|imageBase64|data:image|ticket/);
});

test('corrupt recovery identity is retained and cannot silently be replaced', () => {
  const saved = storage();
  const key = revisionForkStorageKey(actorId, artworkId);
  saved.setItem(key, '{broken');
  assert.throws(() => readRevisionFork(saved, actorId, artworkId), /无法读取/);
  assert.throws(() => persistRevisionFork(saved, frozen()), /无法读取/);
  assert.equal(saved.getItem(key), '{broken');
});

test('validated first and replay receipts require the exact author, project, source and history origin', () => {
  const value = frozen();
  const first = revisionForkReceipt(response(), value);
  assert.deepEqual(revisionForkReceipt(response(value, true), value), first);
  assert.deepEqual(first, {
    artworkId: id(7),
    projectId,
    revisionId: id(8),
    sourceRevisionId: revisionId,
    sourceAssetId: sourceId,
  });
  for (const wrong of [
    { ...response(), artwork: { ...response().artwork, title: '另一个名称' } },
    { ...response(), artwork: { ...response().artwork, projectId: id(99) } },
    { ...response(), artwork: { ...response().artwork, headVersion: 2 } },
    { ...response(), revision: { ...response().revision, authorId: id(99) } },
    { ...response(), revision: { ...response().revision, assetId: id(99) } },
    {
      ...response(),
      revision: {
        ...response().revision,
        origin: { kind: 'history-fork', sourceRevisionId: id(99) },
      },
    },
    { ...response(), asset: { ...response().asset, id: id(99) } },
  ])
    assert.throws(() => revisionForkReceipt(wrong, value), /回执/);
});

test('known creation cannot be downgraded, and late receipts cannot revive a cleared or newer request', () => {
  const saved = storage(),
    value = frozen(),
    receipt = revisionForkReceipt(response(), value);
  persistRevisionFork(saved, value);
  completeRevisionFork(saved, value, receipt);
  assert.deepEqual(readRevisionFork(saved, actorId, artworkId)?.created, receipt);
  assert.throws(() => persistRevisionFork(saved, value), /已经创建/);
  clearRevisionFork(saved, value);
  completeRevisionFork(saved, value, receipt);
  assert.equal(readRevisionFork(saved, actorId, artworkId), null);
  const next = freezeRevisionFork(input, () => id(9));
  persistRevisionFork(saved, next);
  completeRevisionFork(saved, value, receipt);
  clearRevisionFork(saved, value);
  assert.equal(readRevisionFork(saved, actorId, artworkId)?.body.idempotencyKey, id(9));
});

test('only documented first-attempt rejections clear an unaccepted request, never an opening failure', () => {
  const denied = new ApiError('PROJECT_FORBIDDEN', '无权限', 403);
  assert.equal(revisionForkRejected(denied, true), true);
  assert.equal(
    revisionForkRejected(new ApiError('SOURCE_UNAVAILABLE', '源图已不可用', 409), true),
    true,
  );
  assert.equal(
    revisionForkRejected(new ApiError('SOURCE_UNAVAILABLE', '源图已不可用', 409), false),
    false,
  );
  assert.equal(
    revisionForkRejected(new ApiError('LAYER_ASSET_MISMATCH', '图层来源已不可用', 400), true),
    true,
  );
  assert.equal(revisionForkRejected(denied, false), false);
  assert.equal(revisionForkRejected(denied, true, true), false);
  assert.equal(
    revisionForkRejected(new ApiError('ARTWORK_NOT_FOUND', '打开失败', 404), true, true),
    false,
  );
  assert.equal(
    revisionForkRejected(new ApiError('IDEMPOTENCY_CONFLICT', '冲突', 409), true),
    false,
  );
  assert.equal(revisionForkRejected(new ApiError('NETWORK_UNAVAILABLE', '网络', 0), true), false);
  assert.equal(revisionForkRejected(new ApiError('UNEXPECTED', '未知', 500), true), false);
  assert.equal(revisionForkRejected(new DOMException('Stopped', 'AbortError'), true), false);
});

test('successfully opening the new work clears its source receipt even after that dialog unmounts', async () => {
  const saved = storage(),
    value = frozen(),
    receipt = revisionForkReceipt(response(), value);
  persistRevisionFork(saved, value);
  completeRevisionFork(saved, value, receipt);
  let current = true,
    closes = 0;
  const result = await openRevisionForkResult(value, receipt, {
    storage: saved,
    isCurrent: () => current,
    onCreated: async () => {
      current = false;
      return true;
    },
    onClose: () => {
      closes++;
    },
  });
  assert.equal(result, 'opened');
  assert.equal(readRevisionFork(saved, actorId, artworkId), null);
  assert.equal(closes, 0, 'the old dialog cannot close a new view');
});

test('a dirty-draft cancellation or opening failure keeps the created receipt without another POST', async () => {
  const saved = storage(),
    value = frozen(),
    receipt = revisionForkReceipt(response(), value);
  persistRevisionFork(saved, value);
  completeRevisionFork(saved, value, receipt);
  const actions = {
    storage: saved,
    isCurrent: () => true,
    onCreated: async () => false,
    onClose: () => assert.fail('must not close'),
  };
  assert.equal(await openRevisionForkResult(value, receipt, actions), 'kept');
  assert.deepEqual(readRevisionFork(saved, actorId, artworkId)?.created, receipt);
  await assert.rejects(
    openRevisionForkResult(value, receipt, {
      ...actions,
      onCreated: async () => {
        throw new ApiError('ARTWORK_NOT_FOUND', '读取失败', 404);
      },
    }),
    /读取失败/,
  );
  assert.deepEqual(readRevisionFork(saved, actorId, artworkId)?.created, receipt);
});

test('late open success does not clear another request or cross an account boundary', async () => {
  const saved = storage(),
    value = frozen(),
    receipt = revisionForkReceipt(response(), value);
  persistRevisionFork(saved, value);
  completeRevisionFork(saved, value, receipt);
  let calls = 0;
  assert.equal(
    await openRevisionForkResult(value, receipt, {
      storage: saved,
      isCurrent: () => false,
      onCreated: () => {
        calls++;
      },
      onClose: () => {
        calls++;
      },
    }),
    'inactive',
  );
  assert.equal(calls, 0);
  await openRevisionForkResult(value, receipt, {
    storage: saved,
    isCurrent: () => true,
    onCreated: () => {
      clearRevisionFork(saved, value);
      persistRevisionFork(
        saved,
        freezeRevisionFork(input, () => id(9)),
      );
      return true;
    },
    onClose: () => {},
  });
  assert.equal(readRevisionFork(saved, actorId, artworkId)?.body.idempotencyKey, id(9));
});

test('render readiness binds saved revision/source and distinguishes unknown budget from unsupported output', () => {
  assert.equal(validateRevisionRenderInfo(renderInfo, reference), renderInfo);
  assert.equal(revisionRenderState(renderInfo), 'available');
  assert.equal(revisionRenderState({ ...renderInfo, budget: undefined }), 'unknown-budget');
  assert.equal(
    revisionRenderState({ ...renderInfo, estimatedWorkingBytes: undefined }),
    'unknown-budget',
  );
  assert.equal(
    revisionRenderState({ ...renderInfo, available: false, limits: ['SOURCE_RASTER_BUDGET'] }),
    'unsupported',
  );
  assert.equal(
    revisionRenderState({ ...renderInfo, estimatedWorkingBytes: 500 * 1024 * 1024 }),
    'unsupported',
  );
  assert.throws(
    () =>
      validateRevisionRenderInfo(
        { ...renderInfo, source: { ...renderInfo.source, assetId: id(99) } },
        reference,
      ),
    /所选版本/,
  );
  assert.throws(
    () => validateRevisionRenderInfo({ ...renderInfo, revisionId: id(99) }, reference),
    /所选版本/,
  );
  assert.throws(
    () => validateRevisionRenderInfo({ ...renderInfo, version: 8 }, reference),
    /所选版本/,
  );
});

test('PNG export uses the private exact-revision endpoint and checks response identity and dimensions', async () => {
  let calls = 0;
  const blob = await fetchRevisionPng(renderInfo, (async (url, init) => {
    calls++;
    assert.equal(url, `/v1/artworks/${artworkId}/revisions/${revisionId}/render`);
    assert.equal(init?.credentials, 'include');
    assert.equal(init?.method, undefined);
    return pngResponse();
  }) as typeof fetch);
  assert.equal(calls, 1);
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, png.byteLength);
  await assert.rejects(
    fetchRevisionPng(renderInfo, (async () =>
      pngResponse({ 'x-xiutu-revision': id(99) })) as typeof fetch),
    /版本标识不匹配/,
  );
  await assert.rejects(
    fetchRevisionPng({ ...renderInfo, output: { width: 2, height: 1 } }, (async () =>
      pngResponse()) as typeof fetch),
    /输出尺寸不匹配/,
  );
  await assert.rejects(
    fetchRevisionPng(
      renderInfo,
      (async () =>
        new Response('<html>login</html>', {
          headers: { 'content-type': 'text/html' },
        })) as typeof fetch,
    ),
    /内容或版本/,
  );
});

test('unverified budget and cancellation never start render, while server busy keeps the real error', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return pngResponse();
  }) as typeof fetch;
  await assert.rejects(fetchRevisionPng({ ...renderInfo, budget: undefined }, fetcher), /预算/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchRevisionPng(renderInfo, fetcher, controller.signal), {
    name: 'AbortError',
  });
  assert.equal(calls, 0);
  await assert.rejects(
    fetchRevisionPng(
      renderInfo,
      (async () =>
        new Response(
          JSON.stringify({
            error: { code: 'REVISION_RENDER_BUSY', message: '服务端版本渲染繁忙' },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        )) as typeof fetch,
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === 'REVISION_RENDER_BUSY' && error.status === 429,
  );
  await assert.rejects(
    fetchRevisionPng(renderInfo, (async () =>
      pngResponse({ 'content-length': String(129 * 1024 * 1024) })) as typeof fetch),
    /128 MiB/,
  );
});

test('a valid PNG header with truncated chunks, absent IEND or mismatched length is not a download', async () => {
  const headers = {
    'content-type': 'image/png',
    'x-xiutu-revision': revisionId,
    'x-xiutu-pixel-format': 'srgb-rgba8',
  };
  for (const bytes of [png.slice(0, 24), png.slice(0, -1), png.slice(0, -12)]) {
    await assert.rejects(
      fetchRevisionPng(renderInfo, (async () => new Response(bytes, { headers })) as typeof fetch),
      /结构不完整/,
    );
  }
  const broken = new Uint8Array(png);
  new DataView(broken.buffer).setUint32(33, 0x7fffffff);
  await assert.rejects(
    fetchRevisionPng(renderInfo, (async () => new Response(broken, { headers })) as typeof fetch),
    /结构不完整/,
  );
  await assert.rejects(
    fetchRevisionPng(
      renderInfo,
      (async () =>
        new Response(png, {
          headers: { ...headers, 'content-length': String(png.byteLength + 1) },
        })) as typeof fetch,
    ),
    /长度不完整/,
  );
  const blob = await fetchRevisionPng(
    renderInfo,
    (async () =>
      new Response(png, {
        headers: { ...headers, 'content-length': String(png.byteLength) },
      })) as typeof fetch,
  );
  assert.equal(blob.size, png.byteLength);
});
