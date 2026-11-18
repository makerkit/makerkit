import { describe, expect, it } from 'vitest';

import { createEnvInspectorService } from '../env-inspector.service';
import { WEB_APP, WEB_DIR, createMemoryDeps } from './helpers';

function serviceFor(files: string[]) {
  const { deps, store } = createMemoryDeps(
    {},
    {
      apps: WEB_APP,
      envFiles: { development: ['.env', '.env.local'], staging: files },
      model: [{ name: 'LOG_LEVEL', secret: false }],
    },
  );

  return { service: createEnvInspectorService(deps), store };
}

describe('default write file of a mode without writeTargets', () => {
  it("writes to the mode's configured files", async () => {
    const { service, store } = serviceFor([
      '.env',
      '.env.staging',
      '.env.staging.local',
    ]);

    await service.update({ key: 'API_TOKEN', value: 't', mode: 'staging' });
    await service.update({ key: 'LOG_LEVEL', value: 'warn', mode: 'staging' });

    expect(store[`${WEB_DIR}/.env.staging.local`]).toBe('API_TOKEN=t');
    expect(store[`${WEB_DIR}/.env.staging`]).toBe('LOG_LEVEL=warn');
  });

  it("uses the mode's own .local file when .env.<mode>.local is not listed", async () => {
    const { service, store } = serviceFor([
      '.env',
      '.env.staging',
      '.env.local',
    ]);

    await service.update({ key: 'API_TOKEN', value: 't', mode: 'staging' });

    expect(store[`${WEB_DIR}/.env.local`]).toBe('API_TOKEN=t');
  });

  it('refuses to put a secret in a committed file', async () => {
    const { service, store } = serviceFor(['.env', '.env.staging']);

    await expect(
      service.update({ key: 'API_TOKEN', value: 't', mode: 'staging' }),
    ).rejects.toThrow(/writeTargets/);
    expect(store).toEqual({});
  });
});
