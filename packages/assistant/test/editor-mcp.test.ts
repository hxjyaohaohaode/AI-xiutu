import assert from 'node:assert/strict';
import test from 'node:test';
import { openEditorMcp } from '../src/editor-mcp.js';

test('MCP negotiation registers only scoped tools and checks permissions again after a read', async () => {
  let active = true,
    reads = 0;
  const mcp = await openEditorMcp({
    async assertAccess() {
      if (!active) throw new Error('Private fixture');
    },
    describe: () => ({ version: 4 }),
    async search(query, limit) {
      reads++;
      if (query === 'revoked') active = false;
      return { query, limit };
    },
  });
  try {
    assert.deepEqual([...mcp.names].sort(), ['describe_editor', 'search_resources']);
    assert.deepEqual(await mcp.call('describe_editor', {}), { version: 4 });
    assert.deepEqual(await mcp.call('search_resources', { query: 'flowers', limit: 2 }), {
      query: 'flowers',
      limit: 2,
    });
    await assert.rejects(mcp.call('search_resources', { query: 'flowers', limit: 100 }), /MCP/);
    await assert.rejects(mcp.call('read_history', {}), /MCP/);
    await assert.rejects(mcp.call('search_resources', { query: 'revoked', limit: 2 }), /MCP/);
    assert.equal(reads, 2);
    await assert.rejects(mcp.call('describe_editor', {}), /MCP/);
  } finally {
    await mcp.close();
  }
});
