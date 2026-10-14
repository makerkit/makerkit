import { z } from 'zod/v3';

const CheckOptionsShape = {
  scripts: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Root package.json scripts to run. Defaults to typecheck, lint and format (check-only).',
    ),
  includeTests: z
    .boolean()
    .optional()
    .describe('Also run the "test" script after the other checks.'),
  fix: z
    .boolean()
    .optional()
    .describe(
      'Run the auto-fixing variants (lint:fix, format:fix) instead of check-only lint/format. Mutates files.',
    ),
  failFast: z
    .boolean()
    .optional()
    .describe('Stop after the first failing script.'),
  maxOutputChars: z
    .number()
    .int()
    .min(200)
    .max(20000)
    .optional()
    .describe(
      'Maximum raw stdout/stderr characters kept per check. Parsed diagnostics are never truncated.',
    ),
};

const CheckOptionsSchema = z.object(CheckOptionsShape);

export const RunChecksInputSchema = z.object({
  ...CheckOptionsShape,
  /** @deprecated Pass options at the top level. Kept for older clients. */
  state: CheckOptionsSchema.optional(),
});

export const DiagnosticSeveritySchema = z.enum(['error', 'warning', 'info']);

export const DiagnosticSourceSchema = z.enum([
  'tsc',
  'oxlint',
  'oxfmt',
  'vitest',
]);

export const DiagnosticSchema = z.object({
  source: DiagnosticSourceSchema,
  severity: DiagnosticSeveritySchema,
  file: z.string(),
  line: z.number().int().min(1).nullable(),
  column: z.number().int().min(1).nullable(),
  rule: z.string().nullable(),
  message: z.string(),
  /** Workspace package the diagnostic came from, when turbo prefixed it. */
  package: z.string().nullable(),
});

export const RunChecksResultSchema = z.object({
  script: z.string(),
  command: z.string(),
  status: z.enum(['pass', 'fail', 'missing', 'skipped']),
  exit_code: z.number().int().nullable(),
  duration_ms: z.number().int().min(0),
  diagnostics: z.array(DiagnosticSchema),
  stdout: z.string(),
  stderr: z.string(),
  message: z.string().optional(),
});

export const RunChecksOutputSchema = z.object({
  overall: z.enum(['pass', 'fail']),
  mode: z.enum(['check', 'fix']),
  scripts_requested: z.array(z.string()),
  checks: z.array(RunChecksResultSchema),
  /** Flattened diagnostics across every check, errors first. */
  diagnostics: z.array(DiagnosticSchema),
  summary: z.object({
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    missing: z.number().int().min(0),
    skipped: z.number().int().min(0),
    errors: z.number().int().min(0),
    warnings: z.number().int().min(0),
  }),
});

export type RunChecksInput = z.infer<typeof RunChecksInputSchema>;
export type RunChecksOptions = z.infer<typeof CheckOptionsSchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export type DiagnosticSource = z.infer<typeof DiagnosticSourceSchema>;
export type RunChecksResult = z.infer<typeof RunChecksResultSchema>;
export type RunChecksOutput = z.infer<typeof RunChecksOutputSchema>;
