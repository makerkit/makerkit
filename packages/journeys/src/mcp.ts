import { HandoffResultSchema, type HandoffResult } from '@makerkit/handoff';
import { toToolResult } from '@makerkit/handoff/mcp';
import { KIT_TOOL_SCHEMAS } from '@makerkit/kit-tools';
import {
  READ_ONLY_TOOL,
  toolResult,
  type ToolServer,
} from '@makerkit/kit-tools/mcp';

import type { DoctorService } from './doctor';
import { runJourney, stopStep, toolNameOf } from './run';
import {
  DoctorInputSchema,
  JourneyToolInputSchema,
  JourneysListInputSchema,
  JourneysListOutputSchema,
} from './schema';
import type { Journey, JourneyScope, Locks, ProgressEvent } from './types';

export type JourneyToolsDeps<D> = {
  journeys: Journey<D>[];
  depsFor: (journey: Journey<D>) => D;
  locks: Locks;
  // the kit's own data tools beyond @makerkit/kit-tools' (exact names, or
  // a prefix ending in `_`, like `kit_env_`)
  reserved?: string[];
};

// the data tools' names (kit-tools) and this package's own: a name, or a
// prefix ending in `_`
const RESERVED = [
  ...Object.keys(KIT_TOOL_SCHEMAS),
  'kit_doctor',
  'kit_journeys',
];

const takes = (name: string, other: string) =>
  other.endsWith('_') ? name.startsWith(other) : name === other;

/**
 * One tool per journey (`kit_<id>`: check, plan or apply, one step or all)
 * and `kit_journeys`, the list the Console draws its cards from. Nobody can
 * answer a prompt over MCP: `step` confirmations come in `confirm`, and
 * `terminal` steps hand the owner the command to run themselves.
 */
export function registerJourneyTools<D>(
  server: ToolServer,
  deps: JourneyToolsDeps<D>,
) {
  for (const journey of deps.journeys) {
    const name = toolNameOf(journey);

    // a journey can't take a data tool's name (those may be allowed
    // without asking, a journey writes)
    if (
      [...RESERVED, ...(deps.reserved ?? [])].some((other) =>
        takes(name, other),
      )
    ) {
      throw new Error(
        `Journey "${journey.id}" would be ${name}, a name the kit's data tools use.`,
      );
    }

    const asksFirst = journey.steps.some((step) =>
      ['step', 'terminal'].includes(step.confirm.level),
    );

    server.registerTool(
      name,
      {
        description: `${journey.title}. mode check (default) reports each step, plan says what apply would change, apply runs the steps that aren't done, stop ends a step that keeps running (kind process, named in step). Relay nextSteps with actor human to the owner and call resumeWith after. Sends progress notifications when given a progressToken; cancelling stops the current step and starts no other.`,
        inputSchema: JourneyToolInputSchema,
        outputSchema: HandoffResultSchema,
        annotations: {
          // a journey of checks and the owner's steps changes nothing
          readOnlyHint: journey.steps.every((step) => !step.apply),
          destructiveHint: asksFirst,
          idempotentHint: true,
          openWorldHint: Boolean(journey.openWorld),
        },
      },
      async (raw: unknown, extra?: Extra) => {
        const input = JourneyToolInputSchema.parse(raw);
        const journeyDeps = deps.depsFor(journey);
        const ctx = {
          deps: journeyDeps,
          locks: deps.locks,
          runConfirmed: input.mode === 'apply',
          signal: extra?.signal,
          onProgress: progressOf(extra),
        };
        const { mode, step, confirm } = input;
        let result: HandoffResult;

        if (mode === 'stop') {
          result = await stopStep(journey, step, ctx);
        } else {
          result = await runJourney(
            journey,
            { mode, step, confirm, surface: 'mcp' },
            ctx,
          );
        }

        return toToolResult({
          result,
          secrets: journey.secrets?.(journeyDeps) ?? [],
        });
      },
    );
  }

  server.registerTool(
    'kit_journeys',
    {
      description:
        'The journeys this kit can run (set up, billing, deploy, …) with their steps, who acts on each and how each is confirmed. Call kit_<journey> with mode check for each step state.',
      inputSchema: JourneysListInputSchema,
      outputSchema: JourneysListOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      const journeys = deps.journeys.map((journey) => ({
        id: journey.id,
        title: journey.title,
        command: `pnpm ${journey.command}`,
        tool: toolNameOf(journey),
        scope: journey.scope ?? 'local',
        ...(journey.form && { form: journey.form }),
        steps: journey.steps.map((step) => ({
          id: step.id,
          title: step.title,
          actor: step.actor,
          confirm: step.confirm.level,
          kind: step.kind,
          onlyWhenNamed: Boolean(step.onlyWhenNamed),
          ...(step.input && { input: step.input }),
        })),
      }));

      return toolResult({ journeys });
    },
  );
}

// the part of the SDK's request extra the tools read, without the SDK's
// types: a kit's SDK and this package's needn't be one install
type Extra = {
  signal?: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification(notification: {
    method: 'notifications/progress';
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }): Promise<void>;
};

// MCP progress notifications, when the client asked for them
function progressOf(extra?: Extra) {
  const token = extra?._meta?.progressToken;

  if (token === undefined) {
    return undefined;
  }

  return ({ title, index, total }: ProgressEvent) => {
    void extra!
      .sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          progress: index,
          total,
          message: title,
        },
      })
      .catch(() => undefined);
  };
}

export function registerKitDoctorTool(
  server: ToolServer,
  service: DoctorService,
  {
    checks = 'this computer, the install and the settings',
  }: {
    // what the kit's own environment checks cover, for the description
    checks?: string;
  } = {},
) {
  const answer = (scope: JourneyScope) =>
    service
      .run({ scope, surface: 'mcp' })
      .then((value) =>
        toToolResult({ result: value, secrets: service.secrets() }),
      );
  // a run in flight is shared by the calls that arrive meanwhile; a finished
  // one never is, so a check right after a change sees it
  const running = new Map<JourneyScope, ReturnType<typeof answer>>();

  server.registerTool(
    'kit_doctor',
    {
      description: `Checks everything and changes nothing: ${checks}, then every journey in scope. Each step says who acts (agent or human) and the fix. Relay nextSteps with actor human to the owner; fix agent steps with the command named. scope: local (default), launch, prod.`,
      inputSchema: DoctorInputSchema,
      outputSchema: HandoffResultSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (raw: unknown) => {
      const { scope } = DoctorInputSchema.parse(raw ?? {});
      const shared = running.get(scope);

      if (shared) {
        return shared;
      }

      const result = answer(scope).finally(() => running.delete(scope));

      running.set(scope, result);

      return result;
    },
  );
}
