# @makerkit/repo-checks

Gives coding agents structured results from your project's own checks. Instead of reading pages of terminal output, an agent gets each error as file, line, rule and message.

- **run_checks**: runs your `typecheck`, `lint` and `format` scripts (or the fix scripts, or tests) and parses the output of TypeScript, Oxlint, Oxfmt and Vitest into diagnostics.
- **get_scripts / get_script_details / get_healthcheck_scripts**: lists your `package.json` scripts with what each one does, whether it changes files, and which ones to run after every change.
- **deps_upgrade_advisor**: groups outdated dependencies by risk (patch, minor, major) with the command to upgrade them (pnpm projects).

Works with pnpm, npm, yarn and bun (detected from your lockfile).

## Use from code

```ts
import { createRepoChecksServices } from '@makerkit/repo-checks/node';

const { runChecks } = createRepoChecksServices(process.cwd());
const result = await runChecks.run({ scripts: ['typecheck', 'lint'] });

for (const diagnostic of result.diagnostics) {
  console.log(`${diagnostic.file}:${diagnostic.line} ${diagnostic.message}`);
}
```

### Settings

```ts
createRepoChecksServices(root, {
  packageManager: 'pnpm', // default: detected from the lockfile
  scripts: { check: ['typecheck', 'lint'], fix: ['lint:fix'], test: 'test:unit' },
  catalog: {
    'db:reset': { description: 'Reset the local database', importance: 'high' },
  },
});
```

## Add the tools to an MCP server

Requires `@modelcontextprotocol/sdk`.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRepoChecksTools } from '@makerkit/repo-checks/mcp';
import { createRepoChecksServices } from '@makerkit/repo-checks/node';

const server = new McpServer({ name: 'repo-checks', version: '1.0.0' });

registerRepoChecksTools(server, createRepoChecksServices(process.cwd()));
```

Pass `{ prefix: 'my_' }` as a third argument to prefix the tool names.

## License

MIT
