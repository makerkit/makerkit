import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { checkKitToolsContract } from '../contract';
import { READ_ONLY_TOOL, registerKitTool, toolResult } from '../mcp';

function fakeServer() {
  const tools: {
    name: string;
    config: Record<string, unknown>;
    handler: (input: unknown) => Promise<unknown>;
  }[] = [];
  const server = {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      handler: (input: unknown) => Promise<unknown>,
    ) {
      tools.push({ name, config, handler });
    },
  } as unknown as McpServer;

  return { server, tools };
}

describe('registerKitTool', () => {
  it('registers a shared tool with its own schemas, read-only by default', async () => {
    const { server, tools } = fakeServer();
    const status = {
      connected: true,
      tool: 'void',
      migrations: { applied: 1, pending: 0, pending_names: [] },
    };

    registerKitTool(
      server,
      'kit_db_status',
      { description: 'db' },
      async () => status,
    );

    const [tool] = tools;

    expect(tool?.config.annotations).toEqual(READ_ONLY_TOOL);
    expect(
      checkKitToolsContract(
        tools.map((t) => ({
          name: t.name,
          inputSchema: t.config.inputSchema,
          outputSchema: t.config.outputSchema,
        })),
        { required: ['kit_db_status'] },
      ),
    ).toEqual([]);
    expect(await tool?.handler({})).toEqual(toolResult(status));
  });

  it('parses the input with the shared schema (defaults applied)', async () => {
    const { server, tools } = fakeServer();
    const seen: unknown[] = [];

    registerKitTool(
      server,
      'kit_db_seed',
      { description: 'seed' },
      async (input) => {
        seen.push(input);

        return { status: 'success', message: 'ok' };
      },
    );

    await tools[0]?.handler(undefined);

    expect(seen).toEqual([{ confirm: false }]);
  });
});
