import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs the built command, so this checks what npm users will execute.
const BIN = fileURLToPath(new URL('../dist/bin.mjs', import.meta.url));

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function connect() {
  const root = await mkdtemp(join(tmpdir(), 'makerkit-prd-mcp-'));
  const client = new Client({ name: 'test', version: '1.0.0' });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [BIN, '--root', root],
    }),
  );

  cleanups.push(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });

  return { client, root };
}

describe('makerkit-prd-mcp', () => {
  it('serves the PRD tools and prompts', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();
    const { prompts } = await client.listPrompts();

    expect(tools).toHaveLength(30);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'add_attachment',
        'create_prd',
        'get_next_story',
        'update_prd_section',
      ]),
    );
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      'implement_story',
      'review_story',
      'shape_prd',
    ]);
  });

  it('writes PRDs into <root>/.prds', async () => {
    const { client, root } = await connect();

    const result = await client.callTool({
      name: 'create_prd',
      arguments: {
        title: 'Simple CRM',
        overview: 'Contacts and deals',
        problemStatement: 'Spreadsheets lose context',
        marketOpportunity: 'Internal tool',
        targetUsers: ['Founder'],
        solutionDescription: 'Contacts, deals and a pipeline',
        keyFeatures: ['Contacts'],
        successMetrics: ['Every deal has a next step'],
      },
    });

    expect(result.isError).toBeFalsy();

    const { filename } = result.structuredContent as { filename: string };
    const prd = JSON.parse(
      await readFile(join(root, '.prds', filename), 'utf8'),
    );

    expect(prd.introduction.title).toBe('Simple CRM');
  });

  it('returns tool errors instead of crashing', async () => {
    const { client } = await connect();

    const result = await client.callTool({
      name: 'get_prd',
      arguments: { filename: 'missing.json' },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('not found');
  });
});
