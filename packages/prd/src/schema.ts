import { z } from 'zod/v3';

import type { StructuredPRD } from './types';

const FilenameSchema = z
  .string()
  .min(1)
  .describe('PRD file name inside .prds, e.g. notes-feature.json');

export const StoryStatusSchema = z.enum([
  'not_started',
  'research',
  'in_progress',
  'review',
  'completed',
  'blocked',
]);

export const StoryPrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);

export const StoryComplexitySchema = z.enum(['XS', 'S', 'M', 'L', 'XL']);

export const PrdSummarySchema = z.object({
  filename: z.string(),
  title: z.string(),
  last_updated: z.string(),
  progress: z.number().int().min(0).max(100),
  total_stories: z.number().int().min(0),
  completed_stories: z.number().int().min(0),
  blocked_stories: z.number().int().min(0),
});

export const ListPrdsInputSchema = z.object({});

export const ListPrdsOutputSchema = z.object({
  prds: z.array(PrdSummarySchema),
  total: z.number().int().min(0),
  prds_dir: z.string(),
  /** Files that could not be read or parsed and were skipped. */
  warnings: z.array(z.string()),
});

export const GetPrdInputSchema = z.object({ filename: FilenameSchema });

export const GetPrdOutputSchema = z.object({
  filename: z.string(),
  path: z.string(),
  /** Full normalised PRD document. */
  prd: z.custom<StructuredPRD>(
    (value) => typeof value === 'object' && value !== null,
  ),
});

export const CreatePrdInputSchema = z.object({
  title: z.string().min(1),
  overview: z.string(),
  problemStatement: z.string(),
  marketOpportunity: z.string(),
  targetUsers: z.array(z.string()),
  solutionDescription: z.string(),
  keyFeatures: z.array(z.string()),
  successMetrics: z.array(z.string()),
  nonGoals: z.array(z.string()).optional(),
  outOfScope: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  openQuestions: z.array(z.string()).optional(),
});

export const CreatePrdOutputSchema = z.object({
  status: z.literal('success'),
  filename: z.string(),
  path: z.string(),
});

export const DeletePrdInputSchema = z.object({ filename: FilenameSchema });

export const DeletePrdOutputSchema = z.object({
  status: z.literal('success'),
  filename: z.string(),
});

export const AddUserStoryInputSchema = z.object({
  filename: FilenameSchema,
  userType: z.string().min(1),
  action: z.string().min(1),
  benefit: z.string().min(1),
  acceptanceCriteria: z.array(z.string()),
  priority: StoryPrioritySchema.default('P2'),
  /** Defaults to the first few words of `action`, which is rarely what you want. */
  title: z.string().min(1).optional(),
  /**
   * Defaults to a guess from the number of acceptance criteria — a measure of
   * how verbose the story is, not how hard it is. Set it explicitly.
   */
  estimatedComplexity: StoryComplexitySchema.optional(),
});

export const AddUserStoryOutputSchema = z.object({
  story_id: z.string(),
  title: z.string(),
  complexity: z.enum(['XS', 'S', 'M', 'L', 'XL']),
  total_stories: z.number().int().min(0),
});

export const UpdateStoryStatusInputSchema = z.object({
  filename: FilenameSchema,
  storyId: z.string().min(1),
  status: StoryStatusSchema,
  notes: z.string().optional(),
});

export const StoryVerificationSchema = z.object({
  verified_at: z.string(),
  checks: z.array(z.string()),
  passed: z.literal(true),
});

export const UpdateStoryStatusOutputSchema = z.object({
  story_id: z.string(),
  title: z.string(),
  status: StoryStatusSchema,
  progress: z.number().int().min(0).max(100),
  /** Present only when the story was marked completed and checks ran. */
  verification: StoryVerificationSchema.nullable(),
});

export const UpdateUserStoryInputSchema = z.object({
  filename: FilenameSchema,
  storyId: z.string().min(1),
  /** Every field is optional: only the ones supplied are changed. */
  title: z.string().min(1).optional(),
  userType: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  benefit: z.string().min(1).optional(),
  businessValue: z.string().min(1).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: StoryPrioritySchema.optional(),
  estimatedComplexity: StoryComplexitySchema.optional(),
  dependencies: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const UpdateUserStoryOutputSchema = z.object({
  story_id: z.string(),
  title: z.string(),
  updated_fields: z.array(z.string()),
  story: z.record(z.string(), z.unknown()),
});

export const DeleteUserStoryInputSchema = z.object({
  filename: FilenameSchema,
  storyId: z.string().min(1),
});

export const DeleteUserStoryOutputSchema = z.object({
  story_id: z.string(),
  title: z.string(),
  total_stories: z.number().int().min(0),
  progress: z.number().int().min(0).max(100),
  /** Stories that listed the deleted one as a dependency, now cleaned up. */
  dependency_references_removed: z.array(z.string()),
  phases_updated: z.array(z.string()),
});

export const CreateCustomPhaseInputSchema = z.object({
  filename: FilenameSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour such as #4f46e5')
    .default('#4f46e5'),
});

export const CustomPhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  order: z.number().int().min(0),
  user_story_ids: z.array(z.string()),
});

export const CreateCustomPhaseOutputSchema = z.object({
  phase: CustomPhaseSchema,
  total_phases: z.number().int().min(0),
});

export const AssignStoryToPhaseInputSchema = z.object({
  filename: FilenameSchema,
  storyId: z.string().min(1),
  /** Omit to remove the story from every phase. */
  phaseId: z.string().min(1).nullable().default(null),
});

export const AssignStoryToPhaseOutputSchema = z.object({
  story_id: z.string(),
  phase_id: z.string().nullable(),
  phase_name: z.string().nullable(),
  moved_from: z.string().nullable(),
});

export const ExportPrdMarkdownInputSchema = z.object({
  filename: FilenameSchema,
});

export const ExportPrdMarkdownOutputSchema = z.object({
  markdown_file: z.string(),
  path: z.string(),
});

export const GetImplementationPromptsInputSchema = z.object({
  filename: FilenameSchema,
});

export const GetImplementationPromptsOutputSchema = z.object({
  prompts: z.array(z.string()),
  total: z.number().int().min(0),
});

export const GetImprovementSuggestionsInputSchema = z.object({
  filename: FilenameSchema,
});

export const GetImprovementSuggestionsOutputSchema = z.object({
  suggestions: z.array(z.string()),
  total: z.number().int().min(0),
});

export const GetProjectStatusInputSchema = z.object({
  filename: FilenameSchema,
});

export const GetProjectStatusOutputSchema = z.object({
  progress: z.number().int().min(0).max(100),
  summary: z.string(),
  next_steps: z.array(z.string()),
  blockers: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      notes: z.string().nullable(),
    }),
  ),
  open_questions: z.array(z.string()),
  high_risks: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      mitigation: z.string(),
      owner: z.string(),
    }),
  ),
});

export type PrdSummary = z.infer<typeof PrdSummarySchema>;
export type ListPrdsOutput = z.infer<typeof ListPrdsOutputSchema>;
export type GetPrdInput = z.infer<typeof GetPrdInputSchema>;
export type GetPrdOutput = z.infer<typeof GetPrdOutputSchema>;
export type CreatePrdInput = z.infer<typeof CreatePrdInputSchema>;
export type CreatePrdOutput = z.infer<typeof CreatePrdOutputSchema>;
export type DeletePrdInput = z.infer<typeof DeletePrdInputSchema>;
export type DeletePrdOutput = z.infer<typeof DeletePrdOutputSchema>;
export type AddUserStoryInput = z.infer<typeof AddUserStoryInputSchema>;
export type AddUserStoryOutput = z.infer<typeof AddUserStoryOutputSchema>;
export type UpdateStoryStatusInput = z.infer<
  typeof UpdateStoryStatusInputSchema
>;
export type UpdateStoryStatusOutput = z.infer<
  typeof UpdateStoryStatusOutputSchema
>;
export type ExportPrdMarkdownInput = z.infer<
  typeof ExportPrdMarkdownInputSchema
>;
export type ExportPrdMarkdownOutput = z.infer<
  typeof ExportPrdMarkdownOutputSchema
>;
export type GetImplementationPromptsOutput = z.infer<
  typeof GetImplementationPromptsOutputSchema
>;
export type GetImprovementSuggestionsOutput = z.infer<
  typeof GetImprovementSuggestionsOutputSchema
>;
export type GetProjectStatusOutput = z.infer<
  typeof GetProjectStatusOutputSchema
>;
export type UpdateUserStoryInput = z.infer<typeof UpdateUserStoryInputSchema>;
export type UpdateUserStoryOutput = z.infer<typeof UpdateUserStoryOutputSchema>;
export type DeleteUserStoryInput = z.infer<typeof DeleteUserStoryInputSchema>;
export type DeleteUserStoryOutput = z.infer<typeof DeleteUserStoryOutputSchema>;
export type CreateCustomPhaseInput = z.infer<
  typeof CreateCustomPhaseInputSchema
>;
export type CreateCustomPhaseOutput = z.infer<
  typeof CreateCustomPhaseOutputSchema
>;
export type AssignStoryToPhaseInput = z.infer<
  typeof AssignStoryToPhaseInputSchema
>;
export type AssignStoryToPhaseOutput = z.infer<
  typeof AssignStoryToPhaseOutputSchema
>;
