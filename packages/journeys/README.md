# @makerkit/journeys

The engine behind a Makerkit kit's setup commands and MCP tools. A journey is a list of steps (check what's true, apply what's missing, or hand a step to the owner). One definition gives a terminal command, an MCP tool and a card in the Console, with the same confirm levels, resume commands, locks and results ([`@makerkit/handoff`](../handoff)) everywhere.

```ts
import { defineJourney, defineStep, done, todo } from '@makerkit/journeys';

export const envJourney = defineJourney<Deps>({
  id: 'env',
  title: 'apps/web/.env',
  command: 'kit:env',
  steps: [
    defineStep({
      id: 'file',
      title: 'Create apps/web/.env',
      check: async ({ deps }) => ((await deps.exists()) ? done() : todo('No .env yet')),
      apply: async ({ deps }) => deps.copyExample(),
    }),
  ],
});
```

## Entry points

- `@makerkit/journeys`:
  - **Defining journeys:** `defineJourney`, `defineStep`, `defineCheck`, and the results `done` / `todo` / `waiting` / `failed`.
  - **Background processes:** `defineProcessStep` for something that keeps running (a dev server, webhook forwarding). It writes a pid file and is stopped with `stopStep`.
  - **Running:** `runJourney` (check, plan, apply, one step or all), with `createFileLocks` / `NO_LOCKS`.
  - **Terminal commands:** `runCli` and `parseCliArgs` (`--check | --plan | --stop`, `--yes`, `--json`, `--step`, `--confirm`). The terminal prompter is `createTerminalPrompter`, and secrets typed there stay hidden.
  - **Doctor:** `createDoctorService` and `runDoctorCli` build `kit_doctor` / `pnpm kit:doctor`: the kit's environment checks, then every journey in scope (local, launch, prod), changing nothing. The environment checks are one journey with id `doctor` (its command, like `kit:doctor`, is what the owner reruns) and print no secrets.
  - **Schemas:** the tool input and output schemas.
- `@makerkit/journeys/mcp` (pass your own `McpServer`; the package doesn't depend on the MCP SDK):
  - `registerJourneyTools` registers `kit_<id>` per journey plus `kit_journeys`, which lists each journey's `form` when it has one (`{ save, read? }`: the kit's data tools behind a form a client like the Makerkit Console offers). A journey can't take a data tool's name: `@makerkit/kit-tools`' names, plus the kit's own in `reserved` (`['kit_env_']` covers a prefix).
  - `registerKitDoctorTool` registers `kit_doctor`; calls that arrive while a run is going share it, and a finished result is never reused (a check right after a change sees it). `checks` says what the kit's environment checks cover, for the tool's description.

## Confirm levels

- `run` (default): runs under `--yes`.
- `step`: local and destructive, so it needs `--confirm <id>` (MCP `confirm`).
- `terminal`: live or production, so only the owner's own terminal can run it.
- `none`: no confirmation.

## What stays in each kit

The journeys themselves, their outside effects (the CLIs, `.env`, ports), the doctor's environment journey, and the wiring (`cli.ts`, the MCP server).

## Adopting it in a kit

1. Add `@makerkit/journeys` next to `@makerkit/handoff` and `@makerkit/kit-tools`.
2. Write each step-by-step command as a journey in `src/journeys/<id>/`, with its outside effects behind a deps object that tests fake.
3. Write the kit's environment checks as one journey with id `doctor` and command `kit:doctor`, then call `createDoctorService({ environment, environmentDeps, journeys, depsFor })`.
4. In the MCP server, call `registerJourneyTools(server, { journeys, depsFor, locks: createFileLocks({ dir: '<root>/.makerkit/locks' }), reserved })` and `registerKitDoctorTool(server, doctor, { checks })`.
5. Add a CLI entry with `runCli` and `runDoctorCli` behind `pnpm kit:<id>` and `pnpm kit:doctor`, and gitignore `.makerkit/`.
6. Run `checkKitToolsContract` (`@makerkit/kit-tools`) in the kit's tests.
