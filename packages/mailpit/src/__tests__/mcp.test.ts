import { describe, expect, it } from 'vitest';

import { type MailpitDeps, createMailpitService } from '../mailpit.service';
import { registerMailpitTools } from '../mcp';
import { createFakeMcpServer } from '../testing/fake-mcp-server';

function createDeps(running = true): MailpitDeps {
  return {
    async request(url) {
      if (!running) throw new TypeError('fetch failed');
      if (url.endsWith('/info')) return { Version: 'v1.31.3' };
      if (url.includes('/messages?')) {
        return {
          total: 1,
          unread: 1,
          count: 1,
          start: 0,
          messages: [
            {
              ID: 'abc',
              From: { Address: 'noreply@example.com' },
              To: [{ Address: 'user@example.com' }],
              Subject: 'Reset your password',
              Created: '2026-10-14T15:14:04.371Z',
              Read: false,
            },
          ],
        };
      }
      if (url.endsWith('/headers')) return { Subject: ['Reset your password'] };
      if (url.includes('/message/')) {
        return { ID: 'abc', Subject: 'Reset your password', Text: 'Link' };
      }

      return 'ok';
    },
  };
}

describe('registerMailpitTools', () => {
  it('registers the four tools with annotations and output schemas', () => {
    const fake = createFakeMcpServer();

    registerMailpitTools(fake.server, createMailpitService(createDeps()));

    expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
      'emails_list',
      'emails_read',
      'emails_set_read_status',
      'mailbox_status',
    ]);

    for (const tool of fake.tools) {
      expect(tool.config.outputSchema).toBeDefined();
    }

    expect(fake.tool('emails_list').config.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(
      fake.tool('emails_set_read_status').config.annotations,
    ).toMatchObject({ readOnlyHint: false, idempotentHint: true });
  });

  it('keeps the kit names with the kit_ prefix', () => {
    const fake = createFakeMcpServer();

    registerMailpitTools(fake.server, createMailpitService(createDeps()), {
      prefix: 'kit_',
    });

    expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
      'kit_emails_list',
      'kit_emails_read',
      'kit_emails_set_read_status',
      'kit_mailbox_status',
    ]);
  });

  it('leaves out mailbox_status when statusTool is false', () => {
    const fake = createFakeMcpServer();

    registerMailpitTools(fake.server, createMailpitService(createDeps()), {
      prefix: 'kit_',
      statusTool: false,
    });

    expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
      'kit_emails_list',
      'kit_emails_read',
      'kit_emails_set_read_status',
    ]);
  });

  it('returns structured content that satisfies each output schema', async () => {
    const fake = createFakeMcpServer();
    registerMailpitTools(fake.server, createMailpitService(createDeps()));

    const list = await fake.call('emails_list', {});
    expect(list.structuredContent).toMatchObject({ total: 1 });

    const read = await fake.call('emails_read', { id: 'abc' });
    expect(read.structuredContent).toMatchObject({
      subject: 'Reset your password',
      text: 'Link',
    });

    const status = await fake.call('emails_set_read_status', {
      id: 'abc',
      read: false,
    });
    expect(status.structuredContent).toEqual({ id: 'abc', read: false });

    const mailbox = await fake.call('mailbox_status', {});
    expect(mailbox.structuredContent).toMatchObject({ api_reachable: true });
  });

  it('maps a stopped Mailpit to an isError response with the prefixed tool name', async () => {
    const fake = createFakeMcpServer();
    registerMailpitTools(fake.server, createMailpitService(createDeps(false)), {
      prefix: 'kit_',
    });

    const result = await fake.call('kit_emails_list', {});

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(
      'kit_emails_list failed: Mailpit is not running at http://127.0.0.1:8025.',
    );
  });
});
