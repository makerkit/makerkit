import { describe, expect, it } from 'vitest';

import {
  DEFAULT_START_HINT,
  type MailpitDeps,
  MailpitHttpError,
  type MailpitSettings,
  createMailpitService,
} from '../mailpit.service';

function createDeps(
  settings: MailpitSettings | undefined,
  overrides: Partial<MailpitDeps> = {},
) {
  const urls: string[] = [];
  const commands: string[][] = [];

  const deps: MailpitDeps = {
    settings,
    async request(url) {
      urls.push(url);
      return {};
    },
    async executeCommand(command, args) {
      commands.push([command, ...args]);
      return { stdout: 'mailpit\n', stderr: '', exitCode: 0 };
    },
    ...overrides,
  };

  return { deps, urls, commands };
}

describe('settings', () => {
  it('defaults to Mailpit on 127.0.0.1:8025', async () => {
    const { deps, urls } = createDeps(undefined);

    const result = await createMailpitService(deps).list({
      start: 0,
      limit: 10,
    });

    expect(result.mail_server.api_base_url).toBe(
      'http://127.0.0.1:8025/api/v1',
    );
    expect(urls).toEqual([
      'http://127.0.0.1:8025/api/v1/info',
      'http://127.0.0.1:8025/api/v1/messages?start=0&limit=10',
    ]);
  });

  it('uses the configured URL and drops a trailing slash', async () => {
    const ports: Array<[string, number]> = [];
    const { deps, urls } = createDeps(
      { url: 'http://127.0.0.1:54324/' },
      {
        async isPortOpen(host, port) {
          ports.push([host, port]);
          return true;
        },
      },
    );

    await createMailpitService(deps).list({ start: 0, limit: 10 });

    expect(ports).toEqual([['127.0.0.1', 54324]]);
    expect(urls[0]).toBe('http://127.0.0.1:54324/api/v1/info');
  });

  it('resolves a URL function on every call', async () => {
    let port = 54324;
    const { deps, urls } = createDeps({
      url: async () => `http://127.0.0.1:${port}`,
    });
    const service = createMailpitService(deps);

    await service.read({ id: 'a' });
    port = 54424;
    await service.read({ id: 'a' });

    expect(urls).toContain('http://127.0.0.1:54324/api/v1/message/a');
    expect(urls).toContain('http://127.0.0.1:54424/api/v1/message/a');
  });

  it('runs no docker command unless docker is configured', async () => {
    const { deps, commands } = createDeps(undefined);

    const result = await createMailpitService(deps).list({
      start: 0,
      limit: 10,
    });

    expect(commands).toEqual([]);
    expect(result.mail_server.running_via_docker).toBe(false);
  });

  it('checks the configured compose file and service', async () => {
    const { deps, commands } = createDeps({
      docker: { composeFile: 'docker-compose.dev.yml' },
    });

    const result = await createMailpitService(deps).list({
      start: 0,
      limit: 10,
    });

    expect(commands).toEqual([
      [
        'docker',
        'compose',
        '-f',
        'docker-compose.dev.yml',
        'ps',
        '--status',
        'running',
        '--services',
      ],
    ]);
    expect(result.mail_server.running_via_docker).toBe(true);
  });
});

describe('Mailpit not running', () => {
  const refused = async () => {
    throw new TypeError('fetch failed');
  };

  it('says where it looked and how to start it, with the default hint', async () => {
    const { deps } = createDeps(undefined, { request: refused });

    await expect(
      createMailpitService(deps).list({ start: 0, limit: 10 }),
    ).rejects.toThrow(
      `Mailpit is not running at http://127.0.0.1:8025. ${DEFAULT_START_HINT}`,
    );
  });

  it('uses the configured hint', async () => {
    const { deps } = createDeps(
      {
        url: 'http://127.0.0.1:54324',
        startHint: 'Start Supabase with "pnpm supabase:web:start".',
      },
      { request: refused },
    );

    await expect(createMailpitService(deps).read({ id: 'a' })).rejects.toThrow(
      'Mailpit is not running at http://127.0.0.1:54324. Start Supabase with "pnpm supabase:web:start".',
    );
  });

  it('reports an HTTP error from the API as unreachable, not stopped', async () => {
    const { deps } = createDeps(undefined, {
      async request(url) {
        throw new MailpitHttpError(502, url);
      },
    });

    await expect(
      createMailpitService(deps).list({ start: 0, limit: 10 }),
    ).rejects.toThrow(
      'Mailpit API is unreachable at http://127.0.0.1:8025/api/v1: Mailpit API request failed with status 502',
    );
  });

  it('reports status without a port check', async () => {
    const { deps } = createDeps(
      { startHint: 'Run "docker compose up mailpit".' },
      { request: refused },
    );

    expect(await createMailpitService(deps).status()).toEqual({
      connected: false,
      running: false,
      api_reachable: false,
      url: 'http://127.0.0.1:8025',
      port: 8025,
      reason:
        'Mailpit is not running at http://127.0.0.1:8025. Run "docker compose up mailpit".',
    });
  });
});
