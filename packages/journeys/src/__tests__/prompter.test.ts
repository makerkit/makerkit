import { describe, expect, it } from 'vitest';

import { createTerminalPrompter } from '../prompter';

import { PassThrough } from 'node:stream';

function terminal() {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  let shown = '';
  const output = {
    write: (text: string) => ((shown += text), true),
  } as unknown as NodeJS.WriteStream;

  return { input, output, shown: () => shown };
}

describe('the terminal prompter', () => {
  it('reads a secret without echoing it, Backspace erasing', async () => {
    const { input, output, shown } = terminal();
    const answer = createTerminalPrompter(input, output).secret('Key: ');

    input.emit('data', 'sk_test_SECRETX');
    input.emit('data', '\u007f\r');

    expect(await answer).toBe('sk_test_SECRET');
    expect(shown()).toBe('Key: \n');
  });

  it('cancels on Ctrl-C', async () => {
    const { input, output } = terminal();
    const answer = createTerminalPrompter(input, output).secret('Key: ');

    input.emit('data', 'sk_\u0003');

    await expect(answer).rejects.toThrow('cancelled');
  });
});

describe('the terminal prompter: confirm', () => {
  const tty = () => ({
    input: new PassThrough() as unknown as NodeJS.ReadStream,
    output: new PassThrough() as unknown as NodeJS.WriteStream,
  });
  const settled = (answer: Promise<unknown>) =>
    Promise.race([
      answer,
      new Promise((resolve) => setTimeout(() => resolve('hung'), 500)),
    ]);

  it('answers no on Ctrl-C, so the run ends', async () => {
    const { input, output } = tty();
    const answer = createTerminalPrompter(input, output).confirm('Seed?');

    input.write('\u0003');

    expect(await settled(answer)).toBe('no');
  });

  it('answers no when the input closes', async () => {
    const { input, output } = tty();
    const answer = createTerminalPrompter(input, output).confirm('Seed?');

    (input as unknown as PassThrough).end();

    expect(await settled(answer)).toBe('no');
  });

  it('reads yes', async () => {
    const { input, output } = tty();
    const answer = createTerminalPrompter(input, output).confirm('Seed?');

    input.write('y\r');

    expect(await settled(answer)).toBe('yes');
  });
});
