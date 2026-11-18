# @makerkit/env-inspector

Lets coding agents check a project's environment variables without seeing secret values. For each mode (development, production, test) an agent gets every variable, the `.env` file its value comes from, the files it is overridden in, and which variables are missing or invalid.

- **Precedence**: resolves the value of each variable the way Next.js (default) or Vite loads `.env` files.
- **Validation**: checks values against a variable model you pass in (required, format, rules that depend on other variables). Without a model, every variable is still listed with its source file.
- **Redaction**: values of secret variables are returned as `[REDACTED]` by default.
- **Editing**: sets one variable in the right file, or reads and writes a whole `.env` file. Only the configured `.env` file names can be read or written.

Works with single-app projects and monorepos. Apps are not detected automatically: without the `apps` setting the project root is read as one app, and monorepos list their apps.

## Tools

| Tool | Does |
|---|---|
| `env_schema` | Lists the variables of the model by group: description, type, required, secret, dependencies. Contains no values. |
| `env_read` | Returns every variable of an app for a mode: value, source file, override chain, validation errors, dependency status. Required variables that no file sets are listed with source `MISSING`. |
| `env_update` | Sets one variable in one `.env` file, replacing its line or appending it. Without `file`, secrets go to the mode's `.local` file and other variables to the mode's committed file. |
| `env_raw_read` | Returns the content of one `.env` file. |
| `env_raw_write` | Replaces the content of one `.env` file. |

`registerEnvInspectorTools(server, service, { prefix, omit })`: `prefix` is prepended to every name (`'kit_'` gives `kit_env_read`); `omit` leaves tools out by unprefixed name, e.g. `['env_raw_write']` when agents must change env files one key at a time.

`mode` accepts the configured modes (default `development`). `file` accepts only the configured `.env` file names. `app` selects the app when more than one is configured (default: the first).

## Precedence

Files are listed from lowest to highest precedence. A file later in the list overrides the ones before it.

| Mode | Next.js (`NEXTJS_ENV_FILES`, default) | Vite (`VITE_ENV_FILES`) |
|---|---|---|
| development | `.env`, `.env.development`, `.env.local`, `.env.development.local` | `.env`, `.env.local`, `.env.development`, `.env.development.local` |
| production | `.env`, `.env.production`, `.env.local`, `.env.production.local` | `.env`, `.env.local`, `.env.production`, `.env.production.local` |
| test | `.env`, `.env.test`, `.env.test.local` | `.env`, `.env.local`, `.env.test`, `.env.test.local` |

Variables set in the shell or by the hosting platform are not read; only the files are.

In `env_read`:

- `source` is the file the effective value comes from.
- `isOverridden` is true when more than one definition exists, and `overrideChain` lists all of them, lowest precedence first.
- When one file defines a variable twice, the last definition in that file wins and validation fails with the line numbers. `source` ends with ` (conflict)` only when the duplicates are in the file the effective value comes from (the highest-precedence file that sets it).

Parsing follows dotenv:

- `#` comment lines and blank lines are skipped, and `export KEY=value` is accepted. A key is letters, digits, `_`, `.` and `-`; other lines are not assignments. LF and CRLF files read the same.
- An unquoted value is trimmed and ends at the first `#`, so `KEY=a#b` reads `a`.
- A value in `"`, `'` or `` ` `` is read whole, up to its closing quote, keeping spaces. A comment may follow it. Only double quotes unescape `\"` and `\\`. Single quotes, backticks and unquoted values are literal.
- A quoted value that does not close on its line continues until a line ending with the closing quote (for example a PEM key).

Writing (`env_update`, `setEnvValue`): a plain value is written unquoted. A value with `#`, quotes, a newline or leading or trailing spaces is written in the first of `'`, `"` and `` ` `` that reads it back exactly. Carriage returns, and values containing all three quotes, are refused: no dotenv loader would read them back. A file that would not read back as written (every other variable unchanged, the new value exact) is not written: for example, an unclosed quote a person left on another line would otherwise pull the lines below it into one value.

## Variable model

The model is an array of variables. Only `name` is required.

```ts
import type { EnvVariableModel } from '@makerkit/env-inspector';
import { z } from 'zod';

export const model: EnvVariableModel[] = [
  {
    name: 'DATABASE_URL',
    description: 'Postgres connection string',
    category: 'Database',
    required: true,
    secret: true,
    type: 'url',
    validate: ({ value }) => z.string().startsWith('postgres://').safeParse(value),
  },
  {
    name: 'STRIPE_SECRET_KEY',
    category: 'Billing',
    secret: true,
    contextualValidation: {
      dependencies: [
        {
          variable: 'BILLING_PROVIDER',
          condition: (value) => value === 'stripe',
          message: 'STRIPE_SECRET_KEY is required when BILLING_PROVIDER is "stripe"',
        },
      ],
      validate: ({ value }) => z.string().startsWith('sk_').safeParse(value),
    },
  },
];
```

| Field | Meaning |
|---|---|
| `name` | Variable name. |
| `displayName`, `description`, `hint`, `category` | Shown by `env_schema`. `category` defaults to `General`. |
| `type` | `string`, `longString`, `number`, `boolean`, `enum`, `url` or `email`. `values` lists the allowed values of an `enum`. |
| `required` | The variable is reported when missing or empty. |
| `secret` | Whether the value is redacted. See [Redaction](#redaction). |
| `validate({ value, variables, mode })` | Runs when the value is not empty. |
| `contextualValidation` | `validate` runs only when a dependency `condition` holds; a missing value is then reported with that dependency's `message`. With an empty `dependencies` array it always runs, also on a missing value. When no condition holds, the plain `validate` runs instead. |
| `deprecated` | `{ reason, alternative? }`, for your own use. |

Validators return `{ success: true }` or `{ success: false, error: { issues: [{ message }] } }`. A Zod `safeParse` result (v3 or v4) has this shape. `variables` holds the effective value of every variable, and `mode` is the mode being read.

Variables that are not in the model are listed with category `Custom` and are not validated.

## Redaction

With the default `revealValues: false`:

- **What counts as secret**: a variable is secret when its model entry has `secret: true`. A variable without a `secret` flag (or without a model entry) is secret unless its name starts with a public prefix: `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_` or `EXPO_PUBLIC_` (setting `publicPrefixes`). These are compiled into client code, so they are not secret. `secret: false` always shows the value.
- **`env_read`**: `value` and every `overrideChain[].value` of a secret variable are `[REDACTED]`, and the variable has `redacted: true`. Empty values stay `""` so missing values remain visible. `source`, `isOverridden`, validation results and dependency status are not changed. Validation runs on the real values. In every validation message, and in an error a validator or condition throws, the value of any secret variable of the app (4 characters or longer) and any part of one 8 characters or longer is replaced with `[REDACTED]`. Messages can lose harmless text this way (for example `https://` when a secret URL starts with it).
- **`env_raw_read`**: only blank lines and assignments of non-secret variables are returned as they are; a non-secret assignment with text after its value (`KEY=x # note`) becomes `KEY=[REDACTED]`. The value of each secret assignment is replaced, so `KEY=sk_live_123` becomes `KEY=[REDACTED]` (all lines of a multiline value; an empty value stays empty). Every other line, comments included (`# OLD KEY=sk_live_123`), becomes `# [REDACTED]:n`, n counting those lines from 1. `redactedKeys` lists the redacted variables.
- **`env_raw_write`**: a line whose value is exactly `[REDACTED]` keeps the value that variable has in the file now, and a `# [REDACTED]:n` line keeps the nth hidden line, so an agent can read a file, change one line and write it back without deleting secrets or comments. The write fails, writing nothing, when a variable or hidden line has nothing to keep, or when the result would not read back as the written content with the kept values.
- **`env_update`**: a value of `[REDACTED]` (bare or quoted) is rejected, so a value copied from a redacted read cannot replace a real secret.
- **Not redacted**: `env_schema` and `env_update` (their results contain no values), and the code APIs `getAppState()` and `getVariable()`, which return real values for your own code.

With `revealValues: true`, every value is returned as it is in the file, and `[REDACTED]` in `env_raw_write` is written literally.

Redaction only covers what these tools return. An agent with shell or file access can still read `.env` files directly.

## Use from code

```ts
import { createEnvInspectorService } from '@makerkit/env-inspector';
import { createEnvInspectorDeps } from '@makerkit/env-inspector/node';

const env = createEnvInspectorService(createEnvInspectorDeps(process.cwd()));

const { variables } = await env.read('production');

for (const variable of Object.values(variables)) {
  if (!variable.validation.valid) {
    console.log(variable.key, variable.source, variable.validation.errors);
  }
}
```

`getAppState(mode)` returns the full state of every configured app (all definitions with line numbers), and `getVariable(key, mode)` returns one effective value. `processEnvDefinitions`, `scanEnvFiles` and `parseEnvFile` are exported for use without the service.

### Settings

```ts
import { VITE_ENV_FILES } from '@makerkit/env-inspector';

createEnvInspectorDeps(root, {
  settings: {
    model, // default: [] (no validation)
    apps: [{ name: 'web', path: 'apps/web' }], // default: [{ name: 'app', path: '.' }]
    envFiles: VITE_ENV_FILES, // default: NEXTJS_ENV_FILES; the keys are the modes
    defaultMode: 'development', // default: development, or the first mode
    writeTargets: {
      // a mode without writeTargets uses .env.<mode>.local / .env.<mode> when
      // the mode loads it, else its last .local / committed file; a secret is
      // never sent to a committed file
      development: { secret: '.env.local', nonSecret: '.env.development' },
    },
    revealValues: false, // default
    publicPrefixes: ['NEXT_PUBLIC_'], // default: NEXT_PUBLIC_, VITE_, PUBLIC_, EXPO_PUBLIC_
  },
});
```

Files are written atomically (a temp file in the same directory, then a rename). An existing file keeps its permissions; a new file is created readable by its owner only (`0600`).

`env_update` without `file` writes to `writeTargets[mode].nonSecret` only when the model entry has `secret: false`. Every other variable, including unknown variables, public-prefixed variables and model entries without a `secret` flag, goes to `writeTargets[mode].secret`, which is usually gitignored.

The two rules differ on purpose. Redaction decides what an agent may see, so a public prefix is enough to show a value. Choosing the write file decides what may end up in a committed file, so only an explicit `secret: false` sends a value there.

`findWorkspaceRoot(startPath)` from `@makerkit/env-inspector/node` walks up at most 6 directories to a directory that contains `pnpm-workspace.yaml`, `lerna.json` or `nx.json`, or a `package.json` with `workspaces`, and returns `startPath` when it finds none. Pass `{ markers, maxDepth }` to change this.

## Add the tools to an MCP server

Requires `@modelcontextprotocol/sdk`.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEnvInspectorService } from '@makerkit/env-inspector';
import { registerEnvInspectorTools } from '@makerkit/env-inspector/mcp';
import { createEnvInspectorDeps } from '@makerkit/env-inspector/node';

const server = new McpServer({ name: 'env-inspector', version: '1.0.0' });

registerEnvInspectorTools(
  server,
  createEnvInspectorService(createEnvInspectorDeps(process.cwd(), { settings: { model } })),
);
```

Pass `{ prefix: 'my_' }` as a third argument to prefix the tool names. Error messages that suggest another tool use its prefixed name, and only when it is registered.

The package runs on Node.js: the root entry uses `node:path` to resolve app and file paths, even with your own `EnvInspectorDeps`.

## Changes

### 0.0.2

Behaviour changes from 0.0.1:

- Parsing: an unquoted `#` starts a comment, also without a space before it (`KEY=a#b` reads `a`), as dotenv reads it.
- Parsing: CRLF files read the same as LF files.
- Parsing: quoted values keep their leading and trailing spaces, end at their first closing quote, and backtick quotes are read (also across lines). Only double quotes unescape `\"` and `\\`; unquoted and single-quoted values are literal.
- Writing: values are quoted when they need it (see [Precedence](#precedence)), so a value reads back exactly, here and in dotenv (Vite, Next.js). A write that would change another variable, an invalid variable name, or a carriage return in a value is refused.
- Writing: a new variable is appended without a blank line before it, and the file keeps its line endings.
- Writing: files are replaced atomically; new files are created `0600`.
- Parsing: a key must be letters, digits, `_`, `.` or `-` (after an optional `export`); other lines containing `=` are no longer read as assignments.
- `env_raw_read` redacts every line that is not blank or a non-secret assignment, comments included, as `# [REDACTED]:n`, and non-secret assignments followed by a comment; `env_raw_write` restores them.
- Validation messages and thrown validator errors are scrubbed of every secret value of the app and of 8-character parts of them, not only the variable's own value.
- Modes without `writeTargets` write only to files the mode loads, and refuse to put a secret in a committed file.
- Error messages name the registered (prefixed) tool and do not suggest omitted tools. `EnvInspectorError` (exported) carries the suggestion for your own messages.
- The `zod` dependency range is now `^3.25.1 || ^4.0.0` (floor raised to 3.25.1).

## License

MIT
