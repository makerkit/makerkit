import { z } from 'zod/v4';

import { ActorSchema } from '@makerkit/handoff';

import { CONFIRM_LEVELS, JOURNEY_SCOPES, STEP_KINDS } from './types';

export const JourneyToolInputSchema = z.object({
  // check: report, change nothing; plan: what apply would do; apply: run
  // it; stop: end the process step named in `step`
  mode: z.enum(['check', 'plan', 'apply', 'stop']).default('check'),
  step: z.string().optional(),
  // ids of `step`-level steps the owner said yes to
  confirm: z.array(z.string()).optional(),
});

export const JourneysListInputSchema = z.object({});

export const JourneysListOutputSchema = z.object({
  journeys: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      command: z.string(),
      tool: z.string(),
      scope: z.enum(JOURNEY_SCOPES),
      // its form's data tools (save, and read for what's saved): a client
      // offers the form only when it lists them
      form: z.object({ save: z.string(), read: z.string().optional() }).optional(),
      steps: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          actor: ActorSchema,
          // process: keeps running once applied; kit_<journey> mode stop ends it
          kind: z.enum(STEP_KINDS),
          confirm: z.enum(CONFIRM_LEVELS),
          // left out of a run unless named in `step` (a proof, a process)
          onlyWhenNamed: z.boolean(),
        }),
      ),
    }),
  ),
});

export const DoctorInputSchema = z.object({
  // local (default): this computer; launch: + going live; prod: the live app
  scope: z.enum(JOURNEY_SCOPES).default('local'),
});
