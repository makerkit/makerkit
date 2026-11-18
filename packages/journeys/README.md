# @makerkit/journeys

The engine behind a Makerkit kit's setup commands and MCP tools. A journey is a list of steps (check what's true, apply what's missing, or hand a step to the owner). One definition gives a terminal command, an MCP tool and a card in the Console, with the same confirm levels, resume commands, locks and results ([`@makerkit/handoff`](../handoff)) everywhere.

```ts
import { defineJourney, defineStep, done, todo } from '@makerkit/journeys';

export const envJourney = defineJourney<Deps>({
  id: 'env',
  title: 'Your settings file',
  command: 'kit:env',
  steps: [
    defineStep({
      id: 'file',
      title: 'Create .env',
      check: async ({ deps }) => ((await deps.exists()) ? done() : todo('No .env yet')),
      apply: async ({ deps }) => deps.copyExample(),
    }),
  ],
});
```

## Entry points

- `@makerkit/journeys` (no Node built-ins: safe in a browser or a Worker):
  - **Defining journeys:** `defineJourney`, `defineStep`, `defineCheck`, and the results `done` / `todo` / `waiting` / `failed`.
  - **Running:** `runJourney` (check, plan, apply, one step or all), `stopStep` (ends a process step), `NO_LOCKS`, and `handoff` / `refused` for a kit's own results.
  - **Doctor:** `createDoctorService` builds `kit_doctor` / `pnpm kit:doctor`: the kit's environment checks, then every journey in scope, changing nothing. The environment checks are one journey with id `doctor` (its command, like `kit:doctor`, is what the owner reruns) and print no secrets. A journey that throws (its deps, secrets or `finalize`) shows as one failed step, `<id>.journey`; the others still report.
  - **Naming the fix:** a check result (`done`/`todo`/`waiting`/`failed`, and their extras) can carry `journey`, the id of the journey whose form or run fixes it (the brand journey for "your product's name"). It is copied to the step in `kit_doctor` and `kit_<journey>` results, so a client can open that journey's form; older clients ignore it.
  - **Schemas and types:** the tool input and output schemas, `JourneyInfo` (one entry of `kit_journeys`), `toolNameOf`, `JOURNEY_SCOPES`.
- `@makerkit/journeys/node` (everything above, plus what needs Node):
  - **Locks:** `createFileLocks({ dir })` (`FileLocksOptions`).
  - **Background processes:** `defineProcessStep` (`ProcessStepOptions`) for something that keeps running (a dev server, webhook forwarding), with `createSystemProcesses`. It writes a pid file, is stopped with `stopStep`, and is stopped again when it isn't ready in time.
  - **Terminal commands:** `runCli` and `parseCliArgs` (`--check | --plan | --stop`, `--yes`, `--json`, `--step <id>`, `--confirm`), and `runDoctorCli` (`--<scope>`, `--json`). The terminal prompter is `createTerminalPrompter`: secrets typed there stay hidden, and Ctrl-C at a question answers no.
- `@makerkit/journeys/mcp` (pass your own `McpServer`; the package doesn't depend on the MCP SDK, and this entry uses no Node built-ins):
  - `registerJourneyTools` registers `kit_<id>` per journey plus `kit_journeys`, which lists each journey's `form` when it has one (`{ save, read? }`: the kit's data tools behind a form a client like the Makerkit Console offers). A step can declare an `input` (`{ env, label, secret, accept }`), listed by `kit_journeys`: a value a client may collect for it, saved with the kit's env tool, whose `accept` (a RegExp source) the kit applies. A journey can't take a data tool's name: `@makerkit/kit-tools`' names, plus the kit's own in `reserved` (`['kit_env_']` covers a prefix). Two journeys whose ids give one tool name (`a-b`, `a_b`) throw.
  - `registerKitDoctorTool` registers `kit_doctor`; calls that arrive while a run is going share it, and a finished result is never reused (a check right after a change sees it). `checks` says what the kit's environment checks cover, for the tool's description.
- `@makerkit/journeys/testing`: `createFakeMcpServer()`, a stand-in server that records each registered tool and checks every result against its output schema. `createFakeMcpServer<McpServer>()` types `server` as the SDK's server.

## Runner

Commands handed to the owner (`resumeWith`, fixes, `kit_journeys`' `command`) start with the runner, `pnpm` by default. Set it once per entry point: `runner` in `registerJourneyTools`, `createDoctorService` and `runCli` (or `RunInput.runner` when calling `runJourney` directly), e.g. `'npm run'`.

## Scopes

A journey's `scope` is a non-empty id, `local` by default. Well known: `local` (this computer), `launch` (before going live; the doctor's launch run includes local), `prod` (the deployed app). A kit can add its own, like `staging`: the doctor then runs it with `scope: 'staging'` over MCP and `--staging` in a terminal, covering only that scope's journeys. A scope nothing declares is refused.

## Platforms

macOS and Linux. Locks name their owner by pid and start time (`/proc` or `ps`); where no start time can be read (Windows), a live pid holds its lock. Process steps rely on Unix process groups and signals, so they are Unix-only.

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
4. In the MCP server, call `registerJourneyTools(server, { journeys, depsFor, locks: createFileLocks({ dir: '<root>/.makerkit/locks' }), reserved })` (`createFileLocks` from `/node`) and `registerKitDoctorTool(server, doctor, { checks })`.
5. Add a CLI entry with `runCli` and `runDoctorCli` (`/node`) behind `pnpm kit:<id>` and `pnpm kit:doctor`, and gitignore `.makerkit/`.
6. Run `checkKitToolsContract` (`@makerkit/kit-tools`) in the kit's tests.
