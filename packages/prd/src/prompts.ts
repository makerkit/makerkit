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
    '7. Hard-to-reverse choices (add_decision). Unanswered questions go to update_prd_section openQuestions; answer them later with resolve_open_question.',
    '',
    'Then slice the work:',
    '- Each story is a thin slice through every layer that a person can try once it is done, and that fits in one agent session. Put refactoring needed by later stories in its own earlier story.',
    '- Create the phases first (create_custom_phase), in the order they should be built. Each phase should end with something a person can try (a page in the app, an API call, a command); say what in its description.',
    '- Add each story with add_user_story in one call: testSeams (the public entry points the tests will exercise), dependencies (stories that must be completed first) and phaseId.',
    '- When the user shares mockups, screenshots or reference docs, save each file in the PRD folder (.prds/<prd file name without .json>/) and record it with add_attachment, linking the stories that use it. Record links to outside docs with a url instead.',
    '- Confirm the breakdown with the user, then fix anything with update_user_story or assign_story_to_phase.',
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
    '4. Tests: check that tests exercise the listed test seams and cover the criteria through public behaviour.',
    '5. Check that the story log matches what changed. Flag claims in whatsNew that the changes do not support, and departures from the spec that are not listed in deviations.',
    '',
    'Report:',
    '- Verdict: "approve" or "send back".',
    '- Criteria: one line per criterion with its result and evidence.',
    '- Scope: extra or missing work, or "none".',
    '- Deviations: whether each one listed in the log is acceptable, or "none".',
    '- Tests: gaps, or "none".',
    '- If sending back: a short list of specific fixes, written for the agent that will make them.',
    '',
    'Do not change the story status and do not edit code. A person decides.',
  ].join('\n');
}

export function implementStoryPrompt(filename: string, storyId?: string) {
  const pick = storyId
    ? `Work on story ${storyId}.`
    : 'Call get_next_story to pick the story. If none is ready, report why and stop.';

  return [
    `You are implementing a story from the PRD "${filename}". ${pick}`,
    '',
    '1. Call get_story. Read the acceptance criteria, the non-goals and out-of-scope items, and the logs of its dependencies and of the previous story. Open the files and links in its attachments (mockups, reference docs); they show what is meant, but the acceptance criteria decide what is done. Build only what this story asks for.',
    '2. Call update_story_status with status "in_progress".',
    '3. Plan the change, then implement it with tests that cover the acceptance criteria.',
    '4. Run the project checks and fix what fails.',
    '5. Call add_story_log: whatsNew lists what a person can now try, in plain language; technicalNotes lists decisions, gotchas and files the next agent should know about; deviations lists where the work departed from the PRD (a criterion changed or skipped, extra scope, a different approach) and why. Leave deviations empty if there were none.',
    '6. Call update_story_status with status "review". Do not mark the story completed; a person approves it.',
  ].join('\n');
}
