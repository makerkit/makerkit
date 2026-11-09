import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { defineJourney, defineStep, done, todo } from '../define';
import { NO_LOCKS as freeLocks } from '../locks';
import { registerJourneyTools } from '../mcp';

// the real SDK: input and output schemas (zod v4, the handoff contract) are
// accepted and the structured result validates on the client
describe('journey tools over the real MCP SDK', () => {
  it('lists, checks and applies a journey end to end', async () => {
    const state = { done: false };
    const server = new McpServer({ name: 'test', version: '0' });

    registerJourneyTools(server, {
      journeys: [
        defineJourney({
          id: 'setup',
          title: 'Set up',
          command: 'kit:setup',
          steps: [
            defineStep<typeof state>({
              id: 'env',
              title: 'Create .env',
              check: async ({ deps }) => (deps.done ? done() : todo('missing')),
              apply: async ({ deps }) => {
                deps.done = true;
              },
            }),
          ],
        }),
      ],
      depsFor: () => state,
      locks: freeLocks,
    });

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'console', version: '0' });

    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual(['kit_setup', 'kit_journeys']);
    expect(tools[0]?.outputSchema).toBeDefined();

    const checked = await client.callTool({ name: 'kit_setup', arguments: {} });

    expect(checked.structuredContent).toMatchObject({
      status: 'done',
      steps: [{ id: 'env', state: 'todo' }],
    });

    const applied = await client.callTool({
      name: 'kit_setup',
      arguments: { mode: 'apply' },
    });

    expect(applied.structuredContent).toMatchObject({
      status: 'done',
      steps: [{ id: 'env', state: 'done' }],
    });
    expect(state.done).toBe(true);

    await client.close();
  });
});

describe('progress over the real MCP SDK', () => {
  it('delivers a progress notification for each step applied', async () => {
    const applied = new Set<string>();
    const step = (id: string) =>
      defineStep<null>({
        id,
        title: `Step ${id}`,
        check: async () => (applied.has(id) ? done() : todo('no')),
        apply: async () => {
          applied.add(id);
        },
      });
    const server = new McpServer({ name: 'test', version: '0' });

    registerJourneyTools(server, {
      journeys: [
        defineJourney({
          id: 'setup',
          title: 'Set up',
          command: 'kit:setup',
          steps: [step('a'), step('b')],
        }),
      ],
      depsFor: () => null,
      locks: freeLocks,
    });

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'console', version: '0' });

    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const progress: unknown[] = [];

    await client.callTool(
      { name: 'kit_setup', arguments: { mode: 'apply' } },
      undefined,
      { onprogress: (p) => progress.push(p) },
    );

    expect(progress).toEqual([
      { progress: 0, total: 2, message: 'Step a' },
      { progress: 1, total: 2, message: 'Step b' },
    ]);
  });
});
