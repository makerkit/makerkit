import { attachmentProjectPath } from './attachment-paths';

/**
 * The instructions behind the MCP prompts, exported so other tools (e.g. a
 * UI that shows what to ask the agent) give exactly the same text.
 */

export function shapePrdPrompt(
  overview?: string,
  filename?: string,
  mode: 'light' | 'detailed' = 'detailed',
  prdsPath = '.prds',
) {
  const light = mode === 'light';
  const start = filename
    ? `Keep shaping the PRD "${filename}". Read it with get_prd first. Preserve existing decisions and focus on unresolved questions relevant to this interview mode.`
    : overview
      ? `What the user wants to build:\n\n${overview}\n\nTreat this as the starting point: do not ask again what it already answers.`
      : 'Start by asking the user to describe what they want to build, in their own words: what it is, who it is for and what it should do.';

  return [
    `We are shaping a product requirements document before any code is written. ${start}`,
    light ? 'Interview mode: light.' : 'Interview mode: detailed.',
    '',
    'How to run the interview:',
    '- Think of the plan as a tree of decisions. In each round, ask only the questions whose prerequisites are already decided. Keep each round small.',
    "- Use the harness's built-in question tool whenever it is available for the current session. For a choice, put the recommended option first, label it as recommended, and give a one-line reason. Offer only meaningful alternatives and let the user enter their own answer if the tool supports it. Use free text for open-ended questions.",
    '- If the question tool is unavailable or cannot express the question, ask in chat. Number the questions and give a recommended answer with a one-line reason wherever there is a decision to make, so the user can accept it with "yes" or give their own answer.',
    '- Look up facts yourself (the codebase, existing PRDs, docs) instead of asking. Only decisions go to the user.',
    '- PRD text may use Markdown. Keep list items (criteria, non-goals, open questions) to one line of inline Markdown: bold, code, links. No raw HTML.',
    '- Before the first round, read CLAUDE.md, AGENTS.md and package.json to learn the stack and whether the project starts from a kit or starter. Do not plan stories for what it already provides (e.g. sign-in, billing, teams); add those to assumptions instead (update_prd_section replaces the list, so pass the existing items too).',
    '- After each round, record what was decided before asking the next round.',
    '- When the decisions needed to define the stories are settled, confirm the scope with the user and slice the work. Record non-blocking questions for later. Keep decisions that define story behaviour in the interview.',
    '',
    'Pick the template yourself instead of asking the user. Call list_templates, choose one whose when_to_use fits, and pass it to create_prd. If none fits, create the PRD without one.',
    "The template adds default open questions and quality standards. Right after create_prd, resolve each default question the overview, the conversation or the project's conventions already answer (resolve_open_question, with that answer), and do not ask it again. Replace a default standard that contradicts the project's documented approach (e.g. how it isolates tenants) with update_prd_section.",
    '',
    ...(light
      ? [
          'Keep the interview brief. Use the overview, existing PRD, and repository conventions to draft a first pass. Ask only about unresolved choices that materially affect scope, user-visible behaviour, or whether a story can be built safely. Use the template’s interview_focus to spot those choices.',
          'Confirm who it is for, the main workflow, what counts as success, and what is out of scope. Call create_prd once the goal is clear. Draft testable acceptance criteria and confirm any ambiguity that changes them.',
          'Cover the failure cases and access rules that matter for these stories. Record decided edge cases and permissions in the PRD. Ask about blockers involving permissions, sensitive data, outside services, or irreversible behaviour when the answer cannot be inferred. Carry forward existing decisions and record unresolved non-blocking questions for later.',
          'Skip dedicated rounds for glossary, provider comparisons, detailed design, risk analysis, metrics, and rollout unless one of those topics blocks a story. Use established conventions where they apply. Reserve mark_not_applicable for sections that genuinely do not apply.',
        ]
      : [
          'Cover the template’s interview_focus questions in the rounds.',
          'Order of the rounds, broad to detailed:',
          '1. What we are building and for whom (create_prd once this is clear, if there is no PRD yet).',
          '2. Main features, then what we are explicitly NOT building (update_prd_section with nonGoals and outOfScope). Be explicit: anything unlisted is likely to be invented later.',
          '3. Whether this is an internal tool or a product for many customers or tenants. It changes what should be configurable versus hard-coded.',
          '4. The main entities and the words for them (add_glossary_term, including words to avoid). Describe each entity, what it holds and how it relates to the others in plain language, e.g. "Bookmark: a saved link. Belongs to one account; has many tags." Record them with update_prd_section, section "technicalContracts", value { dataModels: [...] }. The list replaces the previous one, so always pass every entity.',
          '5. Outside services (email, payments, storage, AI, SMS, maps...): for each feature that needs one, recommend a provider and list the credentials or environment variables the user must get. Record them with update_prd_section, section "technicalRequirements", value { integrationNeeds: [...] }, one entry per service, e.g. "Payments: Stripe. Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET." The list replaces the previous one, so always pass every service.',
          '6. For each feature: what is in and out of scope, and what a person must be able to do (acceptance criteria).',
          '7. What can go wrong. Take an adversarial view: assume users make mistakes, data is messy, networks and outside services fail, and two people act at once. Go through each feature and find the failure modes before the user has to think of them: missing or invalid input, empty and very large data, partial success and retries, duplicates and double submits, concurrent edits, someone’s role or membership changing while their request is in flight, lists growing far past one page, time zones and dates, limits and quotas, outside services failing or slow, deleting and undoing. For each one, recommend what should happen. Record them with update_prd_section, section "edgeCases", value [{ case, expectedBehavior, status, storyIds }]: "decided" once the user agreed, "open" while it needs an answer. The list replaces the previous one, so always pass every case. Do not slice the work while any edge case is open.',
          '8. Security. Switch to an attacker\'s mindset: for each feature, ask how a malicious user, a curious user of another account or tenant, or a compromised integration would abuse it, and assume they will try. Probe at least: changing ids in URLs and requests to reach other people\'s data; acting above one\'s role, including right after being demoted or removed while a request or a queued job acting for them is still in flight; hostile input (SQL, HTML and script, prompt injection into AI features, path traversal, oversized payloads); hostile file uploads; forged or replayed webhooks; brute force and account or email enumeration; abuse of costly actions (spam, quotas, paid APIs); secrets reaching the browser, logs or error messages; server requests to user-supplied URLs. Recommend a defence for each one that applies, then record: who can see and change what in update_prd_section "technicalContracts" { permissions: [...] }; sensitive data and legal duties (personal data, payments, retention, deletion) in "technicalRequirements" { complianceRequirements: [...] }; the standing rules that prevent abuse in "securityConsiderations"; and each concrete attack as an edge case with the safe behaviour (e.g. "User opens another account\'s invoice by changing the id" -> "404, nothing about it is revealed"). These lists replace the previous ones, so pass every item.',
          '9. Risks. Run a pre-mortem: assume the feature shipped and failed badly six months later, and work out why (data loss, a security incident, cost running away, an outside dependency changing, nobody using it, legal trouble, the team unable to maintain it). Record specific risks, not generic ones, with severity, mitigation and owner via update_prd_section "risks".',
          '10. Design: how it should look and feel. Ask for or suggest standing rules (which components and layout to use, tone of copy, mobile, how empty, loading and error states look) and record them with update_prd_section, section "designGuidance". Save mockups as attachments. Record individual design choices with add_decision and a topic starting with "design:", e.g. "design:navigation".',
          '11. Hard-to-reverse choices (add_decision). A question the user cannot answer now goes to update_prd_section "openQuestions" as { question, why, options, recommended, storyIds }: why says what goes wrong if an agent guesses, options are the real choices, recommended is your suggestion, and storyIds are the stories it blocks. Write it so a person can answer it later without this conversation. Keep the ids of existing questions (the list replaces the previous one). Answers are recorded with resolve_open_question.',
          '12. If a part genuinely does not apply (no outside services; no rollout plan for an internal tool), mark it with mark_not_applicable and a reason instead of leaving it empty. Never mark security or edge cases as not applicable for a feature that takes input from people or stores their data.',
        ]),
    '',
    'Then slice the work:',
    '- Each story is one commit: a small, self-contained change that leaves the build passing and is tested, and that a reviewer can read in a few minutes. Aim for one behaviour per story, usually a handful of files and one or two test seams. A story does not have to be something a person can try on its own; the phase is.',
    '- Size stories small. Split one that has more than three or four acceptance criteria, covers several screens, endpoints or roles, or needs "and" in its title. More small stories are better than a few broad ones. Still slice vertically where you can (one field end to end, not every field in one layer), and put refactoring needed by later stories in its own earlier story.',
    '- But not smaller than one behaviour. A story must change what the system does in a way a test can check through a seam: "a member can archive a project and it disappears from the list", not "add an archive button". A button, field, route, migration or config change on its own is a task, not a story: fold it into the story whose behaviour needs it. Merge stories whose acceptance criteria only describe what is on the screen, or that cannot be tested without the next story.',
    '- Create the phases first (create_custom_phase), in the order they should be built. Each phase should end with something a person can try (a page in the app, an API call, a command); say what in its description, and the demo data that shows each state, time-dependent ones included (overdue, in progress), so it can be shown again on a later day.',
    '- Add each story with add_user_story in one call: testSeams (the public entry points the tests will exercise), dependencies (stories that must be completed first) and phaseId. Add designNotes when the story has a screen or states the PRD design guidance does not settle, and securityNotes for each way this story in particular could be abused (whose ids it accepts, what input it trusts, what it costs to repeat) with the defence. Do not repeat the PRD-wide guidance or considerations there.',
    '- Give each acceptance criterion a proof (proofs): the lowest seam a test can assert it at (unit, integration, then e2e only when no lower seam can, with the reason). For judgment that can be written down (tone, clarity, layout), use judge with a rubric of checkable points; the reviewing agent scores it. A hard test is a reason to test lower or fake the dependency, not to skip the test. Use manual or post-deploy only when the truth lives outside the test environment (the real behaviour of a third party, production-only conditions such as DNS or scale, human judgment of look and copy); give the reason, and in fallback the strongest automated check still made.',
    '- A rule that holds only if two requests never interleave (no double booking, one approval wins, a limit, a permission revoked mid-request) needs a proof on the real database engine with two connections: an in-memory or single-connection test database runs them one after another and passes with or without the lock.',
    '- Use the checks and generators the project documents (its AGENTS.md or CLAUDE.md verification steps, its scaffolding for pages, lists and tests) in the proofs, so a story meets the same bar as work done without a PRD.',
    '- In the proposed breakdown, show which story IDs can run together in each group. Group stories with no direct or transitive dependency on each other and little likely overlap in files, migrations, or shared contracts. Say which prerequisites must land before each group can start.',
    `- When the user shares mockups, screenshots or reference docs, save each file in "${prdsPath}/<prd file name without .json>/" and record it with add_attachment, linking the stories that use it. Record links to outside docs with a url instead.`,
    '- Run check_plan after slicing. Fix required gaps you can resolve from existing decisions and ask the user about missing decisions. Link deferred questions and edge cases to the stories they affect. Present the breakdown and any remaining recommended items for confirmation, then apply feedback and rerun check_plan.',
    '- When the breakdown is confirmed, tell the user the next step is the architect_prd prompt, which designs the shape all the stories share before any of them is built.',
  ].join('\n');
}

export function architectPrdPrompt(filename: string, prdsPath?: string) {
  const designPath = attachmentProjectPath(
    filename,
    'architecture.md',
    prdsPath,
  );

  return [
    `Design how the PRD "${filename}" gets built, before any story is coded: the data model, the modules and who owns which rule, the entry points and the test seams all stories share. Without it, each story's agent invents its own shape.`,
    '',
    '1. Call get_prd and check_plan. For a new design or redesign, resolve required items and blocking decisions before designing the affected behaviour. If existing design records may be incomplete, inspect them in step 2 first so you can distinguish missing records from missing decisions.',
    '2. If the "Architecture" attachment or architecture.md already exists, read it and compare it with the PRD. Check the attachment links, technical contracts, accepted architecture decision, story test seams and proofs, dependencies, and recommended parallel groups against the design. If a previous run stopped midway, resume the missing parts of steps 4–9 without duplicating records. Handle newly added stories too. For a possible redesign, read the logs of completed stories with get_story. Treat repeated deviations as a reason to investigate whether the design still holds. Redesign only when requirements or evidence justify a change. If the design and handoff are complete, report that and finish.',
    `3. Design. If the project provides an architect skill (for example /architect), run it now. Give it the PRD's content itself (stories, acceptance criteria, edge cases, data models, permissions, security considerations, integrations, decisions), not just the file name, and ${designPath} as the output path. Ask it to key the work and test seams by story id. For a redesign, also give it the previous design and the deviations found in step 2, and say it is a redesign. Otherwise design it yourself: learn how the nearest existing feature works end to end; sketch two structurally different designs (where state lives, who owns which rule), each starting from the code that will call it, then the data model, then the interfaces and the test seams per story; drop shapes with shallow interfaces, logic split across owners, or two ways to do one thing; choose one, and write it to ${designPath} with what was rejected and why. Do not write production code or migrations.`,
    "   Whichever way it is designed, the design states: which writes recheck the acting user's permission inside their own transaction (those that grant, approve, spend, hand over or delete), and what serializes writes that check other rows before writing; which tests prove those races on the real database, with two connections and the project's own writes (member changes, account deletion) on the other side; how every list pages, with work someone must act on (overdue, awaiting approval) as its own list; and the demo data and browser test each phase needs (roles, another tenant, phone width). Use the project's documented helpers and generators for these where it has them.",
    '',
    'Then record the design in the PRD, where story agents will find it. get_story does not return technicalContracts.apis or architecture decisions, so the attachment is how the design reaches them:',
    '4. add_attachment with title "Architecture", path "architecture.md", a note ("The contract for the data model, modules and test seams; record departures as deviations"), and storyIds for every story it covers. If the attachment already exists, use update_attachment instead.',
    '5. update_prd_section, section "technicalContracts", value { apis, dataModels }. Only the keys given change, but each list replaces the previous one, so pass every item. apis: one line per action, route, endpoint or function. dataModels: refine the existing descriptions with the real tables or entities, keeping their plain-language wording.',
    '6. add_decision with topic "architecture": the chosen shape in one sentence, with a rationale that names the rejected alternative and why it lost. For a redesign, set supersedes to the previous architecture decision. Add a separate decision for each other hard-to-reverse choice.',
    '7. For each story, update_user_story with its testSeams and the seam of each proof, and with dependencies when the design reveals an order the slicing missed.',
    '8. If several stories need shared groundwork (the core schema, a module skeleton), add it as its own story with add_user_story in the earliest phase, and make the stories that need it depend on it. For a redesign, add stories that move the built parts to the new shape.',
    '   Record recommended parallel groups by story ID in the Architecture attachment. Recheck the dependencies against the design, name the modules each story is expected to own, and flag shared migrations or contracts that need a clear order. In the handoff, highlight the first group that can start and what unlocks the next one.',
    '9. Open questions the design raised go to update_prd_section "openQuestions" with the stories they block (keep the ids of existing questions; the list replaces the previous one), or ask the user now and record the answer with add_decision. Never leave a question only in the design file: get_story and check_plan do not read it.',
    '10. Run check_plan after recording or repairing the handoff. If required items remain, report them and tell the user that shape_prd can resolve them. Otherwise, report the chosen shape, the rejected alternative, the decisions recorded, any new stories, and that implement_story is the next step. Do not change story statuses.',
  ].join('\n');
}

export function reviewStoryPrompt(
  filename: string,
  storyId: string,
  base?: string,
) {
  const diff = base
    ? `Use the supplied starting ref with git diff ${base}, scoped to the story-owned paths.`
    : 'Use the starting ref and story-owned paths from the latest story handoff. If no ref was recorded, identify the story commits and paths from Git history. If you cannot isolate the story, report what scope is missing and send it back.';

  return [
    `Review the work done for story ${storyId} in the PRD "${filename}". You are checking it against its spec, not reviewing code style: a separate review covers code quality.`,
    '',
    `1. Call get_story for the acceptance criteria, non-goals, out-of-scope items, test seams and the story log. ${diff} For a committed story use the recorded end commit when available. Inspect story-owned untracked files separately. Exclude unrelated commits and worktree edits. If overlapping edits cannot be attributed to the story, send it back.`,
    '2. For each acceptance criterion, report met, partly met or not met, with evidence at the specified proof seam. For a judge proof, score every rubric point and cite the evidence. For manual or post-deploy proofs, report the automated fallback result and the manual or production result separately. If the external check has not run, label it pending and say how to verify it.',
    '3. Scope: list changes the story did not ask for, especially anything in non-goals or out of scope.',
    '4. Tests: check that tests exercise the listed test seams and cover the criteria and the decided edge cases through public behaviour. A race the story prevents is proven with two real database connections, and the test fails when the lock or recheck is removed (a caller that retries on deadlock can hide one). Lists are tested past their first page and across tenants. The checks the project documents (its AGENTS.md or CLAUDE.md verification steps) ran on this diff; missing ones send the story back.',
    "5. Security, as an attacker: for every new route, action or query, try to reach another user's or tenant's data by changing ids, act above your role (also after being demoted or removed while the request is in flight: the write must recheck at commit), send hostile or oversized input, and repeat or replay requests. Check that the permissions and security rules in get_story are enforced on the server and tested. List each hole you find with the file and how to exploit it.",
    '6. Check that the story log matches what changed. Flag claims in whatsNew that the changes do not support, and departures from the spec that are not listed in deviations.',
    '',
    'Report:',
    '- Verdict: "approve" or "send back". Send back missing required behaviour or evidence, a failing fallback, a security finding, unreviewable scope, or an unacceptable departure from the PRD. A planned external check can stay pending if its fallback passed and the handoff says how to verify it.',
    '- Criteria: one line per criterion with its result and evidence.',
    '- Scope: extra or missing work, or "none".',
    '- Deviations: whether each one listed in the log is acceptable, or "none".',
    '- Security: holes found, or "none".',
    '- Tests: gaps, or "none".',
    '- If sending back: a short list of specific fixes, written for the agent that will make them.',
    '',
    'Do not change the story status or edit code. Return the verdict to the caller so it can complete the story or address the findings.',
  ].join('\n');
}

export function implementStoryPrompt(
  filename: string,
  storyId?: string,
  singleStory = false,
  ownerReview = false,
) {
  return [
    `You are implementing the stories from the PRD "${filename}".`,
    ownerReview
      ? 'Owner-review mode is on: the owner approves each story before it is completed.'
      : 'Owner-review mode is off unless the user or the PRD asks for it (for example "I approve each story", or a PRD constraint saying so). Then follow the owner-review steps below.',
    singleStory
      ? 'Handle one story, then report the result. Use a separate working tree for parallel work and the same PRD store for claims.'
      : 'Work through the stories continuously: continue between stories without waiting for human approval. After a story is completed, do not stop to report, ask whether to continue, or request a go-ahead; select the next ready story immediately. Pause between stories, or limit the run, only when the user has explicitly asked for it (for example "stop after each story", "ask me before the next one", or a list of stories). Without such an instruction, keep going.',
    'In multi-story mode, use get_prd and the Architecture attachment, if present, to suggest story IDs that can run together now. Check that each story is unclaimed and not started, its dependencies are completed, and it has no blocking decisions or likely edit overlap with the group or active work. Refresh the suggestion as stories complete, and mention shared prerequisites that unlock later groups. Suggest single-story workers in separate worktrees with a shared PRD store while the current run continues within its scope.',
    'Generate a unique workerId for this run. When explicitly resuming your own run, reuse its workerId and working tree. Pass it to update_story_status and add_story_log. Never reuse a different worker’s ID. When pausing, report the ID, story and working tree. If a PRD write conflicts, reread the affected records and retry only if your claim and intended change still apply.',
    '',
    `Select a story. ${storyId ? `Start with story ${storyId}. ` : ''}For automatic selection, resume only work owned by your workerId, or call get_next_story for a ready story. Leave other workers’ stories alone. For an ownerless in-progress or review story, resume it only if the user explicitly selects it and the working tree matches. If there is no ready work, use get_prd to report completion, blockers, or active stories that need a resume.`,
    '',
    '1. Call get_story. If the story has notes, read them first: a story sent back from review carries the reviewer\'s feedback there, and addressing it comes before anything else. The reviewer may also have changed the acceptance criteria; build to the criteria as they are now. Read the acceptance criteria, the non-goals and out-of-scope items, and the logs of its dependencies and of the previous story. Open the files and links in its attachments (mockups, reference docs); they show what is meant, but the acceptance criteria decide what is done. An "Architecture" attachment is the contract for the data model, modules and test seams: build against it, and list every departure from it in deviations. If the PRD has no "Architecture" attachment but an architecture.md sits in the PRD\'s folder (beside its JSON), it is the design from an architect run that was never recorded: attach it with add_attachment (title "Architecture", path "architecture.md", the stories it covers) and build against it. Build only what this story asks for.',
    '   Before changing status or resuming review, confirm dependencies are completed. If an applicable edge case is open or an open question blocks the story, use update_story_status with status "blocked" and notes naming the decision and its ID. In multi-story mode, continue with independent ready stories. When no further work can proceed within scope, use the built-in question tool when available and record answers with decide_edge_case or resolve_open_question. Revisit a blocked story by ID once its blockers are resolved. Implement and test the decided edge cases and follow the design guidance, design decisions and design.story_notes.',
    "   The security rules are binding, including the story's own security.story_notes: enforce the permissions on the server for every read and write, recheck them inside the transaction of a write that grants, approves, spends, hands over or deletes, never trust input from the browser, and keep secrets out of the client and logs. Before finishing, attack your own change: try another user's ids, a lower role, hostile input and repeated requests, and add tests for what you find. Parts listed in not_applicable do not apply: do not build them.",
    '2. Claim the story by calling update_story_status with workerId and status "in_progress", or with status "review" when resuming a review. Only proceed after the tool succeeds. If the claim conflicts, reload and reselect. If you resumed a review, recover the recorded working tree, starting commit and story-owned paths, then go to step 6.',
    '3. Before editing, record the starting commit, working tree and any pre-existing edits in the story log. Track the paths changed for this story so review can isolate them. Plan the change, then implement it with tests that cover the acceptance criteria at their proof seams. If a proof cannot be made as planned, record the deviation and use equivalent evidence or report a blocker. Keep the starting commit fixed as you revise the story.',
    '4. Run the checks the project documents (its AGENTS.md or CLAUDE.md verification steps, the same ones a change without a PRD runs) and fix what fails. Where the story has them, include a race test on the real database that fails without its lock or recheck, lists tested past one page, the browser check across roles and another tenant, and demo data for each state.',
    '5. Call add_story_log. Include the review scope in technicalNotes: starting commit, working tree, story-owned paths, and the end commit if the story was committed. Record how to run any pending manual or production check. Use whatsNew for what a person can try and deviations for departures from the PRD and their reasons.',
    '6. Call update_story_status with status "review" and apply the review_story checklist. Review the scoped diff and story-owned untracked files for acceptance criteria and proof evidence, scope, security, edge-case coverage, and accuracy of the handoff. Send back missing behaviour or evidence, failed fallbacks, security findings, unacceptable deviations, or changes whose scope cannot be isolated. A planned external check may remain pending with a passing fallback and verification instructions. Fix send-back findings, rerun checks, append the updated handoff, and review again.',
    '7. When the review passes, call update_story_status with status "completed". If completion verification fails, fix the failures and retry before moving on.',
    '   Owner-review mode: when the review passes, leave the story in "review", report what to try and how to verify it, and stop. Mark it "completed" only after the owner explicitly approves that story ("go on" about something else is not approval), then continue. Before starting a story that depends on one still in review, ask for that approval.',
    singleStory
      ? '8. Report the story result and any pending external checks or blockers.'
      : '8. Repeat the story selection and implementation steps for the same PRD immediately, without asking for approval, until the work is complete, nothing can proceed, or the user has asked you to stop or pause. Report completed stories, pending external checks, and unresolved blockers.',
  ].join('\n');
}
