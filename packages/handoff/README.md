# @makerkit/handoff

One result shape for commands and MCP tools that coding agents drive. Every run says:

- **status**: `done`, `failed`, `needs-human` or `refused` (exit codes 0, 1, 2, 3)
- **steps**: each with a stable `id`, a `state` (`done`, `todo`, `waiting`, `running`, `skipped`, `failed`), who acts (`agent` or `human`), and how to fix it
- **nextSteps**: what happens next, who does it, a link, and `resumeWith`, the command to run once it's done
- **summary**: plain English, for the agent to relay as is

Secrets never leave a run: `finish` and `toToolResult` mask every value you pass as a secret, wherever it appears.

## Use from a command

```ts
import { finish, humanStep } from '@makerkit/handoff/node';

finish({
  json: process.argv.includes('--json'),
  secrets: [process.env.STRIPE_SECRET_KEY ?? ''],
  result: {
    status: 'needs-human',
    steps: [{ id: 'portal', title: 'Customer portal', state: 'waiting', actor: 'human' }],
    nextSteps: [
      humanStep({
        instructions: 'Open the link and click "Save" once.',
        url: 'https://dashboard.stripe.com/test/settings/billing/portal',
        resumeWith: 'pnpm billing:setup --step portal --yes',
      }),
    ],
    summary: 'Billing is almost set up: one step needs you.',
  },
});
```

With `--json`, stdout holds exactly one JSON document; write prompts and progress to stderr.

## Use from an MCP tool

```ts
import { toToolResult } from '@makerkit/handoff/mcp';

return toToolResult({ result, secrets });
```

## Other languages

The contract ships as JSON Schema: `@makerkit/handoff/schema.json`.
