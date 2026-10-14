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

Planning tools for shaping a PRD after it is created:

- `update_prd_section` (scope, risks, dependencies, technical requirements, acceptance criteria, rollout, measurement, ...), `add_decision`, `resolve_open_question`, `add_glossary_term`.
- `update_phase`, `delete_phase`, `reorder_phases`.
- A PRD `glossary` and per-story `testSeams`.
- `shape_prd` MCP prompt: a round-by-round interview that writes each decision into the PRD, then slices the work into thin stories and phases.
- `review_story` MCP prompt: checks a story's changes against its acceptance criteria, non-goals, out-of-scope items and test seams, and reports approve or send back.
- `check_plan`: a structured checklist of what a PRD is missing (`required` items block the build, `recommended` items improve it), each naming the section and stories involved. `get_improvement_suggestions` now uses it and also reports stories without test seams and, past five stories, stories outside a phase.
