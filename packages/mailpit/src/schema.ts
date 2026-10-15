import { z } from 'zod/v3';

export const EmailsListInputSchema = z.object({
  start: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});

const MailServerStatusSchema = z.object({
  running: z.boolean(),
  running_via_docker: z.boolean(),
  api_base_url: z.string(),
});

const EmailSummarySchema = z.object({
  id: z.string(),
  message_id: z.string().nullable(),
  subject: z.string().nullable(),
  from: z.array(z.string()),
  to: z.array(z.string()),
  created_at: z.string().nullable(),
  size: z.number().nullable(),
  read: z.boolean(),
  readAt: z.string().nullable().optional(),
});

export const EmailsListOutputSchema = z.object({
  mail_server: MailServerStatusSchema,
  start: z.number(),
  limit: z.number(),
  count: z.number(),
  total: z.number(),
  unread: z.number().nullable(),
  messages: z.array(EmailSummarySchema),
});

export const EmailsReadInputSchema = z.object({
  id: z.string().min(1),
});

export const EmailsReadOutputSchema = z.object({
  mail_server: MailServerStatusSchema,
  id: z.string(),
  message_id: z.string().nullable(),
  subject: z.string().nullable(),
  from: z.array(z.string()),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  created_at: z.string().nullable(),
  size: z.number().nullable(),
  read: z.boolean(),
  readAt: z.string().nullable().optional(),
  text: z.string().nullable(),
  html: z.string().nullable(),
  headers: z.record(z.array(z.string())),
  raw: z.unknown(),
});

export const EmailsSetReadStatusInputSchema = z.object({
  id: z.string().min(1),
  read: z.boolean(),
});

export const EmailsSetReadStatusOutputSchema = z.object({
  id: z.string(),
  read: z.boolean(),
  readAt: z.string().nullable().optional(),
});

export const MailboxStatusInputSchema = z.object({});

export const MailboxStatusOutputSchema = z.object({
  connected: z.boolean(),
  running: z.boolean(),
  api_reachable: z.boolean(),
  url: z.string().optional(),
  port: z.number().optional(),
  reason: z.string().optional(),
});

export type EmailsListInput = z.infer<typeof EmailsListInputSchema>;
export type EmailsListOutput = z.infer<typeof EmailsListOutputSchema>;
export type EmailsReadInput = z.infer<typeof EmailsReadInputSchema>;
export type EmailsReadOutput = z.infer<typeof EmailsReadOutputSchema>;
export type EmailsSetReadStatusInput = z.infer<
  typeof EmailsSetReadStatusInputSchema
>;
export type EmailsSetReadStatusOutput = z.infer<
  typeof EmailsSetReadStatusOutputSchema
>;
export type MailboxStatusInput = z.infer<typeof MailboxStatusInputSchema>;
export type MailboxStatusOutput = z.infer<typeof MailboxStatusOutputSchema>;
