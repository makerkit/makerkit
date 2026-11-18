import { describe, expect, it } from 'vitest';

import { HandoffResultSchema } from '@makerkit/handoff';

import { defineJourney, defineStep, done, todo } from '../define';
import { NO_LOCKS as freeLocks } from '../run';
import { runJourney, stopStep } from '../run';
import type { ProgressEvent, RunContext, RunInput } from '../types';

type State = { applied: string[]; running: boolean };

function stepOf(
  id: string,
  apply?: (ctx: { deps: State; signal: AbortSignal }) => Promise<void>,
) {
  return defineStep<State>({
    id,
    title: `Step ${id}`,
    check: async ({ deps }) =>
      deps.applied.includes(id) ? done() : todo(`${id} not yet`),
    apply: async (ctx) => {
      await apply?.(ctx);
      ctx.deps.applied.push(id);
    },
  });
}

const server = defineStep<State>({
  id: 'server',
  title: 'Dev server',
  check: async ({ deps }) =>
    deps.running ? done('running') : todo('not running'),
  apply: async ({ deps }) => {
    deps.running = true;
  },
  stop: async ({ deps }) => {
    deps.running = false;
  },
});

const journeyOf = (...steps: ReturnType<typeof stepOf>[]) =>
  defineJourney<State>({
    id: 'setup',
    title: 'Set up',
    command: 'kit:setup',
    steps,
  });

async function run(
  journey: ReturnType<typeof journeyOf>,
  input: Partial<RunInput> = {},
  ctx: Partial<RunContext<State>> = {},
  state: State = { applied: [], running: false },
) {
  const result = await runJourney(
    journey,
    { mode: 'apply', surface: 'cli', ...input },
    { deps: state, locks: freeLocks, runConfirmed: true, ...ctx },
  );

  expect(HandoffResultSchema.safeParse(result).error).toBeUndefined();

  return { result, state };
}

describe('runJourney: progress', () => {
  it('reports each step it applies, with its position', async () => {
    const events: ProgressEvent[] = [];
    const state = { applied: ['a'], running: false };

    await run(
      journeyOf(stepOf('a'), stepOf('b'), stepOf('c')),
      {},
      {
        onProgress: (event) => events.push(event),
      },
      state,
    );

    expect(events).toEqual([
      { step: 'b', title: 'Step b', index: 1, total: 3 },
      { step: 'c', title: 'Step c', index: 2, total: 3 },
    ]);
  });
});

describe('runJourney: cancel', () => {
  it('stops after the current step and says which steps are done', async () => {
    const cancel = new AbortController();
    const { result, state } = await run(
      journeyOf(
        stepOf('a', async () => cancel.abort()),
        stepOf('b'),
      ),
      {},
      { signal: cancel.signal },
    );

    expect(state.applied).toEqual(['a']);
    expect(result.status).toBe('refused');
    expect(result.steps.map((s) => [s.id, s.state])).toEqual([['a', 'done']]);
    expect(result.summary).toMatch(/cancelled\. 1 step is done.*run it again/);
  });

  it('hands the step the signal; a step that aborts on it is reported cancelled, not failed', async () => {
    const cancel = new AbortController();
    const { result } = await run(
      journeyOf(
        stepOf('a'),
        stepOf('b', async ({ signal }) => {
          cancel.abort();
          signal.throwIfAborted();
        }),
      ),
      {},
      { signal: cancel.signal },
    );

    expect(result.status).toBe('refused');
    expect(result.steps.map((s) => [s.id, s.state, s.message])).toEqual([
      ['a', 'done', undefined],
      ['b', 'todo', 'cancelled'],
    ]);
  });

  it('starts nothing when already cancelled', async () => {
    const cancel = new AbortController();

    cancel.abort();

    const { result, state } = await run(
      journeyOf(stepOf('a')),
      {},
      {
        signal: cancel.signal,
      },
    );

    expect(state.applied).toEqual([]);
    expect(result.summary).toContain('0 steps are done');
  });
});

async function stop(
  journey: ReturnType<typeof journeyOf>,
  id: string,
  state: State = { applied: [], running: true },
) {
  const result = await stopStep(journey, id, {
    deps: state,
    locks: freeLocks,
    runConfirmed: false,
  });

  expect(HandoffResultSchema.safeParse(result).error).toBeUndefined();

  return { result, state };
}

describe('stopStep', () => {
  it('stops a process step and reports it checked after', async () => {
    const { result, state } = await stop(
      journeyOf(stepOf('a'), server),
      'server',
    );

    expect(state.running).toBe(false);
    expect(result).toMatchObject({
      status: 'done',
      steps: [{ id: 'server', state: 'todo', message: 'not running' }],
    });
  });

  it('fails a stop the check says did not take', async () => {
    const stubborn = defineStep<State>({
      ...server,
      stop: async () => undefined,
    });
    const { result } = await stop(journeyOf(stubborn), 'server');

    expect(result.status).toBe('failed');
    expect(result.steps[0]?.message).toContain('still running');
  });

  it('refuses a step that does not keep running, naming the ones that do', async () => {
    const { result } = await stop(journeyOf(stepOf('a'), server), 'a');

    expect(result.status).toBe('refused');
    expect(result.summary).toContain('server');
  });

  it('makes a step with a stop() a process step', () => {
    expect(server.kind).toBe('process');
    expect(stepOf('a').kind).toBe('task');
  });
});
