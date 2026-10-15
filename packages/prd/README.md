# @makerkit/prd

Structured product requirements documents (PRDs) stored as JSON files in `.prds/`, plus the tools to manage them from code or from a coding agent over MCP.

- **Format**: a typed `StructuredPRD` (stories, statuses, priorities, dependencies, phases, risks, decisions) with Zod schemas. Hand-written files are normalized on load. Text fields may use Markdown; list items (acceptance criteria, non-goals, ...) keep to inline Markdown, and raw HTML is not rendered.
- **Service**: create PRDs, add and update user stories, move stories through `not_started → research → in_progress → review → completed`, export markdown.
- **Completion gate**: a story can only be marked `completed` when the project's checks pass, so "done" means the code verifies.
- **MCP tools**: the same operations exposed to Claude Code, Codex, OpenCode or any MCP client.
- **Attachments**: files (mockups, screenshots, reference docs) live in a folder next to the PRD, `.prds/<prd name>/`, and links can be recorded too. Stories reference them by id, and `get_story` returns them with their paths.
- **Prompts**: `shape_prd` interviews you round by round (numbered questions, each with a recommended answer and its reason) and writes every decision into the PRD; `implement_story` walks an agent through one story and its hand-off log. The same text is exported (`implementStoryPrompt`, `shapePrdPrompt`, `reviewStoryPrompt`) for UIs and agents without MCP prompt support.

## Install

```bash
pnpm add @makerkit/prd
```

## Usage

```ts
import { createPrdService } from '@makerkit/prd';
import { createNodePrdDeps } from '@makerkit/prd/node';

const prds = createPrdService(createNodePrdDeps(process.cwd()));

const { prds: list } = await prds.list();
```

By default, completing a story runs the project's `typecheck` and `lint` scripts with its package manager (scripts that do not exist are skipped). Pass your own check instead:

```ts
createNodePrdDeps(root, {
  verifyCompletion: async () => ({
    passed: true,
    checks: ['custom'],
    errors: 0,
    warnings: 0,
    diagnostics: [],
    messages: [],
  }),
});
```

### MCP

Requires `@modelcontextprotocol/sdk`.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPrdService } from '@makerkit/prd';
import { registerPRDTools } from '@makerkit/prd/mcp';
import { createNodePrdDeps } from '@makerkit/prd/node';

const server = new McpServer({ name: 'prd', version: '1.0.0' });

registerPRDTools(server, createPrdService(createNodePrdDeps()));
```

## Credits

The `shape_prd` interview and the story-slicing rules are adapted from ideas in Matt Pocock's [skills](https://github.com/mattpocock/skills) (MIT), in particular grilling and to-tickets.

## License

MIT
