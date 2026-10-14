import {
  type CommandResult,
  type MailpitDeps,
  MailpitHttpError,
  type MailpitSettings,
} from './mailpit.service';

import { execFile } from 'node:child_process';
import { Socket } from 'node:net';

const REQUEST_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 10_000;
const PORT_CHECK_TIMEOUT_MS = 300;

export interface MailpitNodeOptions {
  /**
   * `settings.url` defaults to the MAILPIT_URL environment variable, then
   * http://127.0.0.1:8025.
   */
  settings?: MailpitSettings;
  /** Abort a Mailpit API request after this many milliseconds. Default: 5000. */
  requestTimeoutMs?: number;
}

/**
 * Node dependencies for a project at `rootPath`: `fetch` for the Mailpit API,
 * a socket check for the port, and `docker compose` (run from `rootPath`)
 * when `settings.docker` is set.
 */
export function createMailpitDeps(
  rootPath = process.cwd(),
  options: MailpitNodeOptions = {},
): MailpitDeps {
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const envUrl = process.env['MAILPIT_URL'];

  return {
    settings: {
      ...options.settings,
      url: options.settings?.url ?? envUrl,
    },
    async request(url, init) {
      const response = await fetch(url, {
        method: init?.method ?? 'GET',
        headers: init?.headers,
        body: init?.body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new MailpitHttpError(response.status, url);
      }

      const contentType = response.headers.get('content-type') ?? '';

      return contentType.includes('application/json')
        ? response.json()
        : response.text();
    },
    isPortOpen,
    executeCommand(command, args) {
      return new Promise<CommandResult>((resolve, reject) => {
        execFile(
          command,
          args,
          { cwd: rootPath, timeout: COMMAND_TIMEOUT_MS },
          (error, stdout, stderr) => {
            if (error) {
              reject(error);
              return;
            }

            resolve({ stdout, stderr, exitCode: 0 });
          },
        );
      });
    },
  };
}

function isPortOpen(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket();

    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(PORT_CHECK_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}
