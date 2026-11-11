import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const editorMcpNames = new Set(['describe_editor', 'search_resources', 'read_history']);
export const mcpSearchInput = z
  .object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(20),
  })
  .strict();
const mcpHistoryInput = z
  .object({
    sourceTurnId: z.uuid(),
    offset: z.number().int().min(0).max(1_000_000),
    limit: z.number().int().min(1).max(6000),
  })
  .strict();
const output = z.object({ value: z.unknown() }).strict();

/** The server lives within a single authorized turn. Tools share the same scope
 * checks as other Agent calls; there is no network URL or credential exposure. */
export async function openEditorMcp(context: {
  assertAccess(): Promise<void>;
  describe(): unknown;
  search?: (query: string, limit: number) => Promise<unknown>;
  history?: (sourceTurnId: string, offset: number, limit: number) => Promise<unknown>;
}) {
  const server = new McpServer({ name: 'xiutu-editor', version: '1.0.0' });
  const client = new Client({ name: 'xiutu-assistant', version: '1.0.0' });
  const wrap = async (read: () => unknown | Promise<unknown>) => {
    try {
      await context.assertAccess();
      const value = await read();
      await context.assertAccess();
      const text = JSON.stringify({ value });
      if (!text || text.length > 250_000) throw new Error('MCP_OUTPUT_LIMIT');
      return { content: [{ type: 'text' as const, text }], structuredContent: { value } };
    } catch {
      return {
        content: [{ type: 'text' as const, text: 'EDITOR_TOOL_UNAVAILABLE' }],
        isError: true,
      };
    }
  };
  server.registerTool(
    'describe_editor',
    {
      description: 'Describe the frozen editor capabilities and current recipe.',
      annotations: readOnly,
      inputSchema: z.object({}).strict(),
      outputSchema: output,
    },
    () => wrap(context.describe),
  );
  const search = context.search;
  if (search)
    server.registerTool(
      'search_resources',
      {
        description: 'Search only resources in the permitted spaces for the current turn.',
        annotations: readOnly,
        inputSchema: mcpSearchInput,
        outputSchema: output,
      },
      ({ query, limit }) => wrap(() => search(query, limit)),
    );
  const history = context.history;
  if (history)
    server.registerTool(
      'read_history',
      {
        description: 'Read an authorized range of a prior message in this conversation.',
        annotations: readOnly,
        inputSchema: mcpHistoryInput,
        outputSchema: output,
      },
      ({ sourceTurnId, offset, limit }) => wrap(() => history(sourceTurnId, offset, limit)),
    );
  const close = async () => {
    await client.close();
    await server.close();
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await context.assertAccess();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    await context.assertAccess();
    const names = new Set(tools.map(({ name }) => name));
    return {
      names,
      close,
      async call(name: string, args: Record<string, unknown>) {
        if (!names.has(name)) throw new Error('EDITOR_MCP_TOOL_UNAVAILABLE');
        const result = await client.callTool({ name, arguments: args });
        if (result.isError || !Object.hasOwn(result, 'structuredContent'))
          throw new Error('EDITOR_MCP_CALL_REJECTED');
        return output.parse(result.structuredContent).value;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
