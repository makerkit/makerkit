import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
} from '../schema';
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
}
