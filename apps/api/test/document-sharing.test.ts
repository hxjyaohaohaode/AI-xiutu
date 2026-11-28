import test from 'node:test';
import assert from 'node:assert/strict';
import { writeOfficeBlock } from '@ai-xiutu/contracts';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl && process.env.REQUIRE_DB_TESTS === '1') throw new Error('TEST_DATABASE_URL is required');

test(
  'document share links: policy gate, editor-only management, anonymous read-only view, expiry and revocation',
  { skip: !databaseUrl },
  async () => {
    const f = await collaborationFixture(databaseUrl!);
    try {
      const image = writeOfficeBlock({ kind: 'image', assetId: f.assetId, title: 'photo' });
      const created = await f.call('POST', `/v1/projects/${f.projectId}/documents`, {
        title: '对外方案',
        body: ['# 方案', '正文内容', image].join('\n'),
      });
      assert.equal(created.statusCode, 201);
      const doc = created.json().document;

      // The space policy is off by default: nobody can create a link.
      const blocked = await f.call('POST', `/v1/documents/${doc.id}/share-links`, { expiresInDays: 7, allowDownload: false });
      assert.equal(blocked.statusCode, 403);
      assert.equal(blocked.json().error.code, 'DOCUMENT_LINKS_DISABLED');
      const policy = (await f.call('GET', `/v1/spaces/${f.teamId}/sharing-policy`)).json().policy;
      assert.equal(
        (await f.call('PUT', `/v1/spaces/${f.teamId}/sharing-policy`, { ...policy, allowDocumentLinks: true })).statusCode,
        200,
      );

      // Sharing summary: members see who has access; only editors see and manage links.
      const summary = (await f.call('GET', `/v1/documents/${doc.id}/sharing`, undefined, 'viewer')).json();
      assert.equal(summary.canManage, false);
      assert.deepEqual(summary.links, []);
      assert.ok(summary.access.some((m: any) => m.role === 'owner' && m.access === 'edit'));
      assert.ok(summary.access.every((m: any) => !('phone' in m)));
      assert.equal((await f.call('GET', `/v1/documents/${doc.id}/sharing`, undefined, 'outsider')).statusCode, 404);
      assert.equal(
        (await f.call('POST', `/v1/documents/${doc.id}/share-links`, { expiresInDays: 7, allowDownload: false }, 'viewer')).statusCode,
        403,
      );
      assert.equal(
        (await f.call('POST', `/v1/documents/${doc.id}/share-links`, { expiresInDays: 3, allowDownload: false })).statusCode,
        400,
      );

      const made = await f.call('POST', `/v1/documents/${doc.id}/share-links`, { expiresInDays: 7, allowDownload: true }, 'editor');
      assert.equal(made.statusCode, 201);
      const { token, link } = made.json();
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      const stored = (await f.db.query('SELECT token_hash FROM document_share_links WHERE id=$1', [link.id])).rows[0];
      assert.notEqual(stored.token_hash, token);

      // Anonymous read: no cookie, only document content.
      const anonymous = await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${token}`, remoteAddress: '10.9.8.7' });
      assert.equal(anonymous.statusCode, 200);
      assert.equal(anonymous.headers['x-robots-tag'], 'noindex, nofollow');
      const shared = anonymous.json();
      assert.equal(shared.document.title, '对外方案');
      assert.equal(shared.allowDownload, true);
      assert.equal(JSON.stringify(shared).includes(f.actors.owner.id), false);
      // Embedded images are served through the link; other project assets are not.
      const picture = await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${token}/assets/${f.assetId}`, remoteAddress: '10.9.8.7' });
      assert.equal(picture.statusCode, 200);
      assert.match(String(picture.headers['content-type']), /^image\//);
      const other = await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${token}/assets/${f.privateAssetId}`, remoteAddress: '10.9.8.7' });
      assert.equal(other.statusCode, 404);
      // Anonymous writes stay impossible: no write route exists for shared tokens.
      const write = await f.app.inject({ method: 'PATCH', url: `/v1/shared/documents/${token}`, headers: { origin: f.origin }, payload: {} });
      assert.equal(write.statusCode, 404);
      const counted = (await f.call('GET', `/v1/documents/${doc.id}/sharing`)).json();
      assert.equal(counted.links[0].viewCount, 1);

      // Policy off again: existing links stop working immediately.
      await f.call('PUT', `/v1/spaces/${f.teamId}/sharing-policy`, { ...policy, allowDocumentLinks: false });
      assert.equal((await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${token}` })).statusCode, 404);
      await f.call('PUT', `/v1/spaces/${f.teamId}/sharing-policy`, { ...policy, allowDocumentLinks: true });
      assert.equal((await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${token}` })).statusCode, 200);

      // Expiry and revocation.
      await f.db.query("UPDATE document_share_links SET created_at = now() - interval '9 days', expires_at = now() - interval '1 day' WHERE id=$1", [link.id]);
      assert.equal((await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${token}` })).statusCode, 404);
      const second = (await f.call('POST', `/v1/documents/${doc.id}/share-links`, { expiresInDays: null, allowDownload: false })).json();
      assert.equal(second.link.expiresAt, null);
      assert.equal((await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${second.token}` })).json().allowDownload, false);
      assert.equal((await f.call('DELETE', `/v1/documents/${doc.id}/share-links/${second.link.id}`, undefined, 'viewer')).statusCode, 403);
      assert.equal((await f.call('DELETE', `/v1/documents/${doc.id}/share-links/${second.link.id}`)).statusCode, 200);
      assert.equal((await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${second.token}` })).statusCode, 404);
      assert.equal((await f.call('DELETE', `/v1/documents/${doc.id}/share-links/${second.link.id}`)).statusCode, 404);
      // Malformed and unknown tokens get the same answer.
      assert.equal((await f.app.inject({ method: 'GET', url: '/v1/shared/documents/short' })).statusCode, 404);
      assert.equal((await f.app.inject({ method: 'GET', url: `/v1/shared/documents/${'A'.repeat(43)}` })).statusCode, 404);
      const audits = await f.db.query("SELECT action FROM audit_entries WHERE target_id=$1 ORDER BY created_at", [doc.id]);
      assert.deepEqual(
        audits.rows.map((r) => r.action),
        ['document.share_link.create', 'document.share_link.create', 'document.share_link.revoke'],
      );
    } finally {
      await f.close();
    }
  },
);
