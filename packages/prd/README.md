# @makerkit/prd

Structured product requirements documents (PRDs) stored as JSON files in `.prds/`, plus the tools to manage them from code or from a coding agent over MCP.

- **Format**: a typed `StructuredPRD` (stories, statuses, priorities, dependencies, phases, risks, decisions) with Zod schemas. Hand-written files are normalized on load. Text fields may use Markdown; list items (acceptance criteria, non-goals, ...) keep to inline Markdown, and raw HTML is not rendered.
- **Service**: create PRDs, add and update user stories, move stories through `not_started → research → in_progress → review → completed`, export markdown.
- **Completion gate**: a story can only be marked `completed` when the project's checks pass, so "done" means the code verifies.
- **MCP tools**: the same operations exposed to Claude Code, Codex, OpenCode or any MCP client.
- **Attachments**: files (mockups, screenshots, reference docs) live in a folder next to the PRD, `.prds/<prd name>/`, and links can be recorded too. Stories reference them by id, and `get_story` returns them with their paths.
- **Prompts**: `shape_prd` interviews you round by round (numbered questions, each with a recommended answer and its reason) and writes every decision into the PRD; `architect_prd` designs the shape all stories share (using the project's `architect` skill when it has one) and records it as an attachment the story agents build against; `implement_story` implements ready stories in sequence, with a single-story mode for parallel workers; `review_story` checks the result against the spec. The same text is exported (`shapePrdPrompt`, `architectPrdPrompt`, `implementStoryPrompt`, `reviewStoryPrompt`) for UIs and agents without MCP prompt support.

Pass `mode: "light"` to `shape_prd` for a shorter interview focused on scope, user-visible behaviour, and decisions that block stories. The default is `"detailed"`. In TypeScript, pass the mode as the third argument to `shapePrdPrompt`.

A PRD can have optional roadmap metadata in its top-level `roadmap` object. Set `order` (a non-negative integer), `criticality` (`critical`, `high`, `medium`, or `low`), and any of `plan`, `group`, and `section`. Supply it to `create_prd`, or patch it with `update_prd_section` using `section: "roadmap"`. Set a field to `null` in a patch to clear it. `list_prds` sorts explicit orders first, then higher criticality within each order. It returns the roadmap metadata with each PRD so clients can group the list.

## Install

```bash
pnpm add @makerkit/prd
```

## Usage

```ts
import { createPrdService } from '@makerkit/prd';
import { createNodePrdDeps } from '@makerkit/prd/node';

const prds = createPrdService(createNodePrdDeps(process.cwd()));

// To use a different directory, pass { prdsDir: "docs/prds" } as the second argument.

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
