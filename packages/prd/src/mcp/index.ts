import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v3';

import type { PrdService } from '../prd.service';
import {
  architectPrdPrompt,
  implementStoryPrompt,
  reviewStoryPrompt,
  shapePrdPrompt,
} from '../prompts';
import {
  AddAttachmentInputSchema,
  AddAttachmentOutputSchema,
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
  RemoveAttachmentInputSchema,
  RemoveAttachmentOutputSchema,
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
  DecideEdgeCaseInputSchema,
  UpdateAttachmentInputSchema,
  UpdateAttachmentOutputSchema,
  DecideEdgeCaseOutputSchema,
  MarkNotApplicableInputSchema,
  MarkNotApplicableOutputSchema,
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
import { TEMPLATE_IDS } from '../templates';
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
      description:
        'Permanently delete a PRD file. Its folder of attachments, if any, is kept.',
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
        'The implement_story instructions for the next unstarted stories, as text to paste into an agent that does not support MCP prompts.',
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
        'Append a hand-off entry to a story: what a person can now try (whatsNew), notes for the next agent (technicalNotes) and where the work departed from the PRD (deviations). Write one when you finish a work session on a story.',
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
    'add_attachment',
    {
      title: 'Add an attachment',
      description:
        "Record a file or link the plan refers to (a mockup, a screenshot, reference docs) and link it to the stories that use it. Save files in the PRD folder, .prds/<prd file name without .json>/, first. get_story returns a story's attachments with their paths.",
      inputSchema: AddAttachmentInputSchema,
      outputSchema: AddAttachmentOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.addAttachment(AddAttachmentInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse('add_attachment', error);
      }
    },
  );

  server.registerTool(
    'remove_attachment',
    {
      title: 'Remove an attachment',
      description:
        'Remove an attachment from the PRD and from every story that uses it. The file itself is kept.',
      inputSchema: RemoveAttachmentInputSchema,
      outputSchema: RemoveAttachmentOutputSchema,
      annotations: DESTRUCTIVE_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.removeAttachment(
            RemoveAttachmentInputSchema.parse(input),
          ),
        );
      } catch (error) {
        return buildErrorResponse('remove_attachment', error);
      }
    },
  );

  server.registerTool(
    'update_prd_section',
    {
      title: 'Update a PRD section',
      description:
        'Change one section of a PRD after it was created: scope (nonGoals, outOfScope), assumptions, open questions, risks, edge cases (what can go wrong and what should happen), security considerations, design guidance, external dependencies, technical requirements and contracts (including permissions and compliance), global acceptance criteria, constraints, rollout and measurement plans, or the introduction, problem and solution. For risks, edge cases and security, think adversarially: assume things fail and that someone is actively trying to abuse the feature, and write down the specific failure or attack with what should happen.',
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
    'mark_not_applicable',
    {
      title: 'Mark a part of the PRD not applicable',
      description:
        'Mark an optional part of a PRD (dataModel, outsideServices, security, design, qualityBar, edgeCases, rollout, measurement, glossary, risks) as not applicable, with a reason, so the plan check stops asking for it and agents do not invent it. Pass notApplicable false to undo. Do not mark security or edgeCases not applicable for features that take input from people or store their data.',
      inputSchema: MarkNotApplicableInputSchema,
      outputSchema: MarkNotApplicableOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.markNotApplicable(
            MarkNotApplicableInputSchema.parse(input),
          ),
        );
      } catch (error) {
        return buildErrorResponse('mark_not_applicable', error);
      }
    },
  );

  server.registerTool(
    'resolve_open_question',
    {
      title: 'Answer an open question',
      description:
        'Answer an open question (by questionId, or by its exact text): it is removed from the PRD and, by default, the answer is recorded in the decision log.',
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
    'update_attachment',
    {
      title: 'Update an attachment',
      description:
        "Change an attachment's title or note, or which stories use it (storyIds: links are added and removed to match).",
      inputSchema: UpdateAttachmentInputSchema,
      outputSchema: UpdateAttachmentOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.updateAttachment(
            UpdateAttachmentInputSchema.parse(input),
          ),
        );
      } catch (error) {
        return buildErrorResponse('update_attachment', error);
      }
    },
  );

  server.registerTool(
    'decide_edge_case',
    {
      title: 'Decide an open edge case',
      description:
        'Record what should happen for an open edge case; it becomes decided and binding for the stories it applies to.',
      inputSchema: DecideEdgeCaseInputSchema,
      outputSchema: DecideEdgeCaseOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.decideEdgeCase(DecideEdgeCaseInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse('decide_edge_case', error);
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
    'architect_prd',
    {
      title: 'Architect a PRD',
      description:
        'Design the shape all stories share (data model, modules, entry points, test seams) before any is built, and record it in the PRD as the contract to build against.',
      argsSchema: {
        filename: z.string().describe('PRD file name inside .prds'),
      },
    },
    ({ filename }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: architectPrdPrompt(filename),
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
