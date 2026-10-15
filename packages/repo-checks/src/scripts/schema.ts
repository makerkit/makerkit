import { z } from 'zod/v3';

export const ScriptCategorySchema = z.enum([
  'development',
  'build',
  'testing',
  'linting',
  'database',
  'maintenance',
  'environment',
]);

export const ScriptImportanceSchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
]);

export const ScriptInfoSchema = z.object({
  name: z.string(),
  command: z.string(),
  category: ScriptCategorySchema,
  description: z.string(),
  usage: z.string(),
  importance: ScriptImportanceSchema,
  /** True when the script belongs to the post-change verification loop. */
  healthcheck: z.boolean(),
  /** True when running the script rewrites files (lint:fix, format:fix). */
  mutates_files: z.boolean(),
});

export const GetScriptsInputSchema = z.object({});

export const GetScriptsOutputSchema = z.object({
  scripts: z.array(ScriptInfoSchema),
  total: z.number().int().min(0),
});

export const GetScriptDetailsInputSchema = z.object({
  scriptName: z.string().min(1),
});

export const GetScriptDetailsOutputSchema = ScriptInfoSchema;

export const GetHealthcheckScriptsInputSchema = z.object({});

export const GetHealthcheckScriptsOutputSchema = z.object({
  scripts: z.array(ScriptInfoSchema),
  /** Suggested order: check-only scripts first, then tests. */
  recommended_order: z.array(z.string()),
  note: z.string(),
});

export type ScriptInfo = z.infer<typeof ScriptInfoSchema>;
export type ScriptCategory = z.infer<typeof ScriptCategorySchema>;
export type ScriptImportance = z.infer<typeof ScriptImportanceSchema>;
export type GetScriptsOutput = z.infer<typeof GetScriptsOutputSchema>;
export type GetScriptDetailsInput = z.infer<typeof GetScriptDetailsInputSchema>;
export type GetHealthcheckScriptsOutput = z.infer<
  typeof GetHealthcheckScriptsOutputSchema
>;
