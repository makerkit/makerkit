import { describe, expect, it } from 'vitest';

import { HandoffResultSchema } from '@makerkit/handoff';

import { defineJourney, defineStep, done, todo, waiting } from '../define';
import { NO_LOCKS as freeLocks } from '../locks';
import { runJourney } from '../run';
import type { Answer, ConfirmLevel, Locks, RunInput } from '../types';

type State = { applied: string[]; done: Set<string>; broken?: string };

// a step that's done once applied (unless `sticky`: apply doesn't take)
function stepOf(
  id: string,
  {
    level = 'run',
    sticky = false,
  }: { level?: ConfirmLevel; sticky?: boolean } = {},
) {
  return defineStep<State>({
    id,
    title: `Step ${id}`,
    confirm: { level, question: `Really ${id}?` },
    async check({ deps }) {
      return deps.done.has(id)
        ? done(`${id} is done`)
        : todo(`${id} not yet`, { changes: [`would ${id}`] });
    },
    async apply({ deps }) {
      if (deps.broken === id) {
        throw new Error(`${id} broke`);
      }

      deps.applied.push(id);

      if (!sticky) {
        deps.done.add(id);
      }
    },
  });
}

const portal = defineStep<State>({
  id: 'portal',
  title: 'Turn on the portal',
  actor: 'human',
  async check({ deps }) {
    return deps.done.has('portal')
      ? done()
      : waiting('Click Save once', { url: 'https://example.com/portal' });
  },
});

function journeyOf(...steps: ReturnType<typeof stepOf>[]) {
  return defineJourney<State>({
    id: 'setup',
    title: 'Set up',
    command: 'kit:setup',
    steps,
  });
}

function run(
  journey: ReturnType<typeof journeyOf>,
  input: Partial<RunInput>,
  {
    state = { applied: [], done: new Set<string>() } as State,
    answers = [] as Answer[],
    runConfirmed = false,
    prompter = true,
    locks = freeLocks,
  } = {},
) {
  // the question asked (a prompt's last line), and each whole prompt
  const asked: string[] = [];
  const prompts: string[] = [];
  const queue = [...answers];

  return runJourney(
    journey,
    { mode: 'apply', surface: 'cli', ...input },
    {
      deps: state,
      locks,
      runConfirmed,
      prompter: prompter
        ? {
            confirm: async (q) => (
              prompts.push(q),
              asked.push(q.split('\n').at(-1)!),
              queue.shift() ?? 'yes'
            ),
            secret: async () => '',
          }
        : undefined,
    },
  ).then((result) => {
    expect(HandoffResultSchema.safeParse(result).error).toBeUndefined();

    return { result, state, asked, prompts };
  });
}

describe('runJourney: check and plan', () => {
  it('reports every step and changes nothing', async () => {
    const { result, state } = await run(journeyOf(stepOf('a'), stepOf('b')), {
      mode: 'plan',
    });

    expect(state.applied).toEqual([]);
    expect(result.steps.map((s) => [s.id, s.state])).toEqual([
      ['a', 'todo'],
      ['b', 'todo'],
    ]);
    expect(result.summary).toContain('nothing changed');
  });

  it('turns a waiting human step into a next step with its link and resume command', async () => {
    const { result } = await run(
      defineJourney({
        id: 'setup',
        title: 'Set up',
        command: 'kit:setup',
        steps: [portal, stepOf('a')],
      }),
      { mode: 'check' },
    );

    expect(result.status).toBe('needs-human');
    expect(result.nextSteps).toEqual([
      {
        actor: 'human',
        instructions: 'Click Save once',
        url: 'https://example.com/portal',
        resumeWith: 'pnpm kit:setup --step portal --yes',
      },
    ]);
  });
});

describe('runJourney: apply', () => {
  it('applies the steps that are not done, in order, and checks each again', async () => {
    const state: State = { applied: [], done: new Set(['a']) };
    const { result } = await run(
      journeyOf(stepOf('a'), stepOf('b'), stepOf('c')),
      {},
      { state, runConfirmed: true },
    );

    expect(result.status).toBe('done');
    expect(state.applied).toEqual(['b', 'c']);
    expect(result.steps.map((s) => s.state)).toEqual(['done', 'done', 'done']);
  });

  it('fails a step whose apply did not take: applied but not verified', async () => {
    const { result } = await run(
      journeyOf(stepOf('a', { sticky: true })),
      {},
      { runConfirmed: true },
    );

    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('applied but not verified'),
    });
  });

  it('reports an apply that throws, and stops there', async () => {
    const state: State = { applied: [], done: new Set(), broken: 'a' };
    const { result } = await run(
      journeyOf(stepOf('a'), stepOf('b')),
      {},
      { state, runConfirmed: true },
    );

    expect(result.status).toBe('failed');
    expect(result.steps).toHaveLength(1);
    expect(state.applied).toEqual([]);
  });

  it('stops at a human step and says what the owner does next', async () => {
    const journey = defineJourney<State>({
      id: 'setup',
      title: 'Set up',
      command: 'kit:setup',
      steps: [portal, stepOf('b')],
    });
    const { result, state } = await run(journey, {}, { runConfirmed: true });

    expect(result.status).toBe('needs-human');
    expect(state.applied).toEqual([]);
    expect(result.nextSteps[0]).toMatchObject({
      actor: 'human',
      url: 'https://example.com/portal',
    });
  });
});

describe('runJourney: one step', () => {
  it('refuses an unknown step, listing the real ones', async () => {
    const { result } = await run(journeyOf(stepOf('a'), stepOf('b')), {
      step: 'nope',
    });

    expect(result.status).toBe('refused');
    expect(result.summary).toContain('a, b');
  });

  it('refuses when an earlier step is not done, naming it; nothing runs', async () => {
    const { result, state } = await run(
      journeyOf(stepOf('db'), stepOf('seed')),
      { step: 'seed' },
      { runConfirmed: true },
    );

    expect(result.status).toBe('refused');
    expect(result.summary).toContain('Step db');
    expect(state.applied).toEqual([]);
  });

  it('runs only the step asked for once the earlier ones are done', async () => {
    const state: State = { applied: [], done: new Set(['db']) };
    const { result } = await run(
      journeyOf(stepOf('db'), stepOf('seed'), stepOf('later')),
      { step: 'seed' },
      { state, runConfirmed: true },
    );

    expect(result.status).toBe('done');
    expect(state.applied).toEqual(['seed']);
    expect(result.steps.map((s) => s.id)).toEqual(['seed']); // `later` isn't done: the summary speaks for the step, not the journey
    expect(result.summary).toBe('Set up: "Step seed" is done.');
  });
});

describe('runJourney: confirm levels', () => {
  it('run: --yes covers it; in a terminal without --yes it asks', async () => {
    expect(
      (await run(journeyOf(stepOf('a')), {}, { runConfirmed: true })).asked,
    ).toEqual([]);
    expect((await run(journeyOf(stepOf('a')), {})).asked).toEqual([
      'Really a?',
    ]);
  });

  it('shows what the step found and would change before asking', async () => {
    expect((await run(journeyOf(stepOf('a')), {})).prompts).toEqual([
      'Step a: a not yet\n  - would a\nReally a?',
    ]);
  });

  it('run: no terminal and no --yes hands the owner the question', async () => {
    const { result, state } = await run(
      journeyOf(stepOf('a')),
      {},
      { prompter: false },
    );

    expect(result.status).toBe('needs-human');
    expect(state.applied).toEqual([]);
    expect(result.nextSteps[0]?.resumeWith).toBe(
      'pnpm kit:setup --step a --yes',
    );
  });

  it('step: --yes never covers it; --confirm <id> does', async () => {
    const journey = journeyOf(stepOf('seed', { level: 'step' }));
    const noTerminal = await run(
      journey,
      {},
      { runConfirmed: true, prompter: false },
    );

    expect(noTerminal.result.status).toBe('needs-human');
    expect(noTerminal.state.applied).toEqual([]);
    expect(noTerminal.result.steps[0]).toMatchObject({
      state: 'waiting',
      // waiting for a yes: the owner's turn
      actor: 'human',
      confirm: 'Really seed?',
    });
    expect(noTerminal.result.nextSteps[0]).toMatchObject({
      actor: 'human',
      instructions: expect.stringContaining('Really seed?'),
      resumeWith: 'pnpm kit:setup --step seed --confirm seed',
    });

    const confirmed = await run(
      journey,
      { confirm: ['seed'] },
      { runConfirmed: true, prompter: false },
    );

    expect(confirmed.state.applied).toEqual(['seed']);
  });

  it('step: in a terminal it asks even with --yes', async () => {
    const { asked, state } = await run(
      journeyOf(stepOf('seed', { level: 'step' })),
      {},
      { runConfirmed: true },
    );

    expect(asked).toEqual(['Really seed?']);
    expect(state.applied).toEqual(['seed']);
  });

  it('terminal: only a prompt in the owner terminal runs it; over MCP it hands over the command', async () => {
    const journey = journeyOf(stepOf('live', { level: 'terminal' }));
    const mcp = await run(
      journey,
      { surface: 'mcp', confirm: ['live'] },
      { runConfirmed: true, prompter: false },
    );

    expect(mcp.result.status).toBe('needs-human');
    expect(mcp.state.applied).toEqual([]);
    expect(mcp.result.nextSteps[0]?.instructions).toContain(
      'in your own terminal',
    );
    expect(mcp.result.nextSteps[0]?.instructions).toContain(
      'pnpm kit:setup --step live',
    );

    const terminal = await run(journey, {}, { runConfirmed: true });

    expect(terminal.asked).toEqual(['Really live?']);
    expect(terminal.state.applied).toEqual(['live']);
  });

  it('none: never asks', async () => {
    expect(
      (await run(journeyOf(stepOf('a', { level: 'none' })), {})).asked,
    ).toEqual([]);
  });

  it('a no stops the run; a skip moves on', async () => {
    const stopped = await run(
      journeyOf(stepOf('a'), stepOf('b')),
      {},
      { answers: ['no'] },
    );

    expect(stopped.result.status).toBe('refused');
    expect(stopped.state.applied).toEqual([]);

    const skipped = await run(
      journeyOf(stepOf('a'), stepOf('b')),
      {},
      { answers: ['skip', 'yes'] },
    );

    expect(skipped.state.applied).toEqual(['b']);
    expect(skipped.result.steps.map((s) => s.state)).toEqual([
      'skipped',
      'done',
    ]);
  });

  it('a skip of the step asked for ends the run there, saying so', async () => {
    const { result, state } = await run(
      journeyOf(stepOf('a'), stepOf('b'), stepOf('c')),
      { step: 'b' },
      { answers: ['skip'], state: { applied: [], done: new Set(['a']) } },
    );

    expect(state.applied).toEqual([]);
    expect(result.status).toBe('done');
    expect(result.steps.map((s) => [s.id, s.state])).toEqual([
      ['b', 'skipped'],
    ]);
    expect(result.summary).toBe(
      'Set up: "Step b" was skipped; nothing changed.',
    );
  });

  it('writes MCP resume calls for MCP runs', async () => {
    const { result } = await run(
      journeyOf(stepOf('seed', { level: 'step' })),
      { surface: 'mcp' },
      { runConfirmed: true, prompter: false },
    );

    expect(result.nextSteps[0]?.resumeWith).toBe(
      'kit_setup {"mode":"apply","step":"seed","confirm":["seed"]}',
    );
  });
});

describe('runJourney: locks', () => {
  it('locks the journey for a full apply and the step (plus the journey) for --step', async () => {
    const taken: { key: string; conflicts: string[] }[] = [];
    const locks: Locks = {
      async acquire(request) {
        taken.push(request);

        return { ok: true, release: async () => undefined };
      },
    };
    const journey = journeyOf(stepOf('a'), stepOf('b'));

    await run(journey, {}, { locks, runConfirmed: true });
    await run(journey, { step: 'a' }, { locks, runConfirmed: true });
    await run(journey, { mode: 'check' }, { locks });

    expect(taken).toEqual([
      { key: 'setup', conflicts: ['setup.a', 'setup.b'] },
      { key: 'setup.a', conflicts: ['setup'] },
    ]);
  });

  it('refuses while another run holds the lock, naming its process', async () => {
    const locks: Locks = {
      acquire: async () => ({ ok: false, holder: { key: 'setup', pid: 4242 } }),
    };
    const { result, state } = await run(
      journeyOf(stepOf('a')),
      {},
      { locks, runConfirmed: true },
    );

    expect(result.status).toBe('refused');
    expect(result.summary).toContain('4242');
    expect(state.applied).toEqual([]);
  });
});

describe('defineStep', () => {
  it('refuses a human step with an apply and an agent step without one', () => {
    expect(() =>
      defineStep({
        id: 'x',
        title: 'X',
        actor: 'human',
        check: async () => done(),
        apply: async () => undefined,
      }),
    ).toThrow(/human step/);
    expect(() =>
      defineStep({ id: 'x', title: 'X', check: async () => done() }),
    ).toThrow(/apply/);
  });

  it('refuses a journey that repeats a step id', () => {
    expect(() => journeyOf(stepOf('a'), stepOf('a'))).toThrow(/repeats/);
  });
});

describe('runJourney: steps that wait, named steps, the last word', () => {
  const needsA = defineStep<State>({
    id: 'b',
    title: 'Step b',
    needs: ['a'],
    async check({ deps }) {
      if (!deps.done.has('a')) {
        throw new Error('checked before a was done');
      }

      return deps.done.has('b') ? done() : todo('b not yet');
    },
    async apply({ deps }) {
      deps.applied.push('b');
      deps.done.add('b');
    },
  });

  it('reports a step whose needs are not done as todo, without checking it', async () => {
    const { result } = await run(journeyOf(stepOf('a'), needsA), {
      mode: 'check',
    });

    expect(result.status).toBe('done');
    expect(result.steps[1]).toMatchObject({
      state: 'todo',
      message: 'waits for "Step a"',
    });
  });

  it('applies a step after what it needs, and leaves it when that is skipped', async () => {
    const both = await run(
      journeyOf(stepOf('a'), needsA),
      {},
      { runConfirmed: true },
    );

    expect(both.state.applied).toEqual(['a', 'b']);

    const skipped = await run(
      journeyOf(stepOf('a'), needsA),
      {},
      {
        answers: ['skip'],
      },
    );

    expect(skipped.state.applied).toEqual([]);
    expect(skipped.result.steps.map((s) => [s.id, s.state])).toEqual([
      ['a', 'skipped'],
      ['b', 'todo'],
    ]);
  });

  it('refuses a step that needs a later or unknown one', () => {
    expect(() =>
      defineJourney<State>({
        id: 'x',
        title: 'X',
        command: 'kit:x',
        steps: [{ ...stepOf('a'), needs: ['b'] }, stepOf('b')],
      }),
    ).toThrow('needs b');
  });

  it('resumes an owner step of a check-only journey by checking again', async () => {
    const journey = defineJourney<State>({
      id: 'live',
      title: 'Live',
      command: 'billing:doctor --live',
      steps: [portal],
    });

    const cli = await run(journey, { mode: 'check' });
    const mcp = await run(journey, { mode: 'check', surface: 'mcp' });

    expect(cli.result.nextSteps[0]?.resumeWith).toBe(
      'pnpm billing:doctor --live',
    );
    expect(mcp.result.nextSteps[0]?.resumeWith).toBe('kit_live {}');
  });

  it('runs a step only when named when it says so', async () => {
    const proof = { ...stepOf('proof'), onlyWhenNamed: true };
    const journey = journeyOf(stepOf('a'), proof);

    const full = await run(journey, {}, { runConfirmed: true });

    expect(full.state.applied).toEqual(['a']);
    expect(full.result.steps.map((s) => s.id)).toEqual(['a']);

    // a check shows it (a client can see whether it ran) without asking
    // for it: not done is `skipped`, never a step for anyone
    const checked = (await run(journey, { mode: 'check' })).result;

    expect(checked.steps.map((s) => [s.id, s.state, s.message])).toEqual([
      ['a', 'todo', 'a not yet'],
      ['proof', 'skipped', 'proof not yet'],
    ]);
    expect(checked.summary).toBe(
      'Set up: 1 of 1 steps need attention (below).',
    );

    const named = await run(
      journey,
      { step: 'proof' },
      {
        runConfirmed: true,
        state: { applied: [], done: new Set(['a']) },
      },
    );

    expect(named.state.applied).toEqual(['proof']);
  });

  it("gives the journey the last word on the result, with the run's input", async () => {
    const seen: string[] = [];
    const journey = defineJourney<State>({
      id: 'setup',
      title: 'Set up',
      command: 'kit:setup',
      steps: [stepOf('a')],
      account: async () => ({ provider: 'stripe', id: 'acct_1', name: 'Acme' }),
      finalize: async (result, { input }) => (
        seen.push(input.mode),
        { ...result, summary: `${result.summary} (mine)` }
      ),
    });

    const { result } = await run(journey, {}, { runConfirmed: true });

    expect(result.account?.id).toBe('acct_1');
    expect(result.summary).toContain('(mine)');
    expect(seen).toEqual(['apply']);
  });
});
