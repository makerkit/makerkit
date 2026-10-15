import { describe, expect, it } from 'vitest';

import { createMailpitService } from '../mailpit.service';
import { createMailpitDeps } from '../node';

// Set to a running Mailpit, e.g. http://127.0.0.1:54324 for a local Supabase
// or http://127.0.0.1:8025 for the Docker image. The test sends one email
// through Mailpit's send API and deletes it afterwards.
const MAILPIT_URL = process.env['TEST_MAILPIT_URL'];

describe('createMailpitDeps', () => {
  it('fails fast with the hint when Mailpit is not running', async () => {
    const service = createMailpitService(
      createMailpitDeps(process.cwd(), {
        settings: {
          url: 'http://127.0.0.1:1',
          startHint: 'Start it with "pnpm mail:up".',
        },
      }),
    );
    const startedAt = Date.now();

    await expect(service.list({ start: 0, limit: 10 })).rejects.toThrow(
      'Mailpit is not running at http://127.0.0.1:1. Start it with "pnpm mail:up".',
    );
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe.skipIf(!MAILPIT_URL)('against a running Mailpit', () => {
  const api = `${(MAILPIT_URL ?? '').replace(/\/+$/, '')}/api/v1`;

  async function send(subject: string) {
    const response = await fetch(`${api}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: { Email: 'noreply@example.com', Name: 'App' },
        To: [{ Email: 'user@example.com' }],
        Subject: subject,
        Text: 'Confirm: https://example.com/confirm?token=abc',
        HTML: '<a href="https://example.com/confirm?token=abc">Confirm</a>',
      }),
    });

    return ((await response.json()) as { ID: string }).ID;
  }

  async function remove(id: string) {
    await fetch(`${api}/messages`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: [id] }),
    });
  }

  it('lists, reads and marks an email unread', async () => {
    const service = createMailpitService(
      createMailpitDeps(process.cwd(), { settings: { url: MAILPIT_URL } }),
    );
    const subject = `mailpit-test-${Date.now()}`;
    const id = await send(subject);

    try {
      const findSummary = async () => {
        const { messages } = await service.list({ start: 0, limit: 200 });
        return messages.find((message) => message.subject === subject);
      };

      expect(await findSummary()).toMatchObject({
        id,
        from: ['App <noreply@example.com>'],
        to: ['user@example.com'],
        read: false,
      });

      const email = await service.read({ id });
      expect(email).toMatchObject({
        subject,
        from: ['App <noreply@example.com>'],
        read: true,
      });
      expect(email.text).toContain('token=abc');
      expect(email.headers['Subject']).toEqual([subject]);

      expect(await findSummary()).toMatchObject({ read: true });

      expect(await service.setReadStatus({ id, read: false })).toEqual({
        id,
        read: false,
      });
      expect(await findSummary()).toMatchObject({ read: false });

      await expect(
        service.setReadStatus({ id: 'does-not-exist', read: true }),
      ).rejects.toThrow('not found');

      expect(await service.status()).toMatchObject({
        running: true,
        api_reachable: true,
      });
    } finally {
      await remove(id);
    }
  });
});
