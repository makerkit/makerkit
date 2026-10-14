# Makerkit

This repository contains Open Source code used in the [Makerkit](https://makerkit.dev) SaaS Starter Kits.

This is a pnpm + Turborepo monorepo. Releases are managed with [Changesets](https://github.com/changesets/changesets).

## Packages

Packages are published to the [Makerkit NPM Organization](https://www.npmjs.com/org/makerkit).

You'll find the packages under the `packages` directory.

Currently, the following packages are available:

1. [Core Data Loader SDK for Supabase](https://github.com/makerkit/makerkit/tree/main/packages/data-loader/supabase/core)
2. [Next.js Data Loader SDK for Supabase](https://github.com/makerkit/makerkit/tree/main/packages/data-loader/supabase/nextjs)
3. [Remix Data Loader SDK for Supabase](https://github.com/makerkit/makerkit/tree/main/packages/data-loader/supabase/remix)
4. [QStash Task Queue](https://github.com/makerkit/makerkit/tree/main/packages/qstash)

## Development

```bash
pnpm install
pnpm build       # build all packages into their dist/ folders
pnpm typecheck
pnpm test        # requires local Supabase: pnpm supabase:start
```

## Releasing

```bash
pnpm changeset          # describe the change
pnpm version-packages   # bump versions and changelogs
pnpm release            # build and publish (each package publishes from its dist/)
```

## License

MIT. Versions published before the MIT relicense were released under AGPL-3.0.
