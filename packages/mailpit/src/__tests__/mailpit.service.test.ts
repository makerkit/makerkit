import { describe, expect, it } from 'vitest';

import {
  type MailpitDeps,
  type MailpitRequestInit,
  MailpitHttpError,
  createMailpitService,
} from '../mailpit.service';

const COMPOSE_SETTINGS = {
  startHint: 'Start local services with "pnpm compose:dev:up".',
  docker: { composeFile: 'docker-compose.dev.yml', service: 'mailpit' },
};

function createDeps(overrides: Partial<MailpitDeps> = {}): MailpitDeps {
  return {
    settings: COMPOSE_SETTINGS,
    async executeCommand() {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      };
    },
    async isPortOpen() {
      return true;
    },
    async request() {
      return {};
    },
    ...overrides,
  };
}

describe('MailpitService', () => {
  it('lists messages from Mailpit API', async () => {
    const service = createMailpitService(
      createDeps({
        async executeCommand() {
          return { stdout: 'mailpit\n', stderr: '', exitCode: 0 };
        },
        async request(url: string) {
          if (url.endsWith('/info')) {
            return { version: 'v1' };
          }

          return {
            total: 1,
            unread: 1,
            count: 1,
            messages: [
              {
                ID: 'abc',
                MessageID: 'm-1',
                Subject: 'Welcome',
                From: [{ Name: 'Makerkit', Address: 'noreply@makerkit.dev' }],
                To: [{ Address: 'user@example.com' }],
                Created: '2025-01-01T00:00:00Z',
                Size: 123,
                Read: false,
                ReadAt: null,
              },
            ],
          };
        },
      }),
    );

    const result = await service.list({ start: 0, limit: 50 });

    expect(result.mail_server.running).toBe(true);
    expect(result.mail_server.running_via_docker).toBe(true);
    expect(result.total).toBe(1);
    expect(result.messages[0]).toEqual({
      id: 'abc',
      message_id: 'm-1',
      subject: 'Welcome',
      from: ['Makerkit <noreply@makerkit.dev>'],
      to: ['user@example.com'],
      created_at: '2025-01-01T00:00:00Z',
      size: 123,
      read: false,
    });
    expect(result.messages[0]?.readAt).toBeUndefined();
  });

  it('reads single message details', async () => {
    const service = createMailpitService(
      createDeps({
        async request(url: string) {
          if (url.endsWith('/info')) {
            return { version: 'v1' };
          }

          if (url.includes('/message/')) {
            return {
              ID: 'abc',
              MessageID: 'm-1',
              Subject: 'Welcome',
              From: [{ Address: 'noreply@makerkit.dev' }],
              To: [{ Address: 'user@example.com' }],
              Cc: [{ Address: 'team@example.com' }],
              Bcc: [],
              Text: ['Hello user'],
              HTML: ['<p>Hello user</p>'],
              Headers: {
                Subject: ['Welcome'],
              },
              Read: true,
              ReadAt: '2025-01-01T00:05:00Z',
              Size: 456,
              Created: '2025-01-01T00:00:00Z',
            };
          }

          return {};
        },
      }),
    );

    const result = await service.read({ id: 'abc' });

    expect(result.id).toBe('abc');
    expect(result.subject).toBe('Welcome');
    expect(result.from).toEqual(['noreply@makerkit.dev']);
    expect(result.to).toEqual(['user@example.com']);
    expect(result.cc).toEqual(['team@example.com']);
    expect(result.text).toBe('Hello user');
    expect(result.html).toBe('<p>Hello user</p>');
    expect(result.read).toBe(true);
    expect(result.readAt).toBe('2025-01-01T00:05:00Z');
    expect(result.headers).toEqual({ Subject: ['Welcome'] });
  });

  it('throws if mailpit runs in docker but API port is not open', async () => {
    const service = createMailpitService(
      createDeps({
        async isPortOpen() {
          return false;
        },
        async executeCommand() {
          return { stdout: 'mailpit\n', stderr: '', exitCode: 0 };
        },
      }),
    );

    await expect(service.list({ start: 0, limit: 50 })).rejects.toThrow(
      'Mailpit appears running in docker but API is unreachable at http://127.0.0.1:8025/api/v1',
    );
  });

  it('throws if mailpit is not running', async () => {
    const service = createMailpitService(
      createDeps({
        async isPortOpen() {
          return false;
        },
        async executeCommand() {
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      }),
    );

    await expect(service.list({ start: 0, limit: 50 })).rejects.toThrow(
      'Mailpit is not running at http://127.0.0.1:8025. Start local services with "pnpm compose:dev:up".',
    );
  });

  it('reports healthy mailbox status when API is reachable', async () => {
    const service = createMailpitService(
      createDeps({
        async isPortOpen() {
          return true;
        },
        async executeCommand() {
          return { stdout: 'mailpit\n', stderr: '', exitCode: 0 };
        },
        async request(url: string) {
          if (url.endsWith('/info')) {
            return { version: 'v1' };
          }

          return {};
        },
      }),
    );

    const result = await service.status();

    expect(result.connected).toBe(true);
    expect(result.running).toBe(true);
    expect(result.api_reachable).toBe(true);
    expect(result.url).toBe('http://127.0.0.1:8025');
    expect(result.port).toBe(8025);
    expect(result.reason).toBeUndefined();
  });

  it('reports degraded mailbox status when running but API is unreachable', async () => {
    const service = createMailpitService(
      createDeps({
        async isPortOpen() {
          return true;
        },
        async executeCommand() {
          return { stdout: 'mailpit\n', stderr: '', exitCode: 0 };
        },
        async request() {
          throw new Error('connection refused');
        },
      }),
    );

    const result = await service.status();

    expect(result.connected).toBe(true);
    expect(result.running).toBe(true);
    expect(result.api_reachable).toBe(false);
    expect(result.reason).toContain('API is unreachable');
  });

  it('reports stopped mailbox status when not running', async () => {
    const service = createMailpitService(
      createDeps({
        async isPortOpen() {
          return false;
        },
        async executeCommand() {
          return { stdout: '', stderr: '', exitCode: 0 };
        },
        async request() {
          throw new Error('unreachable');
        },
      }),
    );

    const result = await service.status();

    expect(result.connected).toBe(false);
    expect(result.running).toBe(false);
    expect(result.api_reachable).toBe(false);
    expect(result.reason).toBe(
      'Mailpit is not running at http://127.0.0.1:8025. Start local services with "pnpm compose:dev:up".',
    );
  });

  it('sets read status through PUT /messages after checking the message exists', async () => {
    const calls: Array<{ url: string; init?: MailpitRequestInit }> = [];

    const service = createMailpitService(
      createDeps({
        async request(url: string, init?: MailpitRequestInit) {
          calls.push({ url, init });

          if (url.endsWith('/info')) {
            return { version: 'v1' };
          }

          return url.endsWith('/messages') ? 'ok' : {};
        },
      }),
    );

    const result = await service.setReadStatus({ id: 'abc', read: true });

    expect(result).toEqual({ id: 'abc', read: true });
    expect(calls.map((call) => call.url)).toEqual([
      'http://127.0.0.1:8025/api/v1/info',
      'http://127.0.0.1:8025/api/v1/message/abc/headers',
      'http://127.0.0.1:8025/api/v1/messages',
    ]);
    expect(calls[2]?.init).toEqual({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: ['abc'], Read: true }),
    });
  });

  it('does not read the full message back, so marking unread sticks', async () => {
    const urls: string[] = [];

    const service = createMailpitService(
      createDeps({
        async request(url: string) {
          urls.push(url);
          return {};
        },
      }),
    );

    const result = await service.setReadStatus({ id: 'abc', read: false });

    expect(result).toEqual({ id: 'abc', read: false });
    expect(urls).not.toContain('http://127.0.0.1:8025/api/v1/message/abc');
  });

  it('reports a missing message instead of silently succeeding', async () => {
    const service = createMailpitService(
      createDeps({
        async request(url: string) {
          if (url.includes('/message/')) {
            throw new MailpitHttpError(404, url);
          }

          return {};
        },
      }),
    );

    await expect(
      service.setReadStatus({ id: 'nope', read: true }),
    ).rejects.toThrow('Email "nope" not found in Mailpit');
    await expect(service.read({ id: 'nope' })).rejects.toThrow(
      'Email "nope" not found in Mailpit',
    );
  });
});

describe('Mailpit API payloads', () => {
  // Captured from Mailpit v1.27 and v1.31.
  const LIST_PAYLOAD = {
    total: 1,
    unread: 1,
    count: 1,
    messages_count: 1,
    messages_unread: 1,
    start: 0,
    tags: [],
    messages: [
      {
        ID: '5EgwGwgEg3p5vpkJDKRlni',
        MessageID: '642EuXlyz8ECSJJtVMDD8q@mailpit',
        Read: false,
        From: { Name: 'App', Address: 'noreply@example.com' },
        To: [{ Name: '', Address: 'user@example.com' }],
        Cc: null,
        Bcc: null,
        ReplyTo: [],
        Subject: 'Confirm your email',
        Created: '2026-10-14T15:14:04.371Z',
        Tags: [],
        Size: 559,
        Attachments: 0,
        Snippet: 'hello',
      },
    ],
  };

  const MESSAGE_PAYLOAD = {
    ID: '5EgwGwgEg3p5vpkJDKRlni',
    MessageID: '642EuXlyz8ECSJJtVMDD8q@mailpit',
    From: { Name: 'App', Address: 'noreply@example.com' },
    To: [{ Name: '', Address: 'user@example.com' }],
    Cc: [],
    Bcc: [],
    ReplyTo: [],
    ReturnPath: 'noreply@example.com',
    Subject: 'Confirm your email',
    Date: '2026-10-14T15:14:04Z',
    Tags: [],
    Text: 'hello',
    HTML: '<p>hello</p>',
    Size: 559,
    Inline: [],
    Attachments: [],
  };

  const HEADERS_PAYLOAD = {
    'Content-Type': ['text/plain; charset=utf-8'],
    Subject: ['Confirm your email'],
  };

  function createPayloadDeps() {
    return createDeps({
      async request(url: string) {
        if (url.endsWith('/info')) return { Version: 'v1.31.3' };
        if (url.includes('/messages?')) return LIST_PAYLOAD;
        if (url.endsWith('/headers')) return HEADERS_PAYLOAD;
        if (url.includes('/message/')) return MESSAGE_PAYLOAD;

        return {};
      },
    });
  }

  it('reads From as a single object and tolerates null Cc', async () => {
    const service = createMailpitService(createPayloadDeps());

    const result = await service.list({ start: 0, limit: 50 });

    expect(result.messages[0]).toMatchObject({
      from: ['App <noreply@example.com>'],
      to: ['user@example.com'],
      read: false,
    });
  });

  it('uses Date, fetches headers and reports the message as read', async () => {
    const service = createMailpitService(createPayloadDeps());

    const result = await service.read({ id: '5EgwGwgEg3p5vpkJDKRlni' });

    expect(result).toMatchObject({
      from: ['App <noreply@example.com>'],
      created_at: '2026-10-14T15:14:04Z',
      text: 'hello',
      html: '<p>hello</p>',
      read: true,
      headers: HEADERS_PAYLOAD,
    });
    expect(result.readAt).toBeUndefined();
  });
});
