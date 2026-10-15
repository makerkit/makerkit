# Externalizing the kits' Dev Tools and MCP server

Every Makerkit kit ships the same developer tooling: an MCP server (`@kit/mcp-server`, about 66 tools) and a Dev Tools app. Each kit has its own copy, which adds up to six copies of mostly the same code in customers' projects.

This plan moves that code into open-source `@makerkit/*` packages in this repo. Each package has to do two jobs:

1. **Be a free tool on its own.** It works in any project of its kind (any Postgres app, any pnpm repo, any `<locale>/<namespace>.json` setup) and is worth installing, writing about and showing in videos.
2. **Remove code from customer projects.** Each kit keeps a thin adapter that passes in kit-specific settings. The kits get smaller, and fixes ship as package updates instead of kit merges.

`@makerkit/prd` and `@makerkit/prd-mcp` are the first two, and the template for the rest.

## Where the kits stand (October 2026)

| Kit | MCP server | Dev Tools app |
|---|---|---|
| Next.js Supabase | `packages/mcp-server` | Next.js |
| TanStack Supabase | `packages/mcp-server` | none |
| Next.js Prisma / Drizzle | `tooling/mcp-server` | Next.js, plus an RBAC page |
| TanStack Prisma / Drizzle | `tooling/mcp-server` | TanStack Start, plus an RBAC page |

All six servers have the same 15 tool modules. How close they are, compared with the Next.js Supabase kit:

- **Identical in all six:** `prd-manager`, `deps-upgrade-advisor`. `run-checks` differs by 9 lines.
- **Nearly identical** (differences of about 50–70 lines, mostly paths and kit text): `scripts`, `prompts`, `translations`, `components`.
- **Shared engine, kit-specific data:** `env`. The engine files are identical; each kit's variable list differs.
- **Live database schema:** every kit reads it from Postgres (`information_schema`), so the logic is shared. The Supabase kits also parse their SQL schema files.
- **Specific to each family:** `dev`, `db`, `status`, `mailbox`, `prerequisites`. The two Supabase kits are near-identical to each other; the four Prisma/Drizzle kits use Docker Postgres instead of the Supabase CLI.
- **Migrations** differ by family: Supabase SQL migrations, Drizzle and Prisma.

## Package shape

Every package follows the shape of `@makerkit/prd`:

- `@makerkit/<name>`: the service. It takes its dependencies (filesystem, process runner, clock, database client) as arguments, has no MCP or Node imports, and is fully unit-tested.
- `@makerkit/<name>/node`: a function that builds those dependencies for Node, with config for paths and commands.
- `@makerkit/<name>/mcp`: `register<Name>Tools(server, service, options)`. The MCP SDK is an optional peer dependency.
- Packages for broad audiences also get a command (`npx @makerkit/<name>-mcp` or a bin in the package), so people outside Makerkit can add them to their agent in one line.

Rules:

- **Tool names stay stable in the kits.** Registration takes a `prefix` option. Packages use neutral names (`env_read`); the kit adapter passes `kit_` so existing tool names (`kit_env_read`) keep working in docs and prompts.
- **Settings, not forks.** Anything kit-specific (paths such as `apps/web/supabase`, script names, the env variable list, curated descriptions) is passed in as a setting. If a package needs an `if (makerkit)`, the setting is missing.
- **Tests move with the code.** The kit tests for a module move into the package. The kit keeps one integration test per adapter.
- **One release for all kits.** A package goes into all six kits in the same kit release, so no kit is left on its old copy.

## Packages

Scored on both goals: **Free tool** = how useful it is outside Makerkit; **Code removed** = how much it removes from customer projects.

| Package | Comes from | Free tool | Code removed | Effort |
|---|---|---|---|---|
| `@makerkit/prd` + `prd-mcp` (done) | prd-manager | High: PRDs for any agent | ~2,200 lines × 6 kits | Done |
| `@makerkit/repo-checks` | run-checks, scripts, deps-upgrade-advisor | High: structured typecheck, lint and format diagnostics for agents in any repo | ~1,800 lines × 6 | Low |
| `@makerkit/postgres-schema` | database (live introspection) | High: tables, columns, functions, enums and relationships for agents in any Postgres app | ~800–1,800 lines × 6 | Medium |
| `@makerkit/i18n` | translations | Medium: any next-intl/i18next JSON setup | ~1,500 lines × 6 | Low |
| `@makerkit/env-inspector` (name to confirm) | env | Medium–high: which `.env` file each value comes from, what is missing or invalid, without showing secrets to agents | ~2,500 lines × 6 | Medium |
| `@makerkit/mailpit` | mailbox | Medium: read local Mailpit email from an agent (auth flows, invites) | ~700 lines × 6 | Low |
| `@makerkit/migrations` | migrations | Medium: one tool for Supabase SQL, Drizzle and Prisma migrations | ~200–400 lines × 6 | Medium (three adapters) |
| `@makerkit/ui-catalog` | components | Low–medium: describe any shadcn-style UI package to agents | ~1,400 lines × 6 | Medium |

Package notes:

- **repo-checks.** Detects the package manager (pnpm, npm, yarn, bun). Parses tsc, oxlint and oxfmt output, and adds eslint and prettier parsers. The scripts catalog is a setting. `@makerkit/prd`'s default completion check switches to it, so non-kit users also get file-and-line diagnostics when a story fails its checks.
- **postgres-schema.** Introspection uses a `postgres` client passed in as a dependency. Parsing Supabase's SQL schema files is an optional source, enabled by the Supabase kits. The kits' map of files to topics (accounts, billing) becomes a setting.
- **env-inspector.** The engine (scanning the workspace, Next.js `.env` precedence, dev and production modes) is shared. The variable list is supplied by the user as a schema; each kit passes its own. The scanner's direct `fs` calls must be injected first. Values are never returned to agents unless asked for explicitly.
- **mailpit.** The Mailpit HTTP API, with the port and the "how to start it" hint as settings. Email template rendering (React Email registry) stays in the kits for now.

## On hold

- **`@makerkit/postgres-schema`** (decided Oct 15 2026): the database tools stay in the kits for now. The package stays in this repo, tested but unpublished and not rolled out. Bugs it found that also exist in the kits' copies (cross-schema and composite foreign keys, index column order, merged same-named enums, schema-file parsing missing functions) can be fixed in the kits directly.

## Kit adapter settings

Each kit registers the packages with `{ prefix: 'kit_' }` so its tool names stay the same. Per package:

| Package | Supabase kits (Next.js, TanStack) | Prisma/Drizzle kits (Next.js, TanStack) |
|---|---|---|
| `@makerkit/prd` | `createNodePrdDeps(root, { verifyCompletion: runChecks })` | same |
| `@makerkit/repo-checks` | kit script catalog (Supabase and Stripe scripts, Oxlint/Oxfmt wording); no prefix needed (`run_checks` etc. are unprefixed today) | same |
| `@makerkit/postgres-schema` (on hold) | `includeSchemas: ['public', 'kit']`, `schemaFiles: { dir: 'apps/web/supabase/schemas', topicMap, topics }`, `functionPurposes`; database URL from `supabase/config.toml` (kit `lib/supabase-config`) | `excludeTables: ['_prisma_migrations']` (Prisma); database URL from `DATABASE_URL`, default port 54333 |
| `@makerkit/i18n` | Next.js: `messagesDir: 'apps/web/i18n/messages'`; TanStack: `packages/i18n/src/messages` (this fixes tanstack-supabase, which pointed at a folder it does not have) | same split by framework |
| `@makerkit/env-inspector` | `model` (the kit's `model.ts`), `apps: [{ name: 'web', path: 'apps/web' }]`, `revealValues: true`; Next.js kits use `NEXTJS_ENV_FILES`, TanStack kits `VITE_ENV_FILES` (development and production only) | same; TanStack Prisma/Drizzle switch to `VITE_ENV_FILES` (they use the Next.js order today, which is wrong for Vite) |
| `@makerkit/mailpit` | `url` from `supabase/config.toml` (mailbox port, 54324), Supabase start hint; register with `statusTool: false` (the kits' `dev` tools already register `kit_mailbox_status`) | `startHint: 'Start local services with "pnpm compose:dev:up".'`, `docker: { composeFile: 'docker-compose.dev.yml', service: 'mailpit' }` |

Kit models should mark public variables that have no public prefix with `secret: false`; otherwise `env_schema` reports them as sensitive and agents see them redacted.

## What stays in the kits

- `dev`, `db`, `status`, `prerequisites`: they run kit scripts and know the kit variants. They can still be shared within each family later through an internal package, but they are not worth publishing.
- `prompts`: kit content.
- The components showcase and the RBAC page in Dev Tools.

## Dev Tools app

The Dev Tools app exists in three near-identical copies (Next.js Supabase, Next.js Prisma/Drizzle, TanStack Prisma/Drizzle).

- **Now:** each page becomes a thin shell over the package services above, so the logic lives in packages and the pages only render. This alone removes most of the app's non-UI code.
- **Later:** consider sharing the page components across kits. They depend on `@kit/ui`, so a published UI package would need its own shadcn components. Decide once the services are extracted.
- **Not planned:** a standalone published Dev Tools app. It would grow into kit management, which Makerkit Loop deliberately avoids.

## Order

1. **Done:** `@makerkit/prd`, `@makerkit/prd-mcp`. The Next.js Supabase kit is wired on `feat/makerkit-prd`.
2. **`@makerkit/repo-checks`**, then switch `@makerkit/prd`'s completion check to it.
3. **`@makerkit/postgres-schema`** and **`@makerkit/i18n`.**
4. **`@makerkit/env-inspector`** (after the name and the variable-list format are decided) and **`@makerkit/mailpit`.**
5. **`@makerkit/migrations`** and **`@makerkit/ui-catalog`**, if the earlier ones show demand.
6. **Kit rollout** for each batch of published packages:
   - Order: Next.js Supabase, TanStack Supabase, then the four Prisma/Drizzle kits.
   - Steps: adapter, delete the copied code, move tests, update the kit docs that list MCP tools.

Each package launch is also content: a page under `/tools` on makerkit.dev, a short video showing it in someone's agent, and an "inside the kit" section.

## Open decisions

- The env package name (`@makerkit/env-inspector` proposed).
- Whether the tool `prefix` defaults to none (packages) with `kit_` set by the kits (proposed).
- The first npm publish of `@makerkit/*` packages (needs the owner).
