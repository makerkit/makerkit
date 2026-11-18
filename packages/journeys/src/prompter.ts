import type { Answer, Prompter } from './types';

import { createInterface } from 'node:readline/promises';

/**
 * Asks in the owner's terminal: yes, no (stop) or skip, or a secret typed
 * without echo. Prompts go to stderr, so stdout stays one JSON document
 * under --json.
 */
export function createTerminalPrompter(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
): Prompter {
  return {
    async confirm(question) {
      const rl = createInterface({ input, output, terminal: true });
      // Ctrl-C or a closed input: no, so the run ends and its locks go
      const stop = new AbortController();

      rl.once('SIGINT', () => stop.abort());
      rl.once('close', () => stop.abort());

      try {
        const answer = await rl.question(
          `${question} [y]es / [n]o, stop / [s]kip: `,
          { signal: stop.signal },
        );

        return answerOf(answer.trim().toLowerCase());
      } catch {
        return 'no';
      } finally {
        rl.close();
      }
    },
    secret: (question) => readHidden(input, output, question),
  };
}

function answerOf(answer: string): Answer {
  if (answer === 's' || answer === 'skip') {
    return 'skip';
  }

  return answer === 'y' || answer === 'yes' ? 'yes' : 'no';
}

// raw mode, nothing echoed: Enter ends it, Backspace erases, Ctrl-C cancels
function readHidden(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  question: string,
) {
  output.write(question);
  input.setRawMode?.(true);
  input.setEncoding('utf8');
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = '';

    const finish = (end: () => void) => {
      input.off('data', onData);
      input.setRawMode?.(false);
      input.pause();
      output.write('\n');
      end();
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish(() => resolve(value.trim()));

          return;
        }

        if (char === '\u0003') {
          finish(() => reject(new Error('cancelled at the prompt')));

          return;
        }

        value =
          char === '\u007f' || char === '\b'
            ? value.slice(0, -1)
            : value + char;
      }
    }

    input.on('data', onData);
  });
}
