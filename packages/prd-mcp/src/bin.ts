#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createPrdService } from '@makerkit/prd';
import { registerPRDTools } from '@makerkit/prd/mcp';
import { createNodePrdDeps, createScriptVerifier } from '@makerkit/prd/node';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `Usage: makerkit-prd-mcp [--root <dir>] [--check <script>]...

Serves the PRDs in <dir>/.prds over MCP (stdio).

  --root   Project directory. Defaults to the current directory.
  --check  package.json script that must pass before a story is completed.
           Repeat for several. Defaults to typecheck and lint.
`;

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    check: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const root = resolve(values.root ?? process.cwd());

const deps = createNodePrdDeps(root, {
  verifyCompletion: createScriptVerifier(root, values.check),
});

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

const server = new McpServer({ name: 'makerkit-prd', version });

registerPRDTools(server, createPrdService(deps));

await server.connect(new StdioServerTransport());
