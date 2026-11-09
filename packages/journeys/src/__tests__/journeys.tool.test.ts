import { describe, expect, it } from 'vitest';

import { defineJourney, defineStep, done, todo } from '../define';
import { NO_LOCKS as freeLocks } from '../locks';
import { registerJourneyTools } from '../mcp';
import { createFakeMcpServer } from '../testing/fake-mcp-server';

const SECRET = 'sk_test_supersecretvalue';

function setup() {
  const state = { seeded: false };
  const journey = defineJourney<typeof state>({
    id: 'setup',
    title: 'Run your app on this computer',
    command: 'kit:setup',
    secrets: () => [SECRET],
    steps: [
      defineStep({
        id: 'db-seed',
        title: 'Load demo data',
        confirm: { level: 'step', question: 'This replaces your local data.' },
        check: async ({ deps }) =>
          deps.seeded ? done(`seeded with ${SECRET}`) : todo('No demo data'),
        apply: async ({ deps }) => {
          deps.seeded = true;
        },
      }),
    ],
  });
  const locks = freeLocks;
  const fake = createFakeMcpServer();

  registerJourneyTools(fake.server, {
    journeys: [journey],
    depsFor: () => state,
    locks,
  });

  return { fake, state };
}

describe('journey tools', () => {
  it('registers kit_<journey> (destructive when a step asks first) and kit_journeys', () => {
    const { fake } = setup();

    expect(fake.tools.map((t) => t.name)).toEqual([
      'kit_setup',
      'kit_journeys',
    ]);
    expect(fake.tool('kit_setup').config.annotations).toMatchObject({
      destructiveHint: true,
    });
    expect(fake.tool('kit_journeys').config.annotations).toMatchObject({
      readOnlyHint: true,
    });
  });

  it('checks by default and changes nothing', async () => {
    const { fake, state } = setup();
    const result = await fake.call('kit_setup', {});

    expect(result.structuredContent).toMatchObject({
      status: 'done',
      steps: [{ id: 'db-seed', state: 'todo' }],
    });
    expect(state.seeded).toBe(false);
  });

  it('asks for a step confirmation over MCP, then applies with confirm', async () => {
    const { fake, state } = setup();
    const asked = await fake.call('kit_setup', { mode: 'apply' });

    expect(asked.structuredContent).toMatchObject({
      status: 'needs-human',
      nextSteps: [
        {
          resumeWith:
            'kit_setup {"mode":"apply","step":"db-seed","confirm":["db-seed"]}',
        },
      ],
    });
    expect(state.seeded).toBe(false);

    const applied = await fake.call('kit_setup', {
      mode: 'apply',
      confirm: ['db-seed'],
    });

    expect(applied.structuredContent).toMatchObject({ status: 'done' });
    expect(state.seeded).toBe(true);
    expect(JSON.stringify(applied)).not.toContain(SECRET);
  });

  it('lists journeys with their steps for the Console', async () => {
    const { fake } = setup();
    const result = await fake.call('kit_journeys');

    expect(result.structuredContent).toEqual({
      journeys: [
        {
          id: 'setup',
          title: 'Run your app on this computer',
          command: 'pnpm kit:setup',
          tool: 'kit_setup',
          scope: 'local',
          steps: [
            {
              id: 'db-seed',
              title: 'Load demo data',
              actor: 'agent',
              confirm: 'step',
              kind: 'task',
              onlyWhenNamed: false,
            },
          ],
        },
      ],
    });
  });

  it('sends progress notifications and stops on cancel', async () => {
    const fake = createFakeMcpServer();
    const cancel = new AbortController();
    const applied: string[] = [];
    const step = (id: string) =>
      defineStep<null>({
        id,
        title: `Step ${id}`,
        check: async () => (applied.includes(id) ? done() : todo('no')),
        apply: async () => {
          applied.push(id);

          if (id === 'a') {
            cancel.abort();
          }
        },
      });

    registerJourneyTools(fake.server, {
      journeys: [
        defineJourney({
          id: 'setup',
          title: 'Set up',
          command: 'kit:setup',
          steps: [step('a'), step('b')],
        }),
      ],
      depsFor: () => null,
      locks: freeLocks,
    });

    const sent: unknown[] = [];
    const result = await fake.call(
      'kit_setup',
      { mode: 'apply' },
      {
        signal: cancel.signal,
        _meta: { progressToken: 't1' },
        sendNotification: async (n: unknown) => {
          sent.push(n);
        },
      },
    );

    expect(applied).toEqual(['a']);
    expect(sent).toEqual([
      {
        method: 'notifications/progress',
        params: {
          progressToken: 't1',
          progress: 0,
          total: 2,
          message: 'Step a',
        },
      },
    ]);
    expect(result.structuredContent).toMatchObject({
      status: 'refused',
      steps: [{ id: 'a', state: 'done' }],
    });
  });

  it('refuses a journey whose tool name a data tool already has', () => {
    const fake = createFakeMcpServer();

    const register = (id: string) =>
      registerJourneyTools(fake.server, {
        journeys: [
          defineJourney({ id, title: id, command: `kit:${id}`, steps: [] }),
        ],
        depsFor: () => null,
        locks: freeLocks,
        // the kit's own data tools: a name, or a prefix
        reserved: ['kit_env_', 'kit_mail'],
      });

    for (const id of ['doctor', 'status', 'db-status', 'env-read', 'mail']) {
      expect(() => register(id)).toThrow(/data tools use/);
    }

    // a prefix only when it ends in `_`
    expect(() => register('mailbox')).not.toThrow();
  });
});
