import { z } from 'zod/v3';

export const DepsUpgradeAdvisorInputSchema = z.object({
  state: z
    .object({
      includeMajor: z.boolean().optional(),
      maxPackages: z.number().int().min(1).max(200).optional(),
      includeDevDependencies: z.boolean().optional(),
    })
    .optional(),
});

export const DepsUpgradeRecommendationSchema = z.object({
  package: z.string(),
  workspace: z.string(),
  dependency_type: z.string(),
  current: z.string(),
  wanted: z.string(),
  latest: z.string(),
  update_type: z.enum(['major', 'minor', 'patch', 'unknown']),
  risk: z.enum(['high', 'medium', 'low']),
  potentially_breaking: z.boolean(),
  recommended_target: z.string(),
  recommended_command: z.string(),
  reason: z.string(),
});

export const DepsUpgradeAdvisorOutputSchema = z.object({
  generated_at: z.string(),
  summary: z.object({
    total_outdated: z.number().int().min(0),
    recommended_now: z.number().int().min(0),
    major_available: z.number().int().min(0),
    minor_or_patch_available: z.number().int().min(0),
  }),
  recommendations: z.array(DepsUpgradeRecommendationSchema),
  grouped_commands: z.object({
    safe_batch_command: z.string().nullable(),
    major_batch_command: z.string().nullable(),
  }),
  warnings: z.array(z.string()),
});

export type DepsUpgradeAdvisorInput = z.infer<
  typeof DepsUpgradeAdvisorInputSchema
>;
export type DepsUpgradeRecommendation = z.infer<
  typeof DepsUpgradeRecommendationSchema
>;
export type DepsUpgradeAdvisorOutput = z.infer<
  typeof DepsUpgradeAdvisorOutputSchema
>;
