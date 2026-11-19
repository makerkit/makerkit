import { z } from 'zod/v4';

// The data tools every Makerkit kit's MCP server registers, with one shape
// each across kits. Field names follow the first kits' tools (snake_case) so
// they migrate with few changes; what was kit-specific is open: services are
// keyed by id, the database tool is a name.

const CheckStatusSchema = z.enum(['pass', 'warn', 'fail']);

const DiagnosticSchema = z.object({
  id: z.string(),
  status: CheckStatusSchema,
  message: z.string(),
  remedies: z.array(z.string()).default([]),
});

// a local service the kit runs: app, database, mailbox, stripe listener, …
const ServiceSchema = z.object({
  name: z.string(),
  running: z.boolean(),
  port: z.number().nullable(),
  url: z.string().optional(),
});

export const KitStatusInputSchema = z.object({});

export const KitStatusOutputSchema = z.object({
  variant: z.string(),
  framework: z.string(),
  database: z.string(),
  auth: z.string(),
  project_name: z.string(),
  node_version: z.string(),
  package_manager: z.string(),
  deps_installed: z.boolean(),
  git_clean: z.boolean(),
  git_branch: z.string(),
  git_modified_files: z.array(z.string()),
  git_untracked_files: z.array(z.string()),
  services: z.record(z.string(), ServiceSchema),
  diagnostics: z.array(DiagnosticSchema),
});

export const KitPrerequisitesInputSchema = z.object({});

export const KitPrerequisiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  required: z.boolean(),
  required_for: z.string().optional(),
  installed: z.boolean(),
  version: z.string().nullable(),
  minimum_version: z.string().nullable(),
  status: CheckStatusSchema,
  install_url: z.string().optional(),
  install_command: z.string().optional(),
  message: z.string().optional(),
  remedies: z.array(z.string()).default([]),
});

export const KitPrerequisitesOutputSchema = z.object({
  prerequisites: z.array(KitPrerequisiteSchema),
  overall: CheckStatusSchema,
  ready_to_develop: z.boolean(),
});

const MigrationsSchema = z.object({
  applied: z.number(),
  pending: z.number(),
  pending_names: z.array(z.string()),
  // applied to the database but no longer in the repo (a migration deleted or
  // regenerated after it ran locally): the next migrate fails until a reset
  unknown_names: z.array(z.string()).optional(),
});

export const KitDbStatusInputSchema = z.object({});

export const KitDbStatusOutputSchema = z.object({
  connected: z.boolean(),
  // what manages migrations: 'void', 'drizzle-kit', 'supabase', 'prisma', …
  tool: z.string(),
  migrations: MigrationsSchema,
});

export const KitDbMigrateInputSchema = z.object({
  target: z.string().default('latest'),
});

export const KitDbMigrateOutputSchema = z.object({
  applied: z.array(z.string()),
  total_applied: z.number(),
  status: z.literal('success'),
});

// seed and reset replace local data: they run only with confirm: true
export const KitDbSeedInputSchema = z.object({
  confirm: z.boolean().default(false),
});

export const KitDbResetInputSchema = z.object({
  confirm: z.boolean().default(false),
});

const DoneSchema = z.object({
  status: z.literal('success'),
  message: z.string(),
});

export const KitDbSeedOutputSchema = DoneSchema;
export const KitDbResetOutputSchema = DoneSchema;

const DevServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['running', 'stopped', 'error']),
  port: z.number().nullable().optional(),
  url: z.string().optional(),
  pid: z.number().nullable().optional(),
  extras: z.record(z.string(), z.string()).optional(),
});

// service ids, or 'all'
const DevSelectionSchema = z.array(z.string()).min(1).default(['all']);

export const KitDevStartInputSchema = z.object({
  services: DevSelectionSchema,
});
export const KitDevStopInputSchema = z.object({ services: DevSelectionSchema });
export const KitDevStatusInputSchema = z.object({});

export const KitDevStartOutputSchema = z.object({
  services: z.array(DevServiceSchema),
});
export const KitDevStatusOutputSchema = KitDevStartOutputSchema;
export const KitDevStopOutputSchema = z.object({
  stopped: z.array(z.string()),
});

export const KitMailboxStatusInputSchema = z.object({});

export const KitMailboxStatusOutputSchema = z.object({
  connected: z.boolean(),
  running: z.boolean(),
  api_reachable: z.boolean(),
  url: z.string().optional(),
  port: z.number().optional(),
  reason: z.string().optional(),
});

// tool name → its schemas: what the contract test checks
export const KIT_TOOL_SCHEMAS = {
  kit_status: { input: KitStatusInputSchema, output: KitStatusOutputSchema },
  kit_prerequisites: {
    input: KitPrerequisitesInputSchema,
    output: KitPrerequisitesOutputSchema,
  },
  kit_db_status: {
    input: KitDbStatusInputSchema,
    output: KitDbStatusOutputSchema,
  },
  kit_db_migrate: {
    input: KitDbMigrateInputSchema,
    output: KitDbMigrateOutputSchema,
  },
  kit_db_seed: { input: KitDbSeedInputSchema, output: KitDbSeedOutputSchema },
  kit_db_reset: {
    input: KitDbResetInputSchema,
    output: KitDbResetOutputSchema,
  },
  kit_dev_start: {
    input: KitDevStartInputSchema,
    output: KitDevStartOutputSchema,
  },
  kit_dev_stop: {
    input: KitDevStopInputSchema,
    output: KitDevStopOutputSchema,
  },
  kit_dev_status: {
    input: KitDevStatusInputSchema,
    output: KitDevStatusOutputSchema,
  },
  kit_mailbox_status: {
    input: KitMailboxStatusInputSchema,
    output: KitMailboxStatusOutputSchema,
  },
} as const;

export type KitToolName = keyof typeof KIT_TOOL_SCHEMAS;
export type KitStatusOutput = z.input<typeof KitStatusOutputSchema>;
export type KitPrerequisitesOutput = z.input<
  typeof KitPrerequisitesOutputSchema
>;
export type KitDbStatusOutput = z.input<typeof KitDbStatusOutputSchema>;
export type KitDevStatusOutput = z.input<typeof KitDevStatusOutputSchema>;
