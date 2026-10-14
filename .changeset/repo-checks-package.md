---
'@makerkit/repo-checks': minor
---

Initial release: `run_checks` (typecheck, lint and format diagnostics from TypeScript, Oxlint, Oxfmt and Vitest output), script guidance tools and `deps_upgrade_advisor`, extracted from the Makerkit kits' MCP server. Works with pnpm, npm, yarn and bun; the script names, the script catalog and a tool name prefix are settings. Lines where the package manager echoes the command it runs (`> ...`) are no longer parsed as diagnostics.
