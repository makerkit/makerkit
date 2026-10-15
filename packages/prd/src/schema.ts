import { z } from 'zod/v3';

import { TEMPLATE_IDS } from './templates';
import type { StructuredPRD, UserStory } from './types';

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
  template: z
    .enum(TEMPLATE_IDS)
    .optional()
    .describe(
      'Start from a template (see list_templates). Values given here win.',
    ),
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
  testSeams: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Public entry points the tests exercise, e.g. a route or server action',
    ),
  dependencies: z
    .array(z.string().min(1))
    .optional()
    .describe('Ids of stories that must be completed first, e.g. ["US001"]'),
  phaseId: z
    .string()
    .min(1)
    .optional()
    .describe('Phase to put the story in, e.g. "PHASE002"'),
  attachmentIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Ids of PRD attachments this story uses, e.g. ["ATT001"]'),
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
  testSeams: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Public entry points the tests exercise, e.g. a route or server action',
    ),
  attachmentIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Ids of PRD attachments this story uses, e.g. ["ATT001"]'),
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

const StoryObjectSchema = z.custom<UserStory>(
  (value) => typeof value === 'object' && value !== null,
);

export const StoryLogEntrySchema = z.object({
  at: z.string(),
  whatsNew: z.array(z.string()),
  technicalNotes: z.array(z.string()),
  deviations: z.array(z.string()).optional(),
});

export const GetNextStoryInputSchema = z.object({ filename: FilenameSchema });

export const GetNextStoryOutputSchema = z.object({
  /** Null when nothing is ready: all done, in progress, or waiting. */
  story: StoryObjectSchema.nullable(),
  ready_count: z.number().int().min(0),
  in_progress: z.array(z.string()),
  waiting: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      waiting_on: z.array(z.string()),
    }),
  ),
});

export const GetStoryInputSchema = z.object({
  filename: FilenameSchema,
  storyId: z.string().min(1),
});

const StoryLogsSchema = z.array(StoryLogEntrySchema);

/** An attachment with its file path relative to the project root. */
export const StoryAttachmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string().optional(),
  url: z.string().optional(),
  note: z.string().optional(),
});

export const GetStoryOutputSchema = z.object({
  prd: z.object({
    title: z.string(),
    overview: z.string(),
    non_goals: z.array(z.string()),
    out_of_scope: z.array(z.string()),
    global_acceptance_criteria: z.array(z.string()),
    /** Every attachment in the PRD, for references shared across stories. */
    attachments: z.array(StoryAttachmentSchema),
  }),
  story: StoryObjectSchema,
  /** The attachments this story uses. */
  attachments: z.array(StoryAttachmentSchema),
  phase: z.object({ id: z.string(), name: z.string() }).nullable(),
  dependencies: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      log: StoryLogsSchema,
    }),
  ),
  previous_story: z
    .object({ id: z.string(), title: z.string(), log: StoryLogsSchema })
    .nullable(),
});

export const AddStoryLogInputSchema = z.object({
  filename: FilenameSchema,
  storyId: z.string().min(1),
  whatsNew: z
    .array(z.string().min(1))
    .min(1)
    .describe('What a person can now try, in plain language'),
  technicalNotes: z
    .array(z.string().min(1))
    .default([])
    .describe('Decisions, gotchas and file locations for the next agent'),
  deviations: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Where the work departed from the PRD and why: changed criteria, extra or skipped scope, a different approach',
    ),
});

export const AddStoryLogOutputSchema = z.object({
  story_id: z.string(),
  entries: z.number().int().min(1),
});

// Planning ------------------------------------------------------------------

const StringList = z.array(z.string().min(1));

/**
 * Accepted `value` for each `update_prd_section` section. Object sections are
 * merged (only the keys supplied change); list sections are replaced.
 */
export const PrdSectionValueSchemas = {
  introduction: z
    .object({ title: z.string().min(1), overview: z.string() })
    .partial()
    .strict(),
  problemStatement: z
    .object({
      problem: z.string(),
      marketOpportunity: z.string(),
      targetUsers: StringList,
    })
    .partial()
    .strict(),
  solutionOverview: z
    .object({
      description: z.string(),
      keyFeatures: StringList,
      successMetrics: StringList,
    })
    .partial()
    .strict(),
  nonGoals: StringList,
  outOfScope: StringList,
  assumptions: StringList,
  openQuestions: StringList,
  technicalRequirements: z
    .object({
      constraints: StringList,
      integrationNeeds: StringList,
      complianceRequirements: StringList,
    })
    .partial()
    .strict(),
  technicalContracts: z
    .object({
      apis: StringList,
      dataModels: StringList,
      permissions: StringList,
      integrationBoundaries: StringList,
    })
    .partial()
    .strict(),
  acceptanceCriteria: z
    .object({ global: StringList, qualityStandards: StringList })
    .partial()
    .strict(),
  constraints: z
    .object({
      timeline: z.string(),
      budget: z.string(),
      resources: StringList,
      nonNegotiables: StringList,
    })
    .partial()
    .strict(),
  rolloutPlan: z
    .object({
      featureFlags: StringList,
      migrationPlan: StringList,
      rolloutPhases: StringList,
      rollbackConditions: StringList,
    })
    .partial()
    .strict(),
  measurementPlan: z
    .object({
      events: StringList,
      dashboards: StringList,
      baselineMetrics: StringList,
      targetMetrics: StringList,
      guardrailMetrics: StringList,
    })
    .partial()
    .strict(),
  risks: z.array(
    z.object({
      id: z.string().optional(),
      description: z.string().min(1),
      mitigation: z.string(),
      owner: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
    }),
  ),
  dependencies: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      description: z.string(),
      blocking: z.boolean(),
      owner: z.string().optional(),
    }),
  ),
} as const;

export type PrdSection = keyof typeof PrdSectionValueSchemas;

const PRD_SECTIONS = Object.keys(PrdSectionValueSchemas) as [
  PrdSection,
  ...PrdSection[],
];

export const UpdatePrdSectionInputSchema = z.object({
  filename: FilenameSchema,
  section: z.enum(PRD_SECTIONS),
  value: z
    .unknown()
    .describe(
      'Object sections (introduction, problemStatement, solutionOverview, technicalRequirements, technicalContracts, acceptanceCriteria, constraints, rolloutPlan, measurementPlan) take an object and only the keys given change. List sections (nonGoals, outOfScope, assumptions, openQuestions) take a string array and replace the list. risks and dependencies take an array of items and replace the list; items without an id get one.',
    ),
});

export const UpdatePrdSectionOutputSchema = z.object({
  section: z.string(),
  updated: z.array(z.string()),
});

export const AddDecisionInputSchema = z.object({
  filename: FilenameSchema,
  decision: z.string().min(1),
  rationale: z.string().min(1),
  owner: z.string().optional(),
  topic: z
    .string()
    .optional()
    .describe('What it is about, e.g. "story:US003" or "billing"'),
  status: z.enum(['proposed', 'accepted']).default('accepted'),
  supersedes: z
    .string()
    .optional()
    .describe('Id of an earlier decision this one replaces'),
});

export const AddDecisionOutputSchema = z.object({
  decision_id: z.string(),
  superseded: z.string().nullable(),
  total_decisions: z.number().int().min(1),
});

export const AddAttachmentInputSchema = z.object({
  filename: FilenameSchema,
  title: z.string().min(1).describe('What it is, e.g. "Approve view mockup"'),
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      'File inside the PRD folder (.prds/<prd name>/), relative to it, e.g. "mockups/approve.png". Save the file there first. Give path or url, not both.',
    ),
  url: z
    .string()
    .url()
    .optional()
    .describe('A web page or document link. Give path or url, not both.'),
  note: z
    .string()
    .min(1)
    .optional()
    .describe(
      'What to take from it, e.g. "Layout only; colours are placeholders"',
    ),
  storyIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Stories that use it, e.g. ["US003"]'),
});

export const AddAttachmentOutputSchema = z.object({
  attachment_id: z.string(),
  /** The file relative to the project root, or null for a link. */
  path: z.string().nullable(),
  stories_updated: z.array(z.string()),
  total_attachments: z.number().int().min(1),
});

export const RemoveAttachmentInputSchema = z.object({
  filename: FilenameSchema,
  attachmentId: z.string().min(1),
});

export const RemoveAttachmentOutputSchema = z.object({
  attachment_id: z.string(),
  stories_updated: z.array(z.string()),
  total_attachments: z.number().int().min(0),
});

export const ResolveOpenQuestionInputSchema = z.object({
  filename: FilenameSchema,
  question: z
    .string()
    .min(1)
    .describe('The open question, exactly as listed in the PRD'),
  answer: z.string().min(1),
  recordDecision: z
    .boolean()
    .default(true)
    .describe('Also add the answer to the decision log'),
});

export const ResolveOpenQuestionOutputSchema = z.object({
  remaining_questions: z.number().int().min(0),
  decision_id: z.string().nullable(),
});

export const AddGlossaryTermInputSchema = z.object({
  filename: FilenameSchema,
  term: z.string().min(1),
  definition: z.string().min(1),
  avoid: z
    .array(z.string().min(1))
    .default([])
    .describe('Synonyms that should not be used for this concept'),
});

export const AddGlossaryTermOutputSchema = z.object({
  term: z.string(),
  replaced: z.boolean(),
  total_terms: z.number().int().min(1),
});

export const UpdatePhaseInputSchema = z.object({
  filename: FilenameSchema,
  phaseId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour such as #4f46e5')
    .optional(),
});

export const DeletePhaseInputSchema = z.object({
  filename: FilenameSchema,
  phaseId: z.string().min(1),
});

export const ReorderPhasesInputSchema = z.object({
  filename: FilenameSchema,
  phaseIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Every phase id, in the new order'),
});

export const PhasesOutputSchema = z.object({
  phases: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      order: z.number().int().min(0),
      user_story_ids: z.array(z.string()),
    }),
  ),
});

export const CheckPlanInputSchema = z.object({ filename: FilenameSchema });

export const CheckPlanOutputSchema = z.object({
  /** False while any required item is open. */
  ready_to_build: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      section: z.string(),
      message: z.string(),
      severity: z.enum(['required', 'recommended']),
      storyIds: z.array(z.string()).optional(),
    }),
  ),
});

export type CheckPlanOutput = z.infer<typeof CheckPlanOutputSchema>;

export const ListTemplatesInputSchema = z.object({});

export const ListTemplatesOutputSchema = z.object({
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      when_to_use: z.string(),
    }),
  ),
});

export type ListTemplatesOutput = z.infer<typeof ListTemplatesOutputSchema>;

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
export type GetNextStoryOutput = z.infer<typeof GetNextStoryOutputSchema>;
export type GetStoryInput = z.infer<typeof GetStoryInputSchema>;
export type GetStoryOutput = z.infer<typeof GetStoryOutputSchema>;
export type AddStoryLogInput = z.infer<typeof AddStoryLogInputSchema>;
export type AddStoryLogOutput = z.infer<typeof AddStoryLogOutputSchema>;
export type UpdatePrdSectionInput = z.infer<typeof UpdatePrdSectionInputSchema>;
export type UpdatePrdSectionOutput = z.infer<
  typeof UpdatePrdSectionOutputSchema
>;
export type AddDecisionInput = z.infer<typeof AddDecisionInputSchema>;
export type AddDecisionOutput = z.infer<typeof AddDecisionOutputSchema>;
export type AddAttachmentInput = z.infer<typeof AddAttachmentInputSchema>;
export type AddAttachmentOutput = z.infer<typeof AddAttachmentOutputSchema>;
export type RemoveAttachmentInput = z.infer<typeof RemoveAttachmentInputSchema>;
export type RemoveAttachmentOutput = z.infer<
  typeof RemoveAttachmentOutputSchema
>;
export type StoryAttachment = z.infer<typeof StoryAttachmentSchema>;
export type ResolveOpenQuestionInput = z.infer<
  typeof ResolveOpenQuestionInputSchema
>;
export type ResolveOpenQuestionOutput = z.infer<
  typeof ResolveOpenQuestionOutputSchema
>;
export type AddGlossaryTermInput = z.infer<typeof AddGlossaryTermInputSchema>;
export type AddGlossaryTermOutput = z.infer<typeof AddGlossaryTermOutputSchema>;
export type UpdatePhaseInput = z.infer<typeof UpdatePhaseInputSchema>;
export type DeletePhaseInput = z.infer<typeof DeletePhaseInputSchema>;
export type ReorderPhasesInput = z.infer<typeof ReorderPhasesInputSchema>;
export type PhasesOutput = z.infer<typeof PhasesOutputSchema>;
