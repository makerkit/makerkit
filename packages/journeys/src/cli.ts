import { finish } from '@makerkit/handoff/node';

import { refused, runJourney, stopStep } from './run';
import type {
  Journey,
  Locks,
  ProgressEvent,
  Prompter,
  RunInput,
} from './types';

type CliMode = 'check' | 'plan' | 'stop';

export type CliArgs = {
  journey?: string;
  json: boolean;
  // --check, --plan, --stop (with --step <id>), else apply; two at once is
  // refused
  modes: CliMode[];
  yes: boolean;
  step?: string;
  confirm: string[];
  // flags the engine doesn't know: a journey's own, or a typo
  other: string[];
};

// `<journey> [--check | --plan | --stop] [--yes] [--json] [--step <id>]
// [--confirm <id>[,<id>]]`
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    json: false,
    modes: [],
    yes: false,
    confirm: [],
    other: [],
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;

    if (arg === '--step') {
      args.step = argv[++index] ?? '';
    } else if (arg === '--confirm') {
      args.confirm.push(...(argv[++index] ?? '').split(',').filter(Boolean));
    } else if (arg === '--check' || arg === '--plan' || arg === '--stop') {
      args.modes.push(arg.slice(2) as CliMode);
    } else if (arg === '--json' || arg === '--yes') {
      args[arg.slice(2) as 'json' | 'yes'] = true;
    } else if (arg.startsWith('--')) {
      args.other.push(arg);
    } else {
      args.journey ??= arg;
    }
  }

  return args;
}

/**
 * The terminal side of a journey: argv in, the handoff result out (text or
 * --json), exit code from its status. Without a terminal nobody can answer a
 * prompt, so run-level steps need --yes.
 */
export async function runCli<D>({
  journeys,
  argv,
  depsFor,
  locks,
  interactive,
  prompter,
  signal,
  onProgress = printProgress,
  commands = {},
}: {
  journeys: Journey<D>[];
  argv: string[];
  depsFor: (journey: Journey<D>) => D;
  locks: Locks;
  interactive: boolean;
  prompter: Prompter;
  // Ctrl-C: the run stops after (or inside) the current step
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  // commands that aren't journeys (doctor), by name
  commands?: Record<string, (argv: string[]) => Promise<void>>;
}) {
  const args = parseCliArgs(argv);
  const command = args.journey ? commands[args.journey] : undefined;

  if (command) {
    await command(argv);

    return;
  }

  const journey = journeys.find((item) => item.id === args.journey);

  if (!journey) {
    finish({
      json: args.json,
      result: refused(
        undefined,
        `Unknown command "${args.journey ?? ''}": one of ${[...Object.keys(commands), ...journeys.map((j) => j.id)].join(', ')}.`,
      ),
    });

    return;
  }

  const unknown = args.other.filter((flag) => !journey.flags?.includes(flag));

  if (unknown.length > 0) {
    finish({
      json: args.json,
      result: refused(
        journey,
        `Unknown ${unknown.length === 1 ? 'flag' : 'flags'} ${unknown.join(', ')}: nothing ran. ${journey.command} takes --check, --plan, --stop, --yes, --json, --step <id>, --confirm <id>${journey.flags?.length ? `, ${journey.flags.join(', ')}` : ''}.`,
      ),
    });

    return;
  }

  if (args.modes.length > 1) {
    finish({
      json: args.json,
      result: refused(
        journey,
        `Pick one of --${args.modes.join(', --')}: they don't go together.`,
      ),
    });

    return;
  }

  const deps = depsFor(journey);
  const ctx = {
    deps,
    locks,
    prompter: interactive ? prompter : undefined,
    runConfirmed: args.yes,
    signal,
    onProgress,
  };
  const [mode = 'apply'] = args.modes;
  const input: RunInput = {
    mode: mode === 'stop' ? 'apply' : mode,
    step: args.step,
    confirm: args.confirm,
    surface: 'cli',
  };

  const result =
    mode === 'stop'
      ? await stopStep(journey, args.step, ctx)
      : await runJourney(journey, input, ctx);

  finish({ result, json: args.json, secrets: journey.secrets?.(deps) ?? [] });
}

// stderr, so --json keeps stdout to one JSON document
function printProgress({ title, index, total }: ProgressEvent) {
  process.stderr.write(`… [${index + 1}/${total}] ${title}\n`);
}
