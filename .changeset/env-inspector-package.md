---
'@makerkit/env-inspector': minor
---

Initial release: environment variable tools for coding agents (`env_schema`, `env_read`, `env_update`, `env_raw_read`, `env_raw_write`), extracted from the Makerkit kits' MCP servers. Resolves which `.env` file each variable comes from per mode (Next.js order by default, Vite order as a preset), validates values against a variable model you pass in, and redacts secret values in tool output by default (`revealValues: true` turns this off). The apps, env files per mode, write targets, public prefixes and a tool name prefix are settings; only the configured `.env` file names can be read or written.

Compared with the kit version: multiline quoted values and `export KEY=` lines are parsed, `env_update` replaces assignments written with `export` or spaces before `=`, and `env_raw_write` keeps the current value of lines written back as `[REDACTED]`.
