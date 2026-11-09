import { describe, expect, it } from 'vitest';

import {
  EXIT_CODES,
  HandoffResultSchema,
  agentStep,
  handoffJsonSchema,
  humanStep,
  mask,
  renderText,
  scrub,
  type HandoffResult,
} from '../index';
import { toToolResult } from '../mcp';
import { finish } from '../node';

import { readFileSync } from 'node:fs';

const SECRET = 'sk_test_51abcdefghijklmnop';

const result: HandoffResult = {
  status: 'needs-human',
  journey: 'billing-setup',
  account: { provider: 'stripe', id: 'acct_123', name: 'Acme', mode: 'test' },
  steps: [
    {
      id: 'prices',
      title: 'Prices',
      state: 'done',
      changes: ['already set up'],
    },
    {
      id: 'portal',
      title: 'Customer portal',
      state: 'waiting',
      actor: 'human',
      fix: 'Click Save once',
      url: 'https://dashboard.stripe.com/test/settings/billing/portal',
    },
  ],
  nextSteps: [
    humanStep({
      instructions: 'Open the link and click Save.',
      url: 'https://dashboard.stripe.com/test/settings/billing/portal',
      resumeWith: 'pnpm billing:setup --step portal --yes',
    }),
  ],
  summary: 'One step needs you.',
};

function captured() {
  const chunks: string[] = [];

  return {
    write: (chunk: string) => chunks.push(chunk) > 0,
    text: () => chunks.join(''),
  };
}

describe('HandoffResultSchema', () => {
  it('accepts a result and defaults a step to the agent', () => {
    const parsed = HandoffResultSchema.parse(result);

    expect(parsed.steps[0]?.actor).toBe('agent');
    expect(parsed.steps[1]?.actor).toBe('human');
  });

  it('refuses an unknown status, state or actor', () => {
    expect(
      HandoffResultSchema.safeParse({ ...result, status: 'ok' }).success,
    ).toBe(false);
    expect(
      HandoffResultSchema.safeParse({
        ...result,
        steps: [{ id: 'x', title: 'X', state: 'planned' }],
      }).success,
    ).toBe(false);
    expect(
      HandoffResultSchema.safeParse({
        ...result,
        nextSteps: [{ actor: 'robot', instructions: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('has one exit code per status', () => {
    expect(EXIT_CODES).toEqual({
      done: 0,
      failed: 1,
      'needs-human': 2,
      refused: 3,
    });
  });

  it('is published as the committed JSON Schema (run `pnpm schema` after a change)', () => {
    const committed = JSON.parse(
      readFileSync(
        new URL('../../handoff.schema.json', import.meta.url),
        'utf8',
      ),
    );

    expect(committed).toEqual(handoffJsonSchema());
  });
});

describe('next steps', () => {
  it('drops empty fields', () => {
    expect(
      agentStep({ instructions: 'Run it', url: undefined, resumeWith: '' }),
    ).toEqual({
      actor: 'agent',
      instructions: 'Run it',
    });
  });
});

describe('masking', () => {
  it('keeps a recognizable prefix and the last four characters', () => {
    expect(mask(SECRET)).toBe('sk_test_…mnop');
    expect(mask('whsec_abcdef123456')).toBe('whsec_…3456');
    expect(mask(undefined)).toBe('(empty)');
  });

  it('scrubs known secrets from every field, however they got there', () => {
    const leaky: HandoffResult = {
      ...result,
      steps: [
        {
          id: 'key',
          title: 'Key',
          state: 'failed',
          message: `got ${SECRET}`,
          fix: SECRET,
        },
      ],
      nextSteps: [agentStep({ instructions: `export KEY=${SECRET}` })],
      summary: `Saved ${SECRET}.`,
    };

    const text = JSON.stringify(scrub(leaky, [SECRET]));

    expect(text).not.toContain(SECRET);
    expect(text).toContain('sk_test_…mnop');
  });
});

describe('finish', () => {
  it('prints one JSON document with --json and sets the exit code', () => {
    const stdout = captured();

    finish({ result, json: true, secrets: [SECRET], stdout });

    expect(JSON.parse(stdout.text())).toEqual(result);
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });

  it('prints the summary first, then the steps and what is next, for people', () => {
    const stdout = captured();

    finish({ result, json: false, stdout });

    expect(stdout.text()).toBe(renderText(result));
    expect(stdout.text()).toContain('✓ Prices');
    expect(stdout.text()).toContain('! Customer portal');
    expect(stdout.text()).toContain('You: Open the link and click Save.');
    expect(stdout.text()).toContain(
      'then run: pnpm billing:setup --step portal --yes',
    );
    expect(stdout.text().indexOf(result.summary)).toBeLessThan(
      stdout.text().indexOf('✓ Prices'),
    );
    process.exitCode = 0;
  });

  it('never prints a secret in text mode', () => {
    const stdout = captured();

    finish({
      result: { ...result, summary: `key ${SECRET}` },
      json: false,
      secrets: [SECRET],
      stdout,
    });

    expect(stdout.text()).not.toContain(SECRET);
    process.exitCode = 0;
  });
});

describe('toToolResult', () => {
  it('returns structured content and the same JSON as text', () => {
    const tool = toToolResult({ result });

    expect(tool.structuredContent).toEqual(result);
    expect(JSON.parse(tool.content[0]!.text)).toEqual(result);
    expect(tool).not.toHaveProperty('isError');
  });

  it('marks a failed run as an MCP error and masks secrets', () => {
    const tool = toToolResult({
      result: { ...result, status: 'failed', summary: `broke with ${SECRET}` },
      secrets: [SECRET],
    });

    expect(tool.isError).toBe(true);
    expect(tool.content[0]!.text).not.toContain(SECRET);
  });
});
