import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v3';

import type { PrdService } from '../prd.service';
import {
  AddUserStoryInputSchema,
  AddUserStoryOutputSchema,
  CreatePrdInputSchema,
  CreatePrdOutputSchema,
  DeletePrdInputSchema,
  DeletePrdOutputSchema,
  ExportPrdMarkdownInputSchema,
  ExportPrdMarkdownOutputSchema,
  GetImplementationPromptsInputSchema,
  GetImplementationPromptsOutputSchema,
  GetImprovementSuggestionsInputSchema,
  GetImprovementSuggestionsOutputSchema,
  GetPrdInputSchema,
  GetPrdOutputSchema,
  GetProjectStatusInputSchema,
  GetProjectStatusOutputSchema,
  ListPrdsInputSchema,
  ListPrdsOutputSchema,
  UpdateStoryStatusInputSchema,
  UpdateStoryStatusOutputSchema,
  UpdateUserStoryInputSchema,
  UpdateUserStoryOutputSchema,
  DeleteUserStoryInputSchema,
  DeleteUserStoryOutputSchema,
  CreateCustomPhaseInputSchema,
  CreateCustomPhaseOutputSchema,
  AssignStoryToPhaseInputSchema,
  AssignStoryToPhaseOutputSchema,
  GetNextStoryInputSchema,
  GetNextStoryOutputSchema,
  GetStoryInputSchema,
  GetStoryOutputSchema,
  AddStoryLogInputSchema,
  AddStoryLogOutputSchema,
  UpdatePrdSectionInputSchema,
  UpdatePrdSectionOutputSchema,
  AddDecisionInputSchema,
  AddDecisionOutputSchema,
  ResolveOpenQuestionInputSchema,
  ResolveOpenQuestionOutputSchema,
  AddGlossaryTermInputSchema,
  AddGlossaryTermOutputSchema,
  UpdatePhaseInputSchema,
  DeletePhaseInputSchema,
  ReorderPhasesInputSchema,
  PhasesOutputSchema,
  CheckPlanInputSchema,
  CheckPlanOutputSchema,
  ListTemplatesInputSchema,
  ListTemplatesOutputSchema,
} from '../schema';
import { TEMPLATE_IDS, getTemplate } from '../templates';
import {
  DESTRUCTIVE_TOOL,
  IDEMPOTENT_MUTATING_TOOL,
  MUTATING_TOOL,
  READ_ONLY_TOOL,
  buildErrorResponse,
  buildStructuredResponse,
} from './tool-response';

/**
 * Registers the PRD tools on an MCP server. The caller builds the service, so
 * it decides where PRDs live and which checks gate a story's completion.
 */
export function registerPRDTools(server: McpServer, service: PrdService) {
  server.registerTool(
    'list_prds',
    {
      title: 'List PRDs',
      description:
        'List Product Requirements Documents in .prds with title and story progress.',
      inputSchema: ListPrdsInputSchema,
      outputSchema: ListPrdsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await service.list());
      } catch (error) {
        return buildErrorResponse('list_prds', error);
      }
    },
  );

  server.registerTool(
    'get_prd',
    {
      title: 'Read a PRD',
      description: 'Get the full contents of one PRD file.',
      inputSchema: GetPrdInputSchema,
      outputSchema: GetPrdOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = GetPrdInputSchema.parse(input);

        return buildStructuredResponse(await service.get(parsed));
      } catch (error) {
        return buildErrorResponse('get_prd', error);
      }
    },
  );

  server.registerTool(
    'create_prd',
    {
      title: 'Create a PRD',
      description:
        'Create a new structured PRD in .prds. The file name is derived from the title.',
      inputSchema: CreatePrdInputSchema,
      outputSchema: CreatePrdOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = CreatePrdInputSchema.parse(input);

        return buildStructuredResponse(await service.create(parsed));
      } catch (error) {
        return buildErrorResponse('create_prd', error);
      }
    },
  );

  server.registerTool(
    'delete_prd',
    {
      title: 'Delete a PRD',
      description: 'Permanently delete a PRD file.',
      inputSchema: DeletePrdInputSchema,
      outputSchema: DeletePrdOutputSchema,
      annotations: DESTRUCTIVE_TOOL,
    },
    async (input) => {
      try {
        const parsed = DeletePrdInputSchema.parse(input);

        return buildStructuredResponse(await service.delete(parsed));
      } catch (error) {
        return buildErrorResponse('delete_prd', error);
      }
    },
  );

  server.registerTool(
    'add_user_story',
    {
      title: 'Add a user story',
      description: 'Append a user story with acceptance criteria to a PRD.',
      inputSchema: AddUserStoryInputSchema,
      outputSchema: AddUserStoryOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = AddUserStoryInputSchema.parse(input);

        return buildStructuredResponse(await service.addUserStory(parsed));
      } catch (error) {
        return buildErrorResponse('add_user_story', error);
      }
    },
  );

  server.registerTool(
    'update_story_status',
    {
      title: 'Update story status',
      description:
        'Update a user story status. Marking a story "completed" runs the project checks (typecheck, lint) first and is rejected if they fail.',
      inputSchema: UpdateStoryStatusInputSchema,
      outputSchema: UpdateStoryStatusOutputSchema,
      // Re-running "completed" re-executes the checks and rewrites the
      // verification timestamp, so it is not idempotent.
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = UpdateStoryStatusInputSchema.parse(input);

        return buildStructuredResponse(await service.updateStoryStatus(parsed));
      } catch (error) {
        return buildErrorResponse('update_story_status', error);
      }
    },
  );

  server.registerTool(
    'update_user_story',
    {
      title: 'Update a user story',
      description:
        "Edit an existing story's content. Every field is optional; only the ones supplied change. Use update_story_status for status.",
      inputSchema: UpdateUserStoryInputSchema,
      outputSchema: UpdateUserStoryOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = UpdateUserStoryInputSchema.parse(input);

        return buildStructuredResponse(await service.updateUserStory(parsed));
      } catch (error) {
        return buildErrorResponse('update_user_story', error);
      }
    },
  );

  server.registerTool(
    'delete_user_story',
    {
      title: 'Delete a user story',
      description:
        "Remove a story and clean up references to it in other stories' dependencies and in phases. Story ids are never reissued.",
      inputSchema: DeleteUserStoryInputSchema,
      outputSchema: DeleteUserStoryOutputSchema,
      annotations: DESTRUCTIVE_TOOL,
    },
    async (input) => {
      try {
        const parsed = DeleteUserStoryInputSchema.parse(input);

        return buildStructuredResponse(await service.deleteUserStory(parsed));
      } catch (error) {
        return buildErrorResponse('delete_user_story', error);
      }
    },
  );

  server.registerTool(
    'create_custom_phase',
    {
      title: 'Create a delivery phase',
      description:
        'Create a named phase (e.g. "MVP", "Fast follow") that stories can be grouped into.',
      inputSchema: CreateCustomPhaseInputSchema,
      outputSchema: CreateCustomPhaseOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = CreateCustomPhaseInputSchema.parse(input);

        return buildStructuredResponse(await service.createCustomPhase(parsed));
      } catch (error) {
        return buildErrorResponse('create_custom_phase', error);
      }
    },
  );

  server.registerTool(
    'assign_story_to_phase',
    {
      title: 'Assign a story to a phase',
      description:
        'Move a story into a phase, or pass phaseId null to remove it from every phase. A story belongs to at most one phase.',
      inputSchema: AssignStoryToPhaseInputSchema,
      outputSchema: AssignStoryToPhaseOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = AssignStoryToPhaseInputSchema.parse(input);

        return buildStructuredResponse(
          await service.assignStoryToPhase(parsed),
        );
      } catch (error) {
        return buildErrorResponse('assign_story_to_phase', error);
      }
    },
  );

  server.registerTool(
    'export_prd_markdown',
    {
      title: 'Export PRD as Markdown',
      description:
        'Write a Markdown rendering of the PRD next to the JSON file.',
      inputSchema: ExportPrdMarkdownInputSchema,
      outputSchema: ExportPrdMarkdownOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = ExportPrdMarkdownInputSchema.parse(input);

        return buildStructuredResponse(await service.exportMarkdown(parsed));
      } catch (error) {
        return buildErrorResponse('export_prd_markdown', error);
      }
    },
  );

  server.registerTool(
    'get_implementation_prompts',
    {
      title: 'Implementation prompts',
      description:
        'Generate implementation prompts for the PRD and its next unstarted stories.',
      inputSchema: GetImplementationPromptsInputSchema,
      outputSchema: GetImplementationPromptsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const { filename } = GetImplementationPromptsInputSchema.parse(input);

        return buildStructuredResponse(
          await service.getImplementationPrompts(filename),
        );
      } catch (error) {
        return buildErrorResponse('get_implementation_prompts', error);
      }
    },
  );

  server.registerTool(
    'get_improvement_suggestions',
    {
      title: 'PRD completeness checks',
      description:
        'Rule-based suggestions for missing PRD sections (stories, metrics, scope guardrails, rollout plan).',
      inputSchema: GetImprovementSuggestionsInputSchema,
      outputSchema: GetImprovementSuggestionsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const { filename } = GetImprovementSuggestionsInputSchema.parse(input);

        return buildStructuredResponse(
          await service.getImprovementSuggestions(filename),
        );
      } catch (error) {
        return buildErrorResponse('get_improvement_suggestions', error);
      }
    },
  );

  server.registerTool(
    'get_project_status',
    {
      title: 'PRD project status',
      description:
        'Progress, next steps, blockers, open questions and high risks for a PRD.',
      inputSchema: GetProjectStatusInputSchema,
      outputSchema: GetProjectStatusOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const { filename } = GetProjectStatusInputSchema.parse(input);

        return buildStructuredResponse(
          await service.getProjectStatus(filename),
        );
      } catch (error) {
        return buildErrorResponse('get_project_status', error);
      }
    },
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List PRD templates',
      description:
        'Starting points for create_prd (e.g. a SaaS feature, an internal tool, an integration, a first version). Each says when to use it.',
      inputSchema: ListTemplatesInputSchema,
      outputSchema: ListTemplatesOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(service.listTemplates());
      } catch (error) {
        return buildErrorResponse('list_templates', error);
      }
    },
  );

  server.registerTool(
    'check_plan',
    {
      title: 'Check what the plan is missing',
      description:
        'A checklist of what the PRD still needs before and during the build. "required" items (no stories, stories without acceptance criteria, no scope limits) mean it is not ready to build; "recommended" items improve it. Each item names the section to change and, when relevant, the stories.',
      inputSchema: CheckPlanInputSchema,
      outputSchema: CheckPlanOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const { filename } = CheckPlanInputSchema.parse(input);

        return buildStructuredResponse(await service.checkPlan(filename));
      } catch (error) {
        return buildErrorResponse('check_plan', error);
      }
    },
  );

  server.registerTool(
    'get_next_story',
    {
      title: 'Next story to work on',
      description:
        'The next not-started story whose dependencies are all completed, ordered by phase, priority and position. Also lists stories in progress and stories waiting on dependencies.',
      inputSchema: GetNextStoryInputSchema,
      outputSchema: GetNextStoryOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const { filename } = GetNextStoryInputSchema.parse(input);

        return buildStructuredResponse(await service.getNextStory(filename));
      } catch (error) {
        return buildErrorResponse('get_next_story', error);
      }
    },
  );

  server.registerTool(
    'get_story',
    {
      title: 'Story with context',
      description:
        'One story with what is needed to implement it: PRD summary and scope limits, its phase, its dependencies and their hand-off logs, and the log of the most recently completed story. Prefer this over get_prd when working on a single story.',
      inputSchema: GetStoryInputSchema,
      outputSchema: GetStoryOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.getStory(GetStoryInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse('get_story', error);
      }
    },
  );

  server.registerTool(
    'add_story_log',
    {
      title: 'Log work on a story',
      description:
        'Append a hand-off entry to a story: what a person can now try (whatsNew) and notes for the next agent (technicalNotes). Write one when you finish a work session on a story.',
      inputSchema: AddStoryLogInputSchema,
      outputSchema: AddStoryLogOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.addStoryLog(AddStoryLogInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse('add_story_log', error);
      }
    },
  );

  server.registerTool(
    'update_prd_section',
    {
      title: 'Update a PRD section',
      description:
        'Change one section of a PRD after it was created: scope (nonGoals, outOfScope), assumptions, open questions, risks, external dependencies, technical requirements and contracts, global acceptance criteria, constraints, rollout and measurement plans, or the introduction, problem and solution.',
      inputSchema: UpdatePrdSectionInputSchema,
      outputSchema: UpdatePrdSectionOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.updatePrdSection(
            UpdatePrdSectionInputSchema.parse(input),
          ),
        );
      } catch (error) {
        return buildErrorResponse('update_prd_section', error);
      }
    },
  );

  server.registerTool(
    'add_decision',
    {
      title: 'Record a decision',
      description:
        'Add an entry to the PRD decision log. Use it for choices that are hard to reverse or would surprise someone reading the code later. Pass supersedes to replace an earlier decision.',
      inputSchema: AddDecisionInputSchema,
      outputSchema: AddDecisionOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.addDecision(AddDecisionInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse('add_decision', error);
      }
    },
  );

  server.registerTool(
    'resolve_open_question',
    {
      title: 'Answer an open question',
      description:
        'Remove an open question from the PRD and, by default, record the answer in the decision log.',
      inputSchema: ResolveOpenQuestionInputSchema,
      outputSchema: ResolveOpenQuestionOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.resolveOpenQuestion(
            ResolveOpenQuestionInputSchema.parse(input),
          ),
        );
      } catch (error) {
        return buildErrorResponse('resolve_open_question', error);
      }
    },
  );

  server.registerTool(
    'add_glossary_term',
    {
      title: 'Define a glossary term',
      description:
        'Add or redefine a term in the PRD glossary, with words to avoid, so people and agents use the same names for the same things.',
      inputSchema: AddGlossaryTermInputSchema,
      outputSchema: AddGlossaryTermOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.addGlossaryTerm(
            AddGlossaryTermInputSchema.parse(input),
          ),
        );
      } catch (error) {
        return buildErrorResponse('add_glossary_term', error);
      }
    },
  );

  server.registerTool(
    'update_phase',
    {
      title: 'Update a phase',
      description: 'Rename a phase or change its description or colour.',
      inputSchema: UpdatePhaseInputSchema,
      outputSchema: PhasesOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.updatePhase(UpdatePhaseInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse('update_phase', error);
      }
    },
  );

  server.registerTool(
    'delete_phase',
    {
      title: 'Delete a phase',
      description:
        'Delete a phase. Its stories stay in the PRD without a phase.',
      inputSchema: DeletePhaseInputSchema,
      outputSchema: PhasesOutputSchema,
      annotations: DESTRUCTIVE_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.deletePhase(DeletePhaseInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse('delete_phase', error);
      }
    },
  );

  server.registerTool(
    'reorder_phases',
    {
      title: 'Reorder phases',
      description:
        'Set the order of all phases. get_next_story works through phases in this order.',
      inputSchema: ReorderPhasesInputSchema,
      outputSchema: PhasesOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.reorderPhases(ReorderPhasesInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse('reorder_phases', error);
      }
    },
  );

  server.registerPrompt(
    'shape_prd',
    {
      title: 'Shape a PRD',
      description:
        'Interview the user round by round until the plan is clear, writing each decision into the PRD as it is made, then slice the work into stories and phases.',
      argsSchema: {
        idea: z
          .string()
          .optional()
          .describe('What to build, in a sentence or two'),
        filename: z
          .string()
          .optional()
          .describe('Existing PRD to keep shaping, inside .prds'),
        template: z
          .enum(TEMPLATE_IDS)
          .optional()
          .describe('Kind of work, see list_templates'),
      },
    },
    ({ idea, filename, template }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: shapePrdPrompt(idea, filename, template),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'review_story',
    {
      title: 'Review a story against its spec',
      description:
        'Check the changes made for a story against its acceptance criteria, scope limits and test seams, and report a verdict.',
      argsSchema: {
        filename: z.string().describe('PRD file name inside .prds'),
        storyId: z.string().describe('Story id such as US003'),
        base: z
          .string()
          .optional()
          .describe('Git ref the story started from. Defaults to HEAD.'),
      },
    },
    ({ filename, storyId, base }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: reviewStoryPrompt(filename, storyId, base),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'implement_story',
    {
      title: 'Implement a PRD story',
      description:
        'Instructions for implementing one story end to end with the PRD tools.',
      argsSchema: {
        filename: z.string().describe('PRD file name inside .prds'),
        storyId: z
          .string()
          .optional()
          .describe('Story id such as US003. Omit to take the next ready one.'),
      },
    },
    ({ filename, storyId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: implementStoryPrompt(filename, storyId),
          },
        },
      ],
    }),
  );
}

function shapePrdPrompt(
  idea?: string,
  filename?: string,
  templateId?: (typeof TEMPLATE_IDS)[number],
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
    '- Give a recommended answer for every question, worded so that replying "yes" accepts it. The user can accept, change or discuss each one.',
    '- Look up facts yourself (the codebase, existing PRDs, docs) instead of asking. Only decisions go to the user.',
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
    '4. The main entities and the words for them (add_glossary_term, including words to avoid).',
    '5. For each feature: what is in and out of scope, and what a person must be able to do (acceptance criteria).',
    '6. Hard-to-reverse choices (add_decision). Unanswered questions go to update_prd_section openQuestions; answer them later with resolve_open_question.',
    '',
    'Then slice the work:',
    '- Each story is a thin slice through every layer that a person can try once it is done, and that fits in one agent session. Put refactoring needed by later stories in its own earlier story.',
    '- Add stories with add_user_story, including testSeams: the public entry points the tests will exercise.',
    '- Set dependencies with update_user_story, group stories into phases (create_custom_phase, assign_story_to_phase) in the order they should be built, and confirm the breakdown with the user.',
  ].join('\n');
}

function reviewStoryPrompt(filename: string, storyId: string, base?: string) {
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
    '5. Check that the story log matches what changed. Flag claims in whatsNew that the changes do not support.',
    '',
    'Report:',
    '- Verdict: "approve" or "send back".',
    '- Criteria: one line per criterion with its result and evidence.',
    '- Scope: extra or missing work, or "none".',
    '- Tests: gaps, or "none".',
    '- If sending back: a short list of specific fixes, written for the agent that will make them.',
    '',
    'Do not change the story status and do not edit code. A person decides.',
  ].join('\n');
}

function implementStoryPrompt(filename: string, storyId?: string) {
  const pick = storyId
    ? `Work on story ${storyId}.`
    : 'Call get_next_story to pick the story. If none is ready, report why and stop.';

  return [
    `You are implementing a story from the PRD "${filename}". ${pick}`,
    '',
    '1. Call get_story. Read the acceptance criteria, the non-goals and out-of-scope items, and the logs of its dependencies and of the previous story. Build only what this story asks for.',
    '2. Call update_story_status with status "in_progress".',
    '3. Plan the change, then implement it with tests that cover the acceptance criteria.',
    '4. Run the project checks and fix what fails.',
    '5. Call add_story_log: whatsNew lists what a person can now try, in plain language; technicalNotes lists decisions, gotchas and files the next agent should know about.',
    '6. Call update_story_status with status "review". Do not mark the story completed; a person approves it.',
  ].join('\n');
}
