---
'@makerkit/prd': minor
---

Initial release: the structured PRD format, `PrdService`, Node filesystem deps with a script-based completion gate, and MCP tools (`@makerkit/prd/mcp`). Extracted from the Makerkit kits' MCP server.

Adds an agent workflow on top of the kit version:

- `get_next_story`: the next story whose dependencies are completed, ordered by phase, priority and position.
- `get_story`: one story with the PRD's scope limits, its dependencies' hand-off logs and the previous story's log.
- `add_story_log`: hand-off entries (`whatsNew`, `technicalNotes`) stored on the story.
- `implement_story` MCP prompt.
- Stories cannot move to `in_progress`, `review` or `completed` before their dependencies are completed.
- Every save increments `metadata.revision`; a write based on an outdated read is rejected instead of overwriting the other change.
