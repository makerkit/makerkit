import type {
  EmailsListInput,
  EmailsListOutput,
  EmailsReadInput,
  EmailsReadOutput,
  EmailsSetReadStatusInput,
  EmailsSetReadStatusOutput,
  MailboxStatusOutput,
} from './schema';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface MailpitRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface MailpitDeps {
  /**
   * Send an HTTP request to Mailpit. Resolve with the parsed JSON body, or the
   * text body when the response is not JSON. Reject with a `MailpitHttpError`
   * for a non-2xx status, and with any other error when Mailpit cannot be
   * reached.
   */
  request(url: string, init?: MailpitRequestInit): Promise<unknown>;
  /**
   * Optional fast check that something listens on Mailpit's port. Without it,
   * a failed request to the API decides whether Mailpit is running.
   */
  isPortOpen?(host: string, port: number): Promise<boolean>;
  /** Runs a command in the project. Only used when `settings.docker` is set. */
  executeCommand?(command: string, args: string[]): Promise<CommandResult>;
  settings?: MailpitSettings;
}

export interface MailpitSettings {
  /**
   * Mailpit's root URL (the web UI address, without `/api/v1`), or a function
   * that returns it. A function is called on every tool call, so a port read
   * from a config file stays current. Default: http://127.0.0.1:8025.
   */
  url?: string | (() => string | Promise<string>);
  /**
   * Added to the "not running" error to tell the agent how to start Mailpit,
   * e.g. 'Start local services with "pnpm compose:dev:up".'
   */
  startHint?: string;
  /**
   * When Mailpit runs as a Docker Compose service, report whether the
   * container is up. Runs `docker compose -f <composeFile> ps --status running
   * --services` through `executeCommand`. Off by default.
   */
  docker?: {
    /** Compose file, relative to the project root. Default: docker-compose.yml. */
    composeFile?: string;
    /** Compose service name. Default: mailpit. */
    service?: string;
  };
}

export const DEFAULT_MAILPIT_URL = 'http://127.0.0.1:8025';

export const DEFAULT_START_HINT =
  'Start Mailpit (for example "docker run -p 8025:8025 -p 1025:1025 axllent/mailpit") and try again.';

/** A non-2xx response from the Mailpit API. */
export class MailpitHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Mailpit API request failed with status ${status}`);
    this.name = 'MailpitHttpError';
  }
}

interface MailServerStatus {
  running: boolean;
  running_via_docker: boolean;
  api_base_url: string;
}

export function createMailpitService(deps: MailpitDeps) {
  return new MailpitService(deps);
}

export class MailpitService {
  constructor(private readonly deps: MailpitDeps) {}

  async list(input: EmailsListInput): Promise<EmailsListOutput> {
    const mailServer = await this.ensureMailServerReady();

    const payload = asRecord(
      await this.deps.request(
        `${mailServer.api_base_url}/messages?start=${input.start}&limit=${input.limit}`,
      ),
    );

    const messages = asArray(payload.messages ?? payload.Messages).map(
      (message) => this.toSummary(asRecord(message)),
    );

    return {
      mail_server: mailServer,
      start: toNumber(payload.start ?? payload.Start) ?? input.start,
      limit: toNumber(payload.limit ?? payload.Limit) ?? input.limit,
      count: toNumber(payload.count ?? payload.Count) ?? messages.length,
      total: toNumber(payload.total ?? payload.Total) ?? messages.length,
      unread: toNumber(payload.unread ?? payload.Unread),
      messages,
    };
  }

  /** Mailpit marks a message as read when it is fetched. */
  async read(input: EmailsReadInput): Promise<EmailsReadOutput> {
    const mailServer = await this.ensureMailServerReady();
    const messageUrl = `${mailServer.api_base_url}/message/${encodeURIComponent(input.id)}`;

    const message = asRecord(
      await this.requestMessage(input.id, () => this.deps.request(messageUrl)),
    );

    const headers =
      message.Headers ??
      message.headers ??
      (await this.readHeaders(messageUrl));

    const readAt = toString(message.ReadAt ?? message.readAt);

    return {
      mail_server: mailServer,
      id: toString(message.ID ?? message.id) ?? input.id,
      message_id: toString(message.MessageID ?? message.messageId),
      subject: toString(message.Subject ?? message.subject),
      from: readAddressList(message.From ?? message.from),
      to: readAddressList(message.To ?? message.to),
      cc: readAddressList(message.Cc ?? message.cc),
      bcc: readAddressList(message.Bcc ?? message.bcc),
      created_at: toString(
        message.Created ?? message.created ?? message.Date ?? message.date,
      ),
      size: toNumber(message.Size ?? message.size),
      // The message endpoint has no Read field; fetching it marked it read.
      read: toBoolean(message.Read ?? message.read) ?? true,
      ...(readAt ? { readAt } : {}),
      text: readBody(message.Text ?? message.text),
      html: readBody(message.HTML ?? message.Html ?? message.html),
      headers: normalizeHeaders(headers),
      raw: message,
    };
  }

  async setReadStatus(
    input: EmailsSetReadStatusInput,
  ): Promise<EmailsSetReadStatusOutput> {
    const mailServer = await this.ensureMailServerReady();
    const apiBaseUrl = mailServer.api_base_url;

    // Mailpit accepts unknown IDs without an error, so check that the message
    // exists first. The headers endpoint does not mark the message as read.
    await this.requestMessage(input.id, () =>
      this.deps.request(
        `${apiBaseUrl}/message/${encodeURIComponent(input.id)}/headers`,
      ),
    );

    await this.deps.request(`${apiBaseUrl}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: [input.id], Read: input.read }),
    });

    return {
      id: input.id,
      read: input.read,
    };
  }

  async status(): Promise<MailboxStatusOutput> {
    const url = await this.baseUrl();
    const { host, port } = parseHostAndPort(url);
    const apiReachable = await this.isApiReachable(`${url}/api/v1`);
    const portOpen = this.deps.isPortOpen
      ? await this.deps.isPortOpen(host, port)
      : apiReachable;
    const connected = await this.isMailpitRunningViaDocker();

    if (apiReachable) {
      return {
        connected,
        running: portOpen,
        api_reachable: true,
        url,
        port,
      };
    }

    if (connected || portOpen) {
      return {
        connected,
        running: portOpen,
        api_reachable: false,
        url,
        port,
        reason: 'Mailpit appears running but API is unreachable',
      };
    }

    return {
      connected,
      running: false,
      api_reachable: false,
      url,
      port,
      reason: this.notRunningMessage(url),
    };
  }

  private toSummary(message: Record<string, unknown>) {
    const readAt = toString(message.ReadAt ?? message.readAt);

    return {
      id: toString(message.ID ?? message.id) ?? '',
      message_id: toString(message.MessageID ?? message.messageId),
      subject: toString(message.Subject ?? message.subject),
      from: readAddressList(message.From ?? message.from),
      to: readAddressList(message.To ?? message.to),
      created_at: toString(message.Created ?? message.created),
      size: toNumber(message.Size ?? message.size),
      read: toBoolean(message.Read ?? message.read) ?? false,
      ...(readAt ? { readAt } : {}),
    };
  }

  private async ensureMailServerReady(): Promise<MailServerStatus> {
    const url = await this.baseUrl();
    const apiBaseUrl = `${url}/api/v1`;
    const { host, port } = parseHostAndPort(url);

    const portOpen = this.deps.isPortOpen
      ? await this.deps.isPortOpen(host, port)
      : null;
    const runningViaDocker = await this.isMailpitRunningViaDocker();

    const notRunning = () =>
      new Error(
        runningViaDocker
          ? `Mailpit appears running in docker but API is unreachable at ${apiBaseUrl}`
          : this.notRunningMessage(url),
      );

    if (portOpen === false) {
      throw notRunning();
    }

    try {
      await this.deps.request(`${apiBaseUrl}/info`);
    } catch (error) {
      // Without a port check, a connection error means nothing is listening.
      if (portOpen === null && httpStatus(error) === null) {
        throw notRunning();
      }

      throw new Error(
        `Mailpit API is unreachable at ${apiBaseUrl}: ${toErrorMessage(error)}`,
      );
    }

    return {
      running: true,
      running_via_docker: runningViaDocker,
      api_base_url: apiBaseUrl,
    };
  }

  private notRunningMessage(url: string) {
    const hint = this.deps.settings?.startHint ?? DEFAULT_START_HINT;

    return `Mailpit is not running at ${url}. ${hint}`;
  }

  private async baseUrl() {
    const setting = this.deps.settings?.url ?? DEFAULT_MAILPIT_URL;
    const url = typeof setting === 'function' ? await setting() : setting;

    return url.replace(/\/+$/, '');
  }

  private async requestMessage(id: string, request: () => Promise<unknown>) {
    try {
      return await request();
    } catch (error) {
      if (httpStatus(error) === 404) {
        throw new Error(`Email "${id}" not found in Mailpit`);
      }

      throw error;
    }
  }

  private async readHeaders(messageUrl: string) {
    try {
      return await this.deps.request(`${messageUrl}/headers`);
    } catch {
      return {};
    }
  }

  private async isApiReachable(apiBaseUrl: string) {
    try {
      await this.deps.request(`${apiBaseUrl}/info`);
      return true;
    } catch {
      return false;
    }
  }

  private async isMailpitRunningViaDocker() {
    const docker = this.deps.settings?.docker;

    if (!docker || !this.deps.executeCommand) {
      return false;
    }

    try {
      const result = await this.deps.executeCommand('docker', [
        'compose',
        '-f',
        docker.composeFile ?? 'docker-compose.yml',
        'ps',
        '--status',
        'running',
        '--services',
      ]);

      const services = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      return services.includes(docker.service ?? 'mailpit');
    } catch {
      return false;
    }
  }
}

function parseHostAndPort(url: string) {
  const parsed = new URL(url);
  const defaultPort = parsed.protocol === 'https:' ? 443 : 80;

  return {
    host: parsed.hostname.replace(/^\[|\]$/g, '') || '127.0.0.1',
    port: Number(parsed.port) || defaultPort,
  };
}

function normalizeHeaders(input: unknown) {
  const headers = asRecord(input);
  const normalized: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    const values = Array.isArray(value) ? value : [value];

    normalized[key] = values
      .map((item) => toString(item))
      .filter((item): item is string => item !== null);
  }

  return normalized;
}

function readBody(input: unknown): string | null {
  if (typeof input === 'string') {
    return input;
  }

  if (Array.isArray(input)) {
    const chunks = input
      .map((item) => toString(item))
      .filter((item): item is string => item !== null);

    return chunks.length > 0 ? chunks.join('\n\n') : null;
  }

  return null;
}

/** Mailpit sends `From` as one object and `To`/`Cc`/`Bcc` as arrays or null. */
function readAddressList(input: unknown): string[] {
  const entries = Array.isArray(input) ? input : input ? [input] : [];

  return entries
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry || null;
      }

      const item = asRecord(entry);
      const address =
        toString(item.Address ?? item.address ?? item.Email ?? item.email) ??
        '';
      const name = toString(item.Name ?? item.name);

      if (!address) {
        return null;
      }

      return name ? `${name} <${address}>` : address;
    })
    .filter((value): value is string => value !== null);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The HTTP status of a `MailpitHttpError` (or any error with a numeric `status`). */
function httpStatus(error: unknown): number | null {
  if (error instanceof MailpitHttpError) {
    return error.status;
  }

  const status = asRecord(error).status;

  return typeof status === 'number' ? status : null;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}
