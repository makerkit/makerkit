import { attachmentProjectPath } from './attachment-paths';
import { type TemplateId, getTemplate } from './templates';

/**
 * The instructions behind the MCP prompts, exported so other tools (e.g. a
 * UI that shows what to ask the agent) give exactly the same text.
 */

export function shapePrdPrompt(
  idea?: string,
  filename?: string,
  templateId?: TemplateId,
) {
  const template = templateId ? getTemplate(templateId) : null;

  const start = filename
    ? `Keep shaping the PRD "${filename}". Read it with get_prd first and continue from its open questions.`
    : idea
      ? `The idea: ${idea}`
      : 'Start by asking what we are building, in a sentence or two.';

  return [
    `We are shaping a product requirements document before any code is written. ${start}`,
    '',
    'How to run the interview:',
    '- Think of the plan as a tree of decisions. In each round, ask only the questions that can be answered now, i.e. whose prerequisites are already decided. Number them.',
    '- Give a recommended answer for every question, with a one-line reason, worded so that replying "yes" accepts it. The user can accept, change or discuss each one.',
    '- Look up facts yourself (the codebase, existing PRDs, docs) instead of asking. Only decisions go to the user.',
    '- PRD text may use Markdown. Keep list items (criteria, non-goals, open questions) to one line of inline Markdown: bold, code, links. No raw HTML.',
    '- Before the first round, read CLAUDE.md, AGENTS.md and package.json to learn the stack and whether the project starts from a kit or starter. Do not plan stories for what it already provides (e.g. sign-in, billing, teams); add those to assumptions instead (update_prd_section replaces the list, so pass the existing items too).',
    '- After each round, record what was decided before asking the next round.',
    '- Stop when no undecided questions remain, and confirm with the user before slicing the work.',
    '',
    template
      ? `This is a "${template.name}" (${template.description}) Create the PRD with template "${template.id}", and make sure the interview covers: ${template.interviewFocus.join(' ')}`
      : 'If you are unsure what kind of work this is, call list_templates and suggest one.',
    '',
    'Order of the rounds, broad to detailed:',
    '1. What we are building and for whom (create_prd once this is clear, if there is no PRD yet).',
    '2. Main features, then what we are explicitly NOT building (update_prd_section with nonGoals and outOfScope). Be explicit: anything unlisted is likely to be invented later.',
    '3. Whether this is an internal tool or a product for many customers or tenants. It changes what should be configurable versus hard-coded.',
    '4. The main entities and the words for them (add_glossary_term, including words to avoid). Describe each entity, what it holds and how it relates to the others in plain language, e.g. "Bookmark: a saved link. Belongs to one account; has many tags." Record them with update_prd_section, section "technicalContracts", value { dataModels: [...] }. The list replaces the previous one, so always pass every entity.',
    '5. Outside services (email, payments, storage, AI, SMS, maps...): for each feature that needs one, recommend a provider and list the credentials or environment variables the user must get. Record them with update_prd_section, section "technicalRequirements", value { integrationNeeds: [...] }, one entry per service, e.g. "Payments: Stripe. Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET." The list replaces the previous one, so always pass every service.',
    '6. For each feature: what is in and out of scope, and what a person must be able to do (acceptance criteria).',
    '7. What can go wrong. Take an adversarial view: assume users make mistakes, data is messy, networks and outside services fail, and two people act at once. Go through each feature and find the failure modes before the user has to think of them: missing or invalid input, empty and very large data, partial success and retries, duplicates and double submits, concurrent edits, time zones and dates, limits and quotas, outside services failing or slow, deleting and undoing. For each one, recommend what should happen. Record them with update_prd_section, section "edgeCases", value [{ case, expectedBehavior, status, storyIds }]: "decided" once the user agreed, "open" while it needs an answer. The list replaces the previous one, so always pass every case. Do not slice the work while any edge case is open.',
    '8. Security. Switch to an attacker\'s mindset: for each feature, ask how a malicious user, a curious user of another account or tenant, or a compromised integration would abuse it, and assume they will try. Probe at least: changing ids in URLs and requests to reach other people\'s data; acting above one\'s role; hostile input (SQL, HTML and script, prompt injection into AI features, path traversal, oversized payloads); hostile file uploads; forged or replayed webhooks; brute force and account or email enumeration; abuse of costly actions (spam, quotas, paid APIs); secrets reaching the browser, logs or error messages; server requests to user-supplied URLs. Recommend a defence for each one that applies, then record: who can see and change what in update_prd_section "technicalContracts" { permissions: [...] }; sensitive data and legal duties (personal data, payments, retention, deletion) in "technicalRequirements" { complianceRequirements: [...] }; the standing rules that prevent abuse in "securityConsiderations"; and each concrete attack as an edge case with the safe behaviour (e.g. "User opens another account\'s invoice by changing the id" -> "404, nothing about it is revealed"). These lists replace the previous ones, so pass every item.',
    '9. Risks. Run a pre-mortem: assume the feature shipped and failed badly six months later, and work out why (data loss, a security incident, cost running away, an outside dependency changing, nobody using it, legal trouble, the team unable to maintain it). Record specific risks, not generic ones, with severity, mitigation and owner via update_prd_section "risks".',
    '10. Design: how it should look and feel. Ask for or suggest standing rules (which components and layout to use, tone of copy, mobile, how empty, loading and error states look) and record them with update_prd_section, section "designGuidance". Save mockups as attachments. Record individual design choices with add_decision and a topic starting with "design:", e.g. "design:navigation".',
    '11. Hard-to-reverse choices (add_decision). A question the user cannot answer now goes to update_prd_section "openQuestions" as { question, why, options, recommended, storyIds }: why says what goes wrong if an agent guesses, options are the real choices, recommended is your suggestion, and storyIds are the stories it blocks. Write it so a person can answer it later without this conversation. Keep the ids of existing questions (the list replaces the previous one). Answers are recorded with resolve_open_question.',
    '12. If a part genuinely does not apply (no outside services; no rollout plan for an internal tool), mark it with mark_not_applicable and a reason instead of leaving it empty. Never mark security or edge cases as not applicable for a feature that takes input from people or stores their data.',
    '',
    'Then slice the work:',
    '- Each story is a thin slice through every layer that a person can try once it is done, and that fits in one agent session. Put refactoring needed by later stories in its own earlier story.',
    '- Create the phases first (create_custom_phase), in the order they should be built. Each phase should end with something a person can try (a page in the app, an API call, a command); say what in its description.',
    '- Add each story with add_user_story in one call: testSeams (the public entry points the tests will exercise), dependencies (stories that must be completed first) and phaseId. Add designNotes when the story has a screen or states the PRD design guidance does not settle, and securityNotes for each way this story in particular could be abused (whose ids it accepts, what input it trusts, what it costs to repeat) with the defence. Do not repeat the PRD-wide guidance or considerations there.',
    '- When the user shares mockups, screenshots or reference docs, save each file in the PRD folder (.prds/<prd file name without .json>/) and record it with add_attachment, linking the stories that use it. Record links to outside docs with a url instead.',
    '- Confirm the breakdown with the user, then fix anything with update_user_story or assign_story_to_phase.',
    '- When the breakdown is confirmed, tell the user the next step is the architect_prd prompt, which designs the shape all the stories share before any of them is built.',
  ].join('\n');
}

export function architectPrdPrompt(filename: string) {
  const designPath = attachmentProjectPath(filename, 'architecture.md');

  return [
    `Design how the PRD "${filename}" gets built, before any story is coded: the data model, the modules and who owns which rule, the entry points and the test seams all stories share. Without it, each story's agent invents its own shape.`,
    '',
    '1. Call get_prd and check_plan. If check_plan returns a required item, an edge case is still open, or an open question blocks a story, stop: tell the user what is missing and that shape_prd continues from there. A design built around an undecided behaviour bakes in a guess.',
    '2. If an "Architecture" attachment already exists, this is a redesign. Read it, and call get_story on the completed stories to read their logs. The same kind of deviation in two or more stories means the shape is wrong; one deviation is information. If the shape still holds, say so and stop.',
    `3. Design. If the project provides an architect skill (for example /architect), run it now. Give it the PRD's content itself (stories, acceptance criteria, edge cases, data models, permissions, security considerations, integrations, decisions), not just the file name, and ${designPath} as the output path. Ask it to key the work and test seams by story id. For a redesign, also give it the previous design and the deviations found in step 2, and say it is a redesign. Otherwise design it yourself: learn how the nearest existing feature works end to end; sketch two structurally different designs (where state lives, who owns which rule), each starting from the code that will call it, then the data model, then the interfaces and the test seams per story; drop shapes with shallow interfaces, logic split across owners, or two ways to do one thing; choose one, and write it to ${designPath} with what was rejected and why. Do not write production code or migrations.`,
    '',
    'Then record the design in the PRD, where story agents will find it. get_story does not return technicalContracts.apis or architecture decisions, so the attachment is how the design reaches them:',
    '4. add_attachment with title "Architecture", path "architecture.md", a note ("The contract for the data model, modules and test seams; record departures as deviations"), and storyIds for every story it covers. If the attachment already exists, use update_attachment instead.',
    '5. update_prd_section, section "technicalContracts", value { apis, dataModels }. Only the keys given change, but each list replaces the previous one, so pass every item. apis: one line per action, route, endpoint or function. dataModels: refine the existing descriptions with the real tables or entities, keeping their plain-language wording.',
    '6. add_decision with topic "architecture": the chosen shape in one sentence, with a rationale that names the rejected alternative and why it lost. For a redesign, set supersedes to the previous architecture decision. Add a separate decision for each other hard-to-reverse choice.',
    '7. For each story, update_user_story with its testSeams, and with dependencies when the design reveals an order the slicing missed.',
    '8. If several stories need shared groundwork (the core schema, a module skeleton), add it as its own story with add_user_story in the earliest phase, and make the stories that need it depend on it. For a redesign, add stories that move the built parts to the new shape.',
    '9. Open questions the design raised go to update_prd_section "openQuestions" with the stories they block (keep the ids of existing questions; the list replaces the previous one), or ask the user now and record the answer with add_decision. Never leave a question only in the design file: get_story and check_plan do not read it.',
    '10. Do not change story statuses. Report the chosen shape, the rejected alternative, the decisions recorded, any new stories, and that implement_story is the next step.',
  ].join('\n');
}

export function reviewStoryPrompt(
  filename: string,
  storyId: string,
  base?: string,
) {
  const diff = base
    ? `git diff ${base}`
    : 'git diff HEAD (plus untracked files from git status)';

  return [
    `Review the work done for story ${storyId} in the PRD "${filename}". You are checking it against its spec, not reviewing code style: a separate review covers code quality.`,
    '',
    `1. Call get_story for the acceptance criteria, non-goals, out-of-scope items, test seams and the story log. Read the changes with ${diff}.`,
    '2. For each acceptance criterion, decide met, partly met or not met, and cite the file or test that shows it.',
    '3. Scope: list changes the story did not ask for, especially anything in non-goals or out of scope.',
    '4. Tests: check that tests exercise the listed test seams and cover the criteria and the decided edge cases through public behaviour.',
    "5. Security, as an attacker: for every new route, action or query, try to reach another user's or tenant's data by changing ids, act above your role, send hostile or oversized input, and repeat or replay requests. Check that the permissions and security rules in get_story are enforced on the server and tested. List each hole you find with the file and how to exploit it.",
    '6. Check that the story log matches what changed. Flag claims in whatsNew that the changes do not support, and departures from the spec that are not listed in deviations.',
    '',
    'Report:',
    '- Verdict: "approve" or "send back".',
    '- Criteria: one line per criterion with its result and evidence.',
    '- Scope: extra or missing work, or "none".',
    '- Deviations: whether each one listed in the log is acceptable, or "none".',
    '- Security: holes found, or "none".',
    '- Tests: gaps, or "none".',
    '- If sending back: a short list of specific fixes, written for the agent that will make them.',
    '',
    'Do not change the story status and do not edit code. A person decides.',
  ].join('\n');
}

export function implementStoryPrompt(filename: string, storyId?: string) {
  const pick = storyId
    ? `Work on story ${storyId}.`
    : 'Call get_next_story. If a story is already in progress (for example one sent back from review), finish that one first; otherwise take the story it returns. If none is ready, report why and stop.';

  return [
    `You are implementing a story from the PRD "${filename}". ${pick}`,
    '',
    '1. Call get_story. If the story has notes, read them first: a story sent back from review carries the reviewer\'s feedback there, and addressing it comes before anything else. Read the acceptance criteria, the non-goals and out-of-scope items, and the logs of its dependencies and of the previous story. Open the files and links in its attachments (mockups, reference docs); they show what is meant, but the acceptance criteria decide what is done. An "Architecture" attachment is the contract for the data model, modules and test seams: build against it, and list every departure from it in deviations. Build only what this story asks for.',
    "   Its edge_cases are part of the spec: implement and test each decided case as stated. If a case is still open, ask the user what should happen before building that part; never pick a behaviour yourself. Follow the design guidance, design decisions and the story's own design.story_notes for anything a person sees.",
    '   If open_questions lists questions that block this story, ask the user, record the answer with resolve_open_question, and only then build the part it affects.',
    "   The security rules are binding, including the story's own security.story_notes: enforce the permissions on the server for every read and write, never trust input from the browser, and keep secrets out of the client and logs. Before finishing, attack your own change: try another user's ids, a lower role, hostile input and repeated requests, and add tests for what you find. Parts listed in not_applicable do not apply: do not build them.",
    '2. Call update_story_status with status "in_progress".',
    '3. Plan the change, then implement it with tests that cover the acceptance criteria.',
    '4. Run the project checks and fix what fails.',
    '5. Call add_story_log: whatsNew lists what a person can now try, in plain language; technicalNotes lists decisions, gotchas and files the next agent should know about; deviations lists where the work departed from the PRD (a criterion changed or skipped, extra scope, a different approach) and why. Leave deviations empty if there were none.',
    '6. Call update_story_status with status "review". Do not mark the story completed; a person approves it.',
  ].join('\n');
}
