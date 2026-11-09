import { z } from 'zod/v4';

// who acts on a step or a next step: the coding agent, or the person who
// owns the project (log in, paste a secret in their own terminal, click Save)
export const ActorSchema = z.enum(['agent', 'human']);

/**
 * done: nothing left; needs-human: relay the human next steps, then run their
 * resumeWith; refused: a precondition stopped it before any change; failed:
 * something broke (see the summary)
 */
export const HandoffStatusSchema = z.enum([
  'done',
  'failed',
  'needs-human',
  'refused',
]);

// todo: not done yet (what a plan shows); waiting: needs a person
export const StepStateSchema = z.enum([
  'done',
  'todo',
  'waiting',
  'running',
  'skipped',
  'failed',
]);

export const StepResultSchema = z.object({
  // stable: `--step <id>` runs it alone
  id: z.string().min(1),
  title: z.string().min(1),
  state: StepStateSchema,
  actor: ActorSchema.default('agent'),
  message: z.string().optional(),
  // what applying it changes (a plan) or changed
  changes: z.array(z.string()).optional(),
  fix: z.string().optional(),
  url: z.url().optional(),
  // set when it runs only after an explicit yes: the question to ask
  confirm: z.string().optional(),
});

export const NextStepSchema = z.object({
  actor: ActorSchema,
  instructions: z.string().min(1),
  url: z.url().optional(),
  // the command (or tool call) to run once this is done
  resumeWith: z.string().optional(),
});

// the outside account a run acts on, shown before anything changes
export const AccountSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  name: z.string(),
  mode: z.string().optional(),
});

export const HandoffResultSchema = z.object({
  status: HandoffStatusSchema,
  journey: z.string().optional(),
  account: AccountSchema.optional(),
  steps: z.array(StepResultSchema),
  nextSteps: z.array(NextStepSchema),
  // plain English, for the agent to relay as is
  summary: z.string().min(1),
});

export type Actor = z.infer<typeof ActorSchema>;
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;
export type StepState = z.infer<typeof StepStateSchema>;
export type StepResult = z.input<typeof StepResultSchema>;
export type NextStep = z.infer<typeof NextStepSchema>;
export type HandoffAccount = z.infer<typeof AccountSchema>;
export type HandoffResult = z.input<typeof HandoffResultSchema>;

export const EXIT_CODES: Record<HandoffStatus, number> = {
  done: 0,
  failed: 1,
  'needs-human': 2,
  refused: 3,
};

// the contract as JSON Schema, for clients in any language
export function handoffJsonSchema() {
  return z.toJSONSchema(HandoffResultSchema, { io: 'input' });
}
