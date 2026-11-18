# @makerkit/prd-mcp

An MCP server for the structured PRDs in `.prds/` (format and rules: [`@makerkit/prd`](../prd)). It lets coding agents read and update PRDs and stories, follow the story workflow, and leave hand-off logs for the next story.

## Use with an agent

Claude Code:

```bash
claude mcp add prd -- npx -y @makerkit/prd-mcp
```

Any MCP client (stdio):

```json
{
  "mcpServers": {
    "prd": { "command": "pnpx", "args": ["-y", "@makerkit/prd-mcp"] }
  }
}
```

## Options

```
makerkit-prd-mcp [--root <dir>] [--prds-dir <dir>] [--check-root <dir>] [--check <script>]...
```

- `--root`: project directory (default: current directory).
- `--prds-dir`: dedicated PRD directory, absolute or relative to `--root` (default: `.prds`). Use the same path when launching Loop.
- `--check-root`: working tree for completion checks (default: `--root`). For parallel work, use the same `--root` across workers, give each worker its own worktree as `--check-root`, and invoke `implement_story` with `singleStory: true`.
- `--check`: a `package.json` script that must pass before a story can be marked completed. Repeat for several. Default: `typecheck` and `lint` (scripts the project does not have are skipped).

## License

MIT
