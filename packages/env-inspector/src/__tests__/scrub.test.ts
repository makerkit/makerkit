import { describe, expect, it } from 'vitest';

import { createEnvInspectorService } from '../env-inspector.service';
import type { EnvVariableModel } from '../types';
import { WEB_APP, WEB_DIR, createMemoryDeps } from './helpers';

const FILES = {
  [`${WEB_DIR}/.env`]: [
    'STRIPE_SECRET_KEY=sk_live_abcdefghijklmnop',
    'DATABASE_URL=postgres://user:hunter2hunter2@db.internal/app',
    'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
  ].join('\n'),
};

function fail(message: string) {
  return { success: false as const, error: { issues: [{ message }] } };
}

function serviceWith(model: EnvVariableModel[]) {
  const { deps } = createMemoryDeps(FILES, {
    apps: WEB_APP,
    envFiles: { development: ['.env'] },
    model,
  });

  return createEnvInspectorService(deps);
}

describe('validation messages never carry secret values', () => {
  it("removes another secret's value from a message", async () => {
    const service = serviceWith([
      {
        name: 'NEXT_PUBLIC_SITE_URL',
        validate: ({ variables }) =>
          fail(`does not match ${variables.STRIPE_SECRET_KEY}`),
      },
    ]);

    const { variables } = await service.read();
    const errors = variables.NEXT_PUBLIC_SITE_URL?.validation.errors ?? [];

    expect(errors.join(' ')).not.toContain('sk_live_abcdefghijklmnop');
  });

  it('removes an 8-character or longer part of a secret', async () => {
    const service = serviceWith([
      {
        name: 'STRIPE_SECRET_KEY',
        validate: ({ value }) => fail(`starts with ${value.slice(0, 12)}…`),
      },
      {
        name: 'DATABASE_URL',
        validate: () => fail('password hunter2hunter2 is too common'),
      },
    ]);

    const { variables } = await service.read();
    const text = JSON.stringify(variables);

    expect(text).not.toContain('sk_live_abcd');
    expect(text).not.toContain('hunter2hunter2');
  });

  it('removes secret values from an error a validator throws', async () => {
    const service = serviceWith([
      {
        name: 'NEXT_PUBLIC_SITE_URL',
        validate: ({ variables }) => {
          throw new Error(`boom ${variables.DATABASE_URL}`);
        },
      },
    ]);

    const error = await service.read().catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('boom');
    expect((error as Error).message).not.toContain('hunter2');
  });
});
