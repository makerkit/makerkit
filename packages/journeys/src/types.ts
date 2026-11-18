import type {
  Actor,
  HandoffAccount,
  HandoffResult,
  StepResult,
} from '@makerkit/handoff';

/**
 * How a step that changes something is confirmed:
 * - none: never asked
 * - run: once for the run (`--yes`, MCP mode apply, or a prompt yes)
 * - step: by name (`--confirm <id>`, MCP `confirm: [id]`, or a prompt yes);
 *   `--yes` never covers it (local destructive steps: seed, reset)
 * - terminal: only a prompt yes in the owner's own terminal (live and
 *   production writes); elsewhere it hands the exact command to the owner
 */
export const CONFIRM_LEVELS = ['none', 'run', 'step', 'terminal'] as const;
export type ConfirmLevel = (typeof CONFIRM_LEVELS)[number];
export type Confirm = { level: ConfirmLevel; question?: string };

// process: keeps running once applied (it has a stop()); check: only
// checked here, the agent runs the named fix (kit:doctor); task: the rest
export const STEP_KINDS = ['task', 'process', 'check'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

// what check() found: done, or why not
export type CheckResult = {
  state: 'done' | 'todo' | 'waiting' | 'failed';
  message?: string;
  changes?: string[];
  fix?: string;
  url?: string;
  // the id of the journey whose form or run fixes this (a client can open it)
  journey?: string;
  // how the owner carries on, when it isn't running this step again (a
  // command with values only they have)
  resumeWith?: string;
  // a process step's process: what a status view shows (not in the result)
  process?: { pid?: number; port?: number };
};

// signal: aborted when the run is cancelled (Ctrl-C, MCP cancel);
// prompter: the owner at their terminal, when someone is there to answer
// (not under --yes, never over MCP)
export type StepContext<D> = {
  deps: D;
  signal: AbortSignal;
  prompter?: Prompter;
};

// a value the owner can give this step from a client (the Makerkit Console):
// saved through the kit's env tool, so a client never reads .env. `accept` is
// a RegExp source the kit applies to the value (e.g. '^sk_test_').
export type StepInput = {
  env: string;
  label: string;
  secret: boolean;
  accept: string;
};

export type StepDefinition<D> = {
  // stable: `--step <id>` and MCP `step` name it
  id: string;
  title: string;
  // human: only check() (the owner acts; the step waits)
  actor?: Actor;
  confirm?: Confirm;
  check(ctx: StepContext<D>): Promise<CheckResult>;
  apply?(ctx: StepContext<D>): Promise<void>;
  // ends what apply() started: makes it a process step
  stop?: (ctx: StepContext<D>) => Promise<void>;
  // left out unless named (`--step <id>`): slow proofs, a process to start
  // on request
  onlyWhenNamed?: boolean;
  // earlier steps it builds on: until they're done it reports todo
  // ("waits for …") without being checked
  needs?: string[];
  // a value a client can collect for this step (a test key)
  input?: StepInput;
};

export type Step<D> = StepDefinition<D> &
  Required<Pick<StepDefinition<D>, 'actor' | 'confirm'>> & { kind: StepKind };

// where a journey runs, a non-empty id. Well known: local, this computer
// (default); launch, before going live (the doctor's launch adds local);
// prod, the deployed app. A kit may add its own (staging): the doctor runs
// it with `--staging` / `scope: 'staging'`
export const JOURNEY_SCOPES = ['local', 'launch', 'prod'] as const;
export type JourneyScope = (typeof JOURNEY_SCOPES)[number] | (string & {});

export type JourneyForm = { save: string; read?: string };

export type Journey<D> = {
  id: string;
  title: string;
  scope?: JourneyScope;
  // the pnpm script that runs it, e.g. 'kit:setup'
  command: string;
  steps: Step<D>[];
  // every secret a run could print, masked from its result
  secrets?(deps: D): string[];
  // CLI flags of its own (`--use-cli-key`); any other unknown flag is refused
  flags?: string[];
  // it talks to an outside service (a payment provider, a host): MCP openWorldHint
  openWorld?: boolean;
  // a form that collects what its steps need (the Makerkit Console): the
  // kit's data tools that save it and, optionally, read what's saved
  form?: JourneyForm;
  // the outside account it acts on, shown on every result
  account?: (deps: D) => Promise<HandoffAccount | undefined>;
  // its own summary and next steps for a run
  finalize?: (
    result: HandoffResult,
    run: { input: RunInput; deps: D },
  ) => Promise<HandoffResult>;
};

/**
 * check: report every step, change nothing; plan: the same, saying what
 * apply would do; apply: run the steps that aren't done, in order
 */
export type RunMode = 'check' | 'plan' | 'apply';

export type RunInput = {
  mode: RunMode;
  // only this step (its earlier steps must be done)
  step?: string;
  // step ids confirmed by name (`step` level)
  confirm?: string[];
  // where the run came from: decides how resumeWith is written
  surface: 'cli' | 'mcp';
  // writes resumeWith instead of `<runner> <command> --step <id> …`
  // (kit:doctor resumes by running itself again)
  resume?: (step: { id: string }) => string;
  // what runs a journey's script in commands it hands out: 'pnpm' (default),
  // 'npm run', 'yarn', 'bun run'
  runner?: string;
};

export type Answer = 'yes' | 'no' | 'skip';

// asks in the owner's terminal; absent when nobody can answer (MCP, no TTY)
export type Prompter = {
  confirm(question: string): Promise<Answer>;
  // typed without echo (a secret key)
  secret(question: string): Promise<string>;
};

export type Locks = {
  // takes `key` unless it or one of `conflicts` is held by a live process
  acquire(input: {
    key: string;
    conflicts: string[];
  }): Promise<
    | { ok: true; release(): Promise<void> }
    | { ok: false; holder: { key: string; pid: number } }
  >;
};

// sent before a step is applied: `index` steps come before it
export type ProgressEvent = {
  step: string;
  title: string;
  index: number;
  total: number;
};

export type RunContext<D> = {
  deps: D;
  onProgress?: (event: ProgressEvent) => void;
  // cancels the run: the current step gets it, no further step starts
  signal?: AbortSignal;
  locks: Locks;
  // a terminal prompter; `--yes` keeps it for step/terminal confirmations
  prompter?: Prompter;
  // `--yes` on the CLI, MCP mode apply: run-level steps need no prompt
  runConfirmed: boolean;
};

export type { HandoffResult, StepResult };
