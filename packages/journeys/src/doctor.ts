import type { HandoffResult } from '@makerkit/handoff';
import { finish } from '@makerkit/handoff/node';

import { NO_LOCKS } from './locks';
import { handoff, refused, runJourney, statusOf, toolNameOf } from './run';
import type { Journey, JourneyScope } from './types';

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
};

// local: this computer; launch: + what going live needs; prod: the
// deployed app only (the local setup doesn't matter there)
const SCOPES: Record<JourneyScope, JourneyScope[]> = {
  local: ['local'],
  launch: ['local', 'launch'],
  prod: ['prod'],
};

/**
 * kit_doctor / `pnpm <its command>`: every check, nothing changed. The
 * environment (tools, packages, build, .env, database, ports, test
 * browser), then each journey in scope in its check mode: what's done,
 * what's left, who does it and how. CLI and MCP get the same result.
 */
export function createDoctorService<D, E>(deps: DoctorDeps<D, E>) {
  const { environment } = deps;
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

  return {
    async run({
      scope = 'local',
      surface,
    }: {
      scope?: JourneyScope;
      surface: Surface;
    }) {
      // the doctor's own checks resume by running it again
      const rerun = () => rerunCommand(environment, scope, surface);
      const journey = (item: Journey<D>, resume?: () => string) => ({
        journey: item as Journey<unknown>,
        deps: async () => deps.depsFor(item) as unknown,
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
        SCOPES[scope].includes(entry.journey.scope ?? 'local'),
      );

      const parts = await Promise.all(
        entries.map(async ({ journey, deps: load, resume, prefix }) => ({
          prefix,
          result: await runJourney(
            journey,
            { mode: 'check', surface, resume },
            { deps: await load(), locks: NO_LOCKS, runConfirmed: false },
          ),
        })),
      );

      return merge(parts, scope, environment);
    },
    secrets() {
      return deps.journeys.flatMap(
        (journey) => journey.secrets?.(deps.depsFor(journey)) ?? [],
      );
    },
  };
}

export type DoctorService = ReturnType<typeof createDoctorService>;

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

  if (open.length === 0) {
    return handoff(
      doctor,
      status,
      `Everything is ready (${checked}).`,
      steps,
      nextSteps,
    );
  }

  const summary = [`${open.length} of ${checked} need attention.`];

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

  return handoff(doctor, status, summary.join(' '), steps, nextSteps);
}

function rerunCommand(
  doctor: Pick<Journey<unknown>, 'id' | 'command'>,
  scope: JourneyScope,
  surface: Surface,
) {
  return surface === 'mcp'
    ? `${toolNameOf(doctor)} ${JSON.stringify(scope === 'local' ? {} : { scope })}`
    : `pnpm ${doctor.command}${scope === 'local' ? '' : ` --${scope}`}`;
}

// `pnpm <doctor command> [--launch | --prod] [--json]`: the same result in a terminal
export async function runDoctorCli(
  service: DoctorService,
  argv: string[],
  stdout?: Parameters<typeof finish>[0]['stdout'],
) {
  const json = argv.includes('--json');
  const scopes = (['launch', 'prod'] as const).filter((s) =>
    argv.includes(`--${s}`),
  );
  if (scopes.length > 1) {
    const result = refused(
      undefined,
      "Pick one of --launch or --prod: they don't go together.",
    );

    finish({ result, json, secrets: [], stdout });

    return;
  }

  const result = await service.run({
    scope: scopes[0] ?? 'local',
    surface: 'cli',
  });

  finish({ result, json, secrets: service.secrets(), stdout });
}
