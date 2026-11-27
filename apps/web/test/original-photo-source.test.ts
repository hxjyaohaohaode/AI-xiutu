import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PHOTO_MAX_BYTES } from '@ai-xiutu/editor';
import { getOriginalPhoto } from '../src/editor/original-photo-source.ts';

const digest = createHash('sha256').update('original').digest('hex');

test('original selection retains local file identity and fetches cloud originals only from the private asset route', async (t) => {
  const signal = new AbortController().signal;
  const file = new File(['original'], 'camera.jpg');
  const fetcher = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/v1/assets/project-photo/media/original');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal, signal);
    return new Response('original', { headers: { 'content-length': '8' } });
  });
  assert.equal(await getOriginalPhoto(file, null, file.name, signal), file);
  assert.equal(fetcher.mock.callCount(), 0);
  const cloud = await getOriginalPhoto(null, 'project-photo', 'camera.jpg', signal, digest);
  assert.equal(cloud.name, 'camera.jpg');
  assert.equal(await cloud.text(), 'original');
  assert.equal(fetcher.mock.callCount(), 1);
});

test('missing, oversized, revoked or incomplete originals cannot become edited original downloads', async (t) => {
  const signal = new AbortController().signal;
  const responses = [
    new Response(null, { status: 403 }),
    new Response('x'),
    new Response('x', { headers: { 'content-length': String(PHOTO_MAX_BYTES + 1) } }),
    new Response('x', { headers: { 'content-length': '2' } }),
    new Response('switched', { headers: { 'content-length': '8' } }),
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
  await assert.rejects(getOriginalPhoto(null, null, 'camera.jpg', signal));
  for (let i = 0; i < 5; i++) await assert.rejects(getOriginalPhoto(null, 'id', 'camera.jpg', signal, digest));
});
