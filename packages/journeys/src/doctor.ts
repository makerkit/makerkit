import type { HandoffResult } from '@makerkit/handoff';

import {
  commandLine,
  DEFAULT_RUNNER,
  handoff,
  NO_LOCKS,
  refused,
  runJourney,
  statusOf,
  toolNameOf,
} from './run';
import { JOURNEY_SCOPES, type Journey, type JourneyScope } from './types';

type Surface = 'cli' | 'mcp';

export type DoctorDeps<D, E> = {
  environment: Journey<E>;
  // fresh for each run (its reads are shared by that run's checks)
  environmentDeps: () => Promise<E>;
  // journeys with a tool of their own: their owner steps resume with it
  journeys: Journey<D>[];
  // check-only journeys only the doctor runs (launch placeholders): their
  // owner steps resume by running the doctor again
  checks?: Journey<D>[];
  depsFor: (journey: Journey<D>) => D;
  // what runs the doctor's script in the commands it hands out (default pnpm)
  runner?: string;
};

export type DoctorService = {
  run(input: {
    scope?: JourneyScope;
    surface: Surface;
  }): Promise<HandoffResult>;
  // every journey's secrets, masked from a result
  secrets(): string[];
  // the scopes it runs: the well-known ones and every journey's own
  scopes(): JourneyScope[];
};

// launch: + what going live needs; any other scope (local, prod, a kit's
// own like staging) only its own journeys
const coveredBy = (scope: JourneyScope) => {
  if (scope === 'launch') {
    return ['local', 'launch'];
  }

  return [scope];
};

/**
 * kit_doctor / `pnpm <its command>`: every check, nothing changed. The
 * environment (tools, packages, build, .env, database, ports, test
 * browser), then each journey in scope in its check mode: what's done,
 * what's left, who does it and how. CLI and MCP get the same result.
 */
export function createDoctorService<D, E>(
  deps: DoctorDeps<D, E>,
): DoctorService {
  const { environment, runner = DEFAULT_RUNNER } = deps;
  const { id, secrets } = environment;

  // the tool is kit_doctor and its owner steps resume with it
  if (id !== 'doctor') {
    throw new Error(
      `The doctor's environment journey must have id "doctor", not "${id}".`,
    );
  }

  // only the journeys' secrets are masked: the environment checks print none
  if (secrets) {
    throw new Error(
      "The doctor's environment checks must not print secrets: report key names, never values.",
    );
  }

  const all = [environment, ...deps.journeys, ...(deps.checks ?? [])];
  const scopes = [
    ...new Set([
      ...JOURNEY_SCOPES,
      ...all.map((item) => item.scope ?? 'local'),
    ]),
  ];

  return {
    scopes: () => scopes,
    async run({ scope = 'local', surface }) {
      if (!scopes.includes(scope)) {
        return refused(
          environment,
          `There's no scope "${scope}": one of ${scopes.join(', ')}.`,
        );
      }

      // the doctor's own checks resume by running it again
      const rerun = () =>
        rerunCommand({ doctor: environment, scope, surface, runner });
      // its secrets are read up front: a journey whose secrets can't be
      // masked shows none of its steps
      const journey = (item: Journey<D>, resume?: () => string) => ({
        journey: item as Journey<unknown>,
        deps: async () => {
          const loaded = deps.depsFor(item);

          item.secrets?.(loaded);

          return loaded as unknown;
        },
        prefix: `${item.id}.`,
        resume,
      });
      const entries = [
        {
          journey: environment as Journey<unknown>,
          deps: () => deps.environmentDeps(),
          prefix: '',
          resume: rerun,
        },
        ...deps.journeys.map((item) => journey(item)),
        ...(deps.checks ?? []).map((item) => journey(item, rerun)),
      ].filter((entry) =>
        coveredBy(scope).includes(entry.journey.scope ?? 'local'),
      );

      // one journey that throws is one failed step; the others still report
      const parts = await Promise.all(
        entries.map(async ({ journey, deps: load, resume, prefix }) => {
          try {
            const result = await runJourney(
              journey,
              { mode: 'check', surface, resume, runner },
              { deps: await load(), locks: NO_LOCKS, runConfirmed: false },
            );

            return { prefix, result };
          } catch (error) {
            return { prefix, result: brokenOf(journey, error) };
          }
        }),
      );

      return merge(parts, scope, environment);
    },
    secrets() {
      return [...deps.journeys, ...(deps.checks ?? [])].flatMap((journey) => {
        try {
          return journey.secrets?.(deps.depsFor(journey)) ?? [];
        } catch {
          return [];
        }
      });
    },
  };
}

function brokenOf(journey: Journey<unknown>, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);

  return handoff(journey, 'failed', '', [
    {
      id: 'journey',
      title: journey.title,
      actor: 'agent',
      state: 'failed',
      message: `${journey.title} could not be checked: ${reason}`,
    },
  ]);
}

function merge(
  parts: { prefix: string; result: HandoffResult }[],
  scope: JourneyScope,
  doctor: Pick<Journey<unknown>, 'id' | 'command'>,
) {
  const steps = parts.flatMap(({ prefix, result }) =>
    result.steps.map((step) => ({ ...step, id: `${prefix}${step.id}` })),
  );
  const nextSteps = parts.flatMap(({ result }) => result.nextSteps);
  // skipped: run only on request (forwarding, a proof), nobody's to do
  const counted = steps.filter((step) => step.state !== 'skipped');
  const open = counted.filter((step) => step.state !== 'done');
  const forOwner = open.filter((step) => step.actor === 'human').length;
  const forAgent = open.length - forOwner;
  const checked = `${counted.length} checks${scope === 'local' ? '' : ` (${scope})`}`;

  const status = statusOf(steps, nextSteps);
  const remaining = open.length;

  if (remaining === 0) {
    return {
      ...handoff(
        doctor,
        status,
        `Everything is ready (${checked}).`,
        steps,
        nextSteps,
      ),
      remaining,
    };
  }

  const summary = [`${remaining} of ${checked} need attention.`];

  if (forOwner > 0) {
    summary.push(
      `${forOwner} ${forOwner === 1 ? 'needs' : 'need'} you (below).`,
    );
  }

  if (forAgent > 0) {
    summary.push(
      `${forAgent} your agent can fix: ask it to "fix what ${doctor.command} found".`,
    );
  }

  summary.push('Nothing was changed.');

  return {
    ...handoff(doctor, status, summary.join(' '), steps, nextSteps),
    remaining,
  };
}

function rerunCommand({
  doctor,
  scope,
  surface,
  runner,
}: {
  doctor: Pick<Journey<unknown>, 'id' | 'command'>;
  scope: JourneyScope;
  surface: Surface;
  runner: string;
}) {
  if (surface === 'mcp') {
    return `${toolNameOf(doctor)} ${JSON.stringify(scope === 'local' ? {} : { scope })}`;
  }

  const command = commandLine(runner, doctor.command);

  return scope === 'local' ? command : `${command} --${scope}`;
}
