import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import { registerPRDTools } from '../mcp';
import { createPrdService } from '../prd.service';

// what a client discovers is what the handler accepts: a schema the SDK
// can't read (a refined object) is published as `{}`, and the client sends
// nothing
async function discoveredTools() {
  const server = new McpServer({ name: 'prd', version: '0.0.0' });
  const schemas = new Map<string, unknown>();
  const register = server.registerTool.bind(server);

  server.registerTool = ((name, config, handler) => {
    schemas.set(name, config.inputSchema);

    return register(name, config, handler);
  }) as typeof server.registerTool;

  registerPRDTools(
    server,
    createPrdService({
      rootPath: '/repo',
      readdir: async () => [],
      readFile: async () => '',
      writeFile: async () => {},
      mkdir: async () => {},
      unlink: async () => {},
      fileExists: async () => false,
      now: () => new Date('2026-11-21T00:00:00Z'),
      verifyCompletion: async () => ({
        passed: true,
        checks: [],
        errors: 0,
        warnings: 0,
        diagnostics: [],
        messages: [],
      }),
    }),
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const { tools } = await client.listTools();

  await client.close();

  return { tools, schemas };
}

// the keys the handler's parse accepts and requires (zod/v3, as the tools
// are written): a refined object's own shape
function requiredKeys(schema: unknown) {
  if (schema === undefined) {
    return { properties: [], required: [] };
  }

  const inner = schema instanceof z.ZodEffects ? schema.innerType() : schema;
  const shape: Record<string, z.ZodTypeAny> =
    inner instanceof z.ZodObject ? inner.shape : (inner as z.ZodRawShape);

  return {
    properties: Object.keys(shape).sort(),
    required: Object.keys(shape)
      .filter((key) => !shape[key]!.isOptional())
      .sort(),
  };
}

describe('published tool input schemas', () => {
  it("match each handler's schema, properties and required keys", async () => {
    const { tools, schemas } = await discoveredTools();

    for (const tool of tools) {
      const expected = requiredKeys(schemas.get(tool.name));

      expect({
        tool: tool.name,
        properties: Object.keys(tool.inputSchema.properties ?? {}).sort(),
        required: [...(tool.inputSchema.required ?? [])].sort(),
      }).toEqual({ tool: tool.name, ...expected });
    }
  });

  it('publish resolve_open_question with its filename and answer', async () => {
    const { tools } = await discoveredTools();
    const tool = tools.find(({ name }) => name === 'resolve_open_question');

    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['filename', 'answer']),
    );
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['questionId', 'question']),
    );
  });
});
