import {
  humanStep,
  type HandoffResult,
  type NextStep,
  type StepResult,
} from '@makerkit/handoff';

import type {
  Answer,
  CheckResult,
  Journey,
  Locks,
  RunContext,
  RunInput,
  Step,
} from './types';

// for runs that never write (check, plan): they never take a lock
export const NO_LOCKS: Locks = {
  acquire: async () => ({ ok: true, release: async () => undefined }),
};

/**
 * Runs a journey: checks every step and, in apply mode, applies the ones
 * that aren't done, in order, honouring each step's confirm level, then
 * checks it again. One semantic for the CLI, MCP and the Console.
 */
export async function runJourney<D>(
  journey: Journey<D>,
  input: RunInput,
  ctx: RunContext<D>,
): Promise<HandoffResult> {
  const only = input.step;

  if (only !== undefined && !journey.steps.some((step) => step.id === only)) {
    const ids = journey.steps.map((s) => s.id).join(', ');

    if (only === '') {
      return refused(journey, `A step needs a step id: one of ${ids}.`);
    }

    return refused(
      journey,
      `There's no step "${only}" in ${journey.command}: one of ${ids}.`,
    );
  }

  let result: HandoffResult;

  if (input.mode === 'apply') {
    result = await withLock(journey, only, ctx, () =>
      apply(journey, input, ctx),
    );
  } else {
    result = await report(journey, input, ctx);
  }

  const withAccount = await addAccount(journey, result, ctx.deps);

  if (!journey.finalize) {
    return withAccount;
  }

  return journey.finalize(withAccount, { input, deps: ctx.deps });
}

// the outside account the journey acts on, on every result
async function addAccount<D>(
  journey: Journey<D>,
  result: HandoffResult,
  deps: D,
) {
  const account = await journey.account?.(deps).catch(() => undefined);

  return account ? { ...result, account } : result;
}

/**
 * Ends a step that keeps running (kind process), then checks it: stopped
 * means the check no longer says done.
 */
export async function stopStep<D>(
  journey: Journey<D>,
  id: string | undefined,
  ctx: RunContext<D>,
): Promise<HandoffResult> {
  const step = journey.steps.find(
    (item) => item.id === id && item.kind === 'process',
  );

  if (!step) {
    const stoppable = journey.steps.filter((s) => s.kind === 'process');

    return refused(
      journey,
      `Only a step that keeps running can be stopped: one of ${stoppable.map((s) => s.id).join(', ') || '(none here)'}.`,
    );
  }

  const result = await withLock(journey, step.id, ctx, async () => {
    const outcome = (
      status: HandoffResult['status'],
      found: CheckResult,
      summary: string,
    ) => handoff(journey, status, summary, [resultOf(step, found)]);

    try {
      await step.stop?.(stepContext(ctx));
    } catch (error) {
      return outcome(
        'failed',
        { state: 'failed', message: messageOf(error) },
        `${journey.title}: could not stop "${step.title}": ${messageOf(error)}.`,
      );
    }

    const after = await checkSafely(step, ctx);

    if (after.state !== 'done') {
      return outcome(
        'done',
        after,
        `${journey.title}: "${step.title}" stopped.`,
      );
    }

    return outcome(
      'failed',
      {
        ...after,
        state: 'failed',
        message: `stopped but still running: ${after.message ?? ''}`,
      },
      `${journey.title}: "${step.title}" is still running.`,
    );
  });

  return addAccount(journey, result, ctx.deps);
}

// a full run locks the journey; one step locks that step (and waits on a full run)
async function withLock<D>(
  journey: Journey<D>,
  only: string | undefined,
  ctx: RunContext<D>,
  run: () => Promise<HandoffResult>,
) {
  const lock = await ctx.locks.acquire(
    only
      ? { key: `${journey.id}.${only}`, conflicts: [journey.id] }
      : {
          key: journey.id,
          conflicts: journey.steps.map((step) => `${journey.id}.${step.id}`),
        },
  );

  if (!lock.ok) {
    return refused(
      journey,
      `${journey.command} is already running (process ${lock.holder.pid}). Wait for it to finish, then run it again.`,
    );
  }

  try {
    return await run();
  } finally {
    await lock.release();
  }
}

// failed beats a person's turn, which beats done
export function statusOf(
  steps: StepResult[],
  nextSteps: NextStep[],
): HandoffResult['status'] {
  if (steps.some((s) => s.state === 'failed')) {
    return 'failed';
  }

  if (nextSteps.length > 0) {
    return 'needs-human';
  }

  return 'done';
}

export function handoff(
  journey: Pick<Journey<unknown>, 'id'> | undefined,
  status: HandoffResult['status'],
  summary: string,
  steps: StepResult[] = [],
  nextSteps: NextStep[] = [],
): HandoffResult {
  return { status, journey: journey?.id, steps, nextSteps, summary };
}

export const refused = (
  journey: Pick<Journey<unknown>, 'id'> | undefined,
  summary: string,
) => handoff(journey, 'refused', summary);

// check or plan: every step's state, nothing changes
async function report<D>(
  journey: Journey<D>,
  input: RunInput,
  ctx: RunContext<D>,
) {
  // checks change nothing, so they run at once (a step waits only for the
  // ones it needs, checked even when not shown); results keep step order
  const selected = selectedSteps(journey, input.step);
  const checks = new Map<string, Promise<CheckResult>>();

  const checkOf = (step: Step<D>) => {
    let found = checks.get(step.id);

    if (!found) {
      found = (async () => {
        for (const need of step.needs ?? []) {
          const before = journey.steps.find((item) => item.id === need);

          if (before && (await checkOf(before)).state !== 'done') {
            return waitsFor(journey, need);
          }
        }

        return checkSafely(step, ctx);
      })();
      checks.set(step.id, found);
    }

    return found;
  };

  const found = await Promise.all(selected.map(checkOf));
  const steps: StepResult[] = [];
  const nextSteps: NextStep[] = [];

  for (const [index, step] of selected.entries()) {
    const check = found[index]!;

    // run only on request and not asked for: shown (a client can see
    // whether it ran) but nobody's step
    if (step.onlyWhenNamed && input.step !== step.id) {
      steps.push(
        resultOf(step, check, check.state === 'done' ? 'done' : 'skipped'),
      );
      continue;
    }

    steps.push(resultOf(step, check));

    if (check.state === 'waiting') {
      nextSteps.push(humanNext(journey, step, check, input));
    }
  }

  const status = statusOf(steps, nextSteps);
  const counted = steps.filter((s) => s.state !== 'skipped');
  const pending = counted.filter((s) => s.state !== 'done').length;
  const summary =
    pending === 0
      ? `${journey.title}: everything is done.`
      : input.mode === 'plan'
        ? `${journey.title}: ${pending} of ${counted.length} steps to do, nothing changed yet. ${applyHint(journey, input)}`
        : `${journey.title}: ${pending} of ${counted.length} steps need attention (below).`;

  return {
    ...handoff(journey, status, summary, steps, nextSteps),
    remaining: pending,
  };
}

async function apply<D>(
  journey: Journey<D>,
  input: RunInput,
  ctx: RunContext<D>,
) {
  const steps: StepResult[] = [];
  const result = (
    status: HandoffResult['status'],
    summary: string,
    nextSteps: NextStep[] = [],
  ) => handoff(journey, status, summary, steps, nextSteps);

  const cancelled = (current?: Step<D>) => {
    if (current) {
      steps.push(resultOf(current, { state: 'todo', message: 'cancelled' }));
    }

    const finished = steps.filter((s) => s.state === 'done').length;

    return result(
      'refused',
      `${journey.title}: cancelled. ${finished} ${finished === 1 ? 'step is' : 'steps are'} done (above); run it again to continue from there.`,
    );
  };

  // what each step is in this run (a skipped one stays todo)
  const states = new Map<string, CheckResult['state']>();

  for (const [index, step] of journey.steps.entries()) {
    if (ctx.signal?.aborted) {
      return cancelled();
    }

    if (step.onlyWhenNamed && input.step !== step.id) {
      continue;
    }

    const targeted = !input.step || input.step === step.id;
    const unmet = await unmetNeed(journey, step, states, ctx);

    if (unmet) {
      states.set(step.id, 'todo');
      steps.push(resultOf(step, waitsFor(journey, unmet)));

      // one step asked for: it, or an earlier one, can't go on
      if (input.step) {
        return result(
          'refused',
          `"${step.title}" ${waitsFor(journey, unmet).message}: run \`${commandOf(journey, input)} --step ${unmet}\` first.`,
        );
      }

      continue;
    }

    const found = await checkSafely(step, ctx);

    states.set(step.id, found.state);

    if (found.state === 'done') {
      if (targeted) {
        steps.push(resultOf(step, found));
      }

      if (input.step === step.id) {
        break;
      }

      continue;
    }

    // an earlier step blocks the one asked for
    if (!targeted) {
      steps.push(resultOf(step, found));

      return result(
        'refused',
        `"${step.title}" comes first and isn't done: ${sentence(found.fix ?? found.message ?? `run \`${commandOf(journey, input)} --step ${step.id}\``)}.`,
      );
    }

    if (found.state === 'waiting' || step.actor === 'human') {
      steps.push(resultOf(step, { ...found, state: 'waiting' }));

      return result(
        'needs-human',
        `${journey.title}: a step needs you (below), then run its command.`,
        [humanNext(journey, step, found, input)],
      );
    }

    if (found.state === 'failed') {
      steps.push(resultOf(step, found));

      return result(
        'failed',
        `${journey.title}: "${step.title}" failed: ${sentence(found.message ?? 'see above')}.`,
      );
    }

    // check-only: nothing to apply here, the fix is named
    if (step.kind === 'check') {
      steps.push(resultOf(step, found));

      return result(
        'failed',
        `${journey.title}: "${step.title}" isn't something this command does: ${sentence(found.fix ?? found.message ?? 'see above')}.`,
      );
    }

    const go = await confirmStep(journey, step, found, input, ctx);

    if (go.answer === 'skip') {
      steps.push(resultOf(step, { ...found, state: 'todo' }, 'skipped'));

      // the step asked for was the whole run
      if (input.step === step.id) {
        return result(
          'done',
          `${journey.title}: "${step.title}" was skipped; nothing changed.`,
        );
      }

      continue;
    }

    if (go.answer === 'no') {
      steps.push(resultOf(step, found));

      return result(
        'refused',
        'Stopped at your request; the steps above are done.',
      );
    }

    if (go.answer === 'ask') {
      steps.push({
        ...resultOf(step, { ...found, state: 'waiting' }),
        confirm: questionOf(step),
      });

      return result(
        'needs-human',
        `${journey.title}: "${step.title}" needs your yes first (below).`,
        [go.next],
      );
    }

    ctx.onProgress?.({
      step: step.id,
      title: step.title,
      index,
      total: journey.steps.length,
    });

    try {
      await step.apply?.(stepContext(ctx));
    } catch (error) {
      if (ctx.signal?.aborted) {
        return cancelled(step);
      }

      steps.push(
        resultOf(step, { state: 'failed', message: messageOf(error) }),
      );

      return result(
        'failed',
        `${journey.title}: "${step.title}" failed: ${sentence(messageOf(error))}.`,
      );
    }

    const after = await checkSafely(step, ctx);

    if (after.state !== 'done') {
      steps.push(
        resultOf(step, {
          ...after,
          state: 'failed',
          message: `applied but not verified: ${after.message ?? 'it still is not done'}`,
        }),
      );

      return result(
        'failed',
        `${journey.title}: "${step.title}" ran, but it still isn't done.`,
      );
    }

    states.set(step.id, 'done');
    steps.push(resultOf(step, { ...after, changes: found.changes }));

    if (input.step === step.id) {
      break;
    }
  }

  // one step asked for: later ones may still be open
  const asked = input.step
    ? journey.steps.find((s) => s.id === input.step)
    : undefined;

  return result(
    'done',
    asked
      ? `${journey.title}: "${asked.title}" is done.`
      : `${journey.title}: everything is done.`,
  );
}

// the first need not done in this run; one left out of it (run only when
// named) is checked for that
async function unmetNeed<D>(
  journey: Journey<D>,
  step: Step<D>,
  states: Map<string, CheckResult['state']>,
  ctx: RunContext<D>,
) {
  for (const id of step.needs ?? []) {
    const needed = journey.steps.find((item) => item.id === id);

    if (needed && !states.has(id)) {
      states.set(id, (await checkSafely(needed, ctx)).state);
    }

    if (states.has(id) && states.get(id) !== 'done') {
      return id;
    }
  }

  return undefined;
}

const idle = new AbortController().signal;

function stepContext<D>(ctx: RunContext<D>) {
  return {
    deps: ctx.deps,
    signal: ctx.signal ?? idle,
    // under --yes nobody is watching: a step never waits on a prompt
    prompter: ctx.runConfirmed ? undefined : ctx.prompter,
  };
}

type Go = { answer: Answer } | { answer: 'ask'; next: NextStep };

async function confirmStep<D>(
  journey: Journey<D>,
  step: Step<D>,
  found: CheckResult,
  input: RunInput,
  ctx: RunContext<D>,
): Promise<Go> {
  const { level } = step.confirm;
  const question = questionOf(step);

  if (level === 'none') {
    return { answer: 'yes' };
  }

  if (level === 'run' && ctx.runConfirmed) {
    return { answer: 'yes' };
  }

  if (level === 'step' && input.confirm?.includes(step.id)) {
    return { answer: 'yes' };
  }

  if (ctx.prompter && (level !== 'terminal' || input.surface === 'cli')) {
    return { answer: await ctx.prompter.confirm(promptOf(step, found)) };
  }

  const command = `${commandOf(journey, input)} --step ${step.id}`;

  if (level === 'terminal') {
    return {
      answer: 'ask',
      next: humanStep({
        instructions: `Run this in your own terminal (it asks you to confirm): ${command}`,
        resumeWith: resumeOf(journey, step, input),
      }),
    };
  }

  return {
    answer: 'ask',
    next: humanStep({
      instructions: `${question} Say yes to go ahead.`,
      resumeWith: resumeOf(journey, step, input, {
        confirmed: level === 'step',
      }),
    }),
  };
}

// a check sees every step; one step asked for, only that one
function selectedSteps<D>(journey: Journey<D>, only?: string) {
  if (only) {
    return journey.steps.filter((step) => step.id === only);
  }

  return journey.steps;
}

async function checkSafely<D>(
  step: Step<D>,
  ctx: RunContext<D>,
): Promise<CheckResult> {
  try {
    return await step.check(stepContext(ctx));
  } catch (error) {
    return { state: 'failed', message: `could not check: ${messageOf(error)}` };
  }
}

function resultOf<D>(
  step: Step<D>,
  found: CheckResult,
  state?: StepResult['state'],
): StepResult {
  const shown = state ?? found.state;
  const result: StepResult = {
    id: step.id,
    title: step.title,
    // waiting is always on a person, whoever the step's usual actor is
    actor: shown === 'waiting' ? 'human' : step.actor,
    state: shown,
  };

  if (found.message) {
    result.message = found.message;
  }

  if (found.changes?.length) {
    result.changes = found.changes;
  }

  if (found.fix) {
    result.fix = found.fix;
  }

  if (found.url) {
    result.url = found.url;
  }

  if (found.journey) {
    result.journey = found.journey;
  }

  // a step-level or terminal yes still to give: the question
  const asks =
    step.confirm.level === 'step' || step.confirm.level === 'terminal';

  if (asks && found.state !== 'done') {
    result.confirm = questionOf(step);
  }

  return result;
}

function humanNext<D>(
  journey: Journey<D>,
  step: Step<D>,
  found: CheckResult,
  input: RunInput,
) {
  return humanStep({
    instructions: found.fix ?? found.message ?? step.title,
    url: found.url,
    resumeWith: found.resumeWith ?? resumeOf(journey, step, input),
  });
}

// the command (CLI) or tool call (MCP) that continues from this step
function resumeOf<D>(
  journey: Journey<D>,
  step: Step<D>,
  input: RunInput,
  { confirmed = false } = {},
) {
  if (input.resume) {
    return input.resume(step);
  }

  // only checks and the owner's steps: checking again is the way on
  if (journey.steps.every((item) => !item.apply)) {
    return input.surface === 'mcp'
      ? `${toolNameOf(journey)} {}`
      : commandOf(journey, input);
  }

  if (input.surface === 'mcp') {
    const args: { mode: 'apply'; step: string; confirm?: string[] } = {
      mode: 'apply',
      step: step.id,
    };

    if (confirmed) {
      args.confirm = [step.id];
    }

    return `${toolNameOf(journey)} ${JSON.stringify(args)}`;
  }

  return `${commandOf(journey, input)} --step ${step.id}${confirmed ? ` --confirm ${step.id}` : ' --yes'}`;
}

function waitsFor<D>(journey: Journey<D>, id: string): CheckResult {
  const title = journey.steps.find((step) => step.id === id)?.title ?? id;

  return { state: 'todo', message: `waits for "${title}"` };
}

function applyHint<D>(journey: Journey<D>, input: RunInput) {
  return input.surface === 'mcp'
    ? `Call ${toolNameOf(journey)} with mode apply to make them.`
    : `Run \`${commandOf(journey, input)} --yes\` to make them.`;
}

// a message inside a sentence: its own last period goes
const sentence = (text: string) => text.replace(/\.$/, '');

export const DEFAULT_RUNNER = 'pnpm';

// what the owner types: the runner, then the journey's script
export function commandLine(runner: string, command: string) {
  return `${runner} ${command}`;
}

function commandOf<D>(journey: Journey<D>, input: RunInput) {
  return commandLine(input.runner ?? DEFAULT_RUNNER, journey.command);
}

export function toolNameOf(journey: Pick<Journey<unknown>, 'id'>) {
  return `kit_${journey.id.replace(/-/g, '_')}`;
}

// what the terminal asks: the step, what it found and would change, then the question
function promptOf<D>(step: Step<D>, found: CheckResult) {
  return [
    found.message ? `${step.title}: ${found.message}` : step.title,
    ...(found.changes ?? []).map((change) => `  - ${change}`),
    questionOf(step),
  ].join('\n');
}

function questionOf<D>(step: Step<D>) {
  return step.confirm.question ?? `${step.title}?`;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
