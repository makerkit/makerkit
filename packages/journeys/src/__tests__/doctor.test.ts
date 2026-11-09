import { describe, expect, it } from 'vitest';

import { HandoffResultSchema, type HandoffResult } from '@makerkit/handoff';

import { defineJourney, defineStep, done, todo, waiting } from '../define';
import { createDoctorService, runDoctorCli } from '../doctor';
import { registerKitDoctorTool } from '../mcp';
import { createFakeMcpServer } from '../testing/fake-mcp-server';
import type { JourneyScope } from '../types';

const SECRET = 'sk_test_doctorPlantedSecret123';

// the kit's own checks (tools, .env, database, ports) are one journey
const environment = (state: 'done' | 'todo' = 'done') =>
  defineJourney<null>({
    id: 'doctor',
    title: 'This computer',
    command: 'kit:doctor',
    steps: [
      defineStep({
        id: 'node',
        title: 'Node.js',
        actor: 'human',
        check: async () =>
          state === 'done'
            ? done('Node 24')
            : waiting('Install Node 24', { url: 'https://nodejs.org' }),
      }),
    ],
  });

const billing = (scope: JourneyScope = 'local') =>
  defineJourney<null>({
    id: 'billing',
    title: 'Billing',
    command: 'kit:billing',
    scope,
    secrets: () => [SECRET],
    steps: [
      defineStep({
        id: 'key',
        title: 'Stripe key',
        check: async () => done(`using ${SECRET}`),
        apply: async () => undefined,
      }),
      defineStep({
        id: 'portal',
        title: 'Turn on the portal',
        actor: 'human',
        check: async () =>
          waiting('Click Save once', {
            url: 'https://dashboard.stripe.com/test/settings/billing/portal',
          }),
      }),
    ],
  });

function doctor(journeys = [billing()], env = environment()) {
  return createDoctorService({
    environment: env,
    environmentDeps: async () => null,
    journeys,
    depsFor: () => null,
  });
}

async function run(
  service = doctor(),
  scope: JourneyScope = 'local',
  surface: 'cli' | 'mcp' = 'cli',
) {
  const result = await service.run({ scope, surface });

  expect(HandoffResultSchema.safeParse(result).error).toBeUndefined();

  return result;
}

const capture = () => {
  const out = { text: '' };

  return {
    out,
    stdout: { write: (chunk: string) => ((out.text += chunk), true) },
  };
};

describe('createDoctorService', () => {
  it('checks the environment, then each journey in check mode, ids by journey', async () => {
    const result = await run();

    expect(result.steps.map((s) => [s.id, s.state])).toEqual([
      ['node', 'done'],
      ['billing.key', 'done'],
      ['billing.portal', 'waiting'],
    ]);
    expect(result.summary).toContain('1 of 3 checks need attention');
    expect(result.summary).toContain('Nothing was changed.');
  });

  it('resumes the environment with the doctor itself, on each surface', async () => {
    const service = doctor([], environment('todo'));

    expect((await run(service)).nextSteps[0]?.resumeWith).toBe(
      'pnpm kit:doctor',
    );
    expect((await run(service, 'launch', 'mcp')).nextSteps[0]?.resumeWith).toBe(
      'kit_doctor {"scope":"launch"}',
    );
  });

  it('runs launch journeys only with launch, and prod without the local checks', async () => {
    const service = doctor([billing('launch')]);

    expect(
      (await run(service)).steps.some((s) => s.id.startsWith('billing.')),
    ).toBe(false);
    expect(
      (await run(service, 'launch')).steps.some((s) => s.id === 'billing.key'),
    ).toBe(true);
    expect(
      (await run(doctor([billing('prod')]), 'prod')).steps.map((s) => s.id),
    ).toEqual(['billing.key', 'billing.portal']);
  });
});

describe('the environment journey', () => {
  it('is the doctor (its owner steps resume with kit_doctor) and prints no secrets', () => {
    const named = (id: string, secrets?: () => string[]) =>
      createDoctorService({
        environment: defineJourney<null>({
          id,
          title: 'This computer',
          command: 'kit:doctor',
          secrets,
          steps: [],
        }),
        environmentDeps: async () => null,
        journeys: [],
        depsFor: () => null,
      });

    expect(() => named('checks')).toThrow('must have id "doctor"');
    expect(() => named('doctor', () => [SECRET])).toThrow(
      'must not print secrets',
    );
  });
});

describe('kit_doctor over MCP and runDoctorCli', () => {
  it('refuses --launch with --prod', async () => {
    const { out, stdout } = capture();

    await runDoctorCli(
      doctor(),
      ['doctor', '--launch', '--prod', '--json'],
      stdout,
    );

    expect(JSON.parse(out.text)).toMatchObject({ status: 'refused' });
    process.exitCode = 0;
  });

  it('prints the same result in a terminal (--json) as the tool returns, secrets masked', async () => {
    const fake = createFakeMcpServer();
    const service = doctor();

    registerKitDoctorTool(fake.server, service, {
      checks: 'Node, pnpm and Docker',
    });

    expect(fake.tool('kit_doctor').config.description).toContain(
      'changes nothing: Node, pnpm and Docker, then every journey in scope',
    );

    const tool = await fake.call('kit_doctor', {});
    const { out, stdout } = capture();

    await runDoctorCli(service, ['doctor', '--json'], stdout);
    process.exitCode = 0;

    const fromCli = JSON.parse(out.text) as HandoffResult;
    const fromMcp = tool.structuredContent as HandoffResult;

    expect(JSON.stringify(tool)).not.toContain(SECRET);
    expect(out.text).not.toContain(SECRET);
    expect(fromCli.steps).toEqual(fromMcp.steps);
    expect(fromCli.nextSteps[0]?.resumeWith).toBe(
      'pnpm kit:billing --step portal --yes',
    );
    expect(fromMcp.nextSteps[0]?.resumeWith).toBe(
      'kit_billing {"mode":"apply","step":"portal"}',
    );
  });

  it('reuses a result for 5 seconds, shares one in flight, then checks again', async () => {
    const fake = createFakeMcpServer();
    let runs = 0;
    let clock = 0;
    const counted = doctor([
      defineJourney<null>({
        id: 'count',
        title: 'Count',
        command: 'kit:count',
        steps: [
          defineStep({
            id: 'x',
            title: 'X',
            check: async () => (runs++, todo('x')),
            apply: async () => undefined,
          }),
        ],
      }),
    ]);

    registerKitDoctorTool(fake.server, counted, { now: () => clock });

    await Promise.all([
      fake.call('kit_doctor', {}),
      fake.call('kit_doctor', {}),
    ]);
    clock = 4_000;
    await fake.call('kit_doctor', {});
    expect(runs).toBe(1);

    clock = 6_000;
    await fake.call('kit_doctor', {});
    expect(runs).toBe(2);
  });
});
