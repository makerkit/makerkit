import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { MailpitService } from './mailpit.service';
import {
  EmailsListInputSchema,
  EmailsListOutputSchema,
  EmailsReadInputSchema,
  EmailsReadOutputSchema,
  EmailsSetReadStatusInputSchema,
  EmailsSetReadStatusOutputSchema,
  MailboxStatusInputSchema,
  MailboxStatusOutputSchema,
} from './schema';
import {
  IDEMPOTENT_MUTATING_TOOL,
  READ_ONLY_TOOL,
  buildErrorResponse,
  buildStructuredResponse,
} from './tool-response';

export interface RegisterMailpitOptions {
  /** Prepended to every tool name, e.g. "kit_" keeps a kit's existing names. */
  prefix?: string;
  /**
   * Register mailbox_status. Default: true. Pass false when the server
   * already has a tool with that name.
   */
  statusTool?: boolean;
}

/**
 * Registers emails_list, emails_read, emails_set_read_status and, unless
 * `statusTool` is false, mailbox_status.
 */
export function registerMailpitTools(
  server: McpServer,
  service: MailpitService,
  options: RegisterMailpitOptions = {},
) {
  const name = (tool: string) => `${options.prefix ?? ''}${tool}`;

  server.registerTool(
    name('emails_list'),
    {
      title: 'List received emails',
      description:
        'List received emails from the local Mailpit inbox (runtime mailbox, not source templates), newest first.',
      inputSchema: EmailsListInputSchema,
      outputSchema: EmailsListOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = EmailsListInputSchema.parse(input);

        return buildStructuredResponse(await service.list(parsed));
      } catch (error) {
        return buildErrorResponse(name('emails_list'), error);
      }
    },
  );

  server.registerTool(
    name('emails_read'),
    {
      title: 'Read an email',
      description:
        'Read a received email from the local Mailpit inbox by message id (includes text/html/headers). Mailpit marks the email as read.',
      inputSchema: EmailsReadInputSchema,
      outputSchema: EmailsReadOutputSchema,
      // Only flips Mailpit's read flag, which the agent cannot rely on anyway.
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = EmailsReadInputSchema.parse(input);

        return buildStructuredResponse(await service.read(parsed));
      } catch (error) {
        return buildErrorResponse(name('emails_read'), error);
      }
    },
  );

  server.registerTool(
    name('emails_set_read_status'),
    {
      title: 'Mark an email read or unread',
      description:
        'Set read/unread status for a received email in the local Mailpit inbox and return the new status.',
      inputSchema: EmailsSetReadStatusInputSchema,
      outputSchema: EmailsSetReadStatusOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = EmailsSetReadStatusInputSchema.parse(input);

        return buildStructuredResponse(await service.setReadStatus(parsed));
      } catch (error) {
        return buildErrorResponse(name('emails_set_read_status'), error);
      }
    },
  );

  if (options.statusTool === false) {
    return;
  }

  server.registerTool(
    name('mailbox_status'),
    {
      title: 'Check Mailpit',
      description:
        'Check whether Mailpit is running and its API is reachable, with the reason and how to start it when it is not.',
      inputSchema: MailboxStatusInputSchema,
      outputSchema: MailboxStatusOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        MailboxStatusInputSchema.parse(input);

        return buildStructuredResponse(await service.status());
      } catch (error) {
        return buildErrorResponse(name('mailbox_status'), error);
      }
    },
  );
}
