import type { HandoffResult, NextStep } from './schema';

// a value as output shows it: enough to recognize, never the secret
export function mask(value: string | undefined) {
  if (!value) {
    return '(empty)';
  }

  const prefix =
    /^(sk|rk|pk|whsec|price)_(test_|live_)?/.exec(value)?.[0] ?? '';

  // a short secret's last four would give most of it away
  if (value.length - prefix.length < 12) {
    return `${prefix}…`;
  }

  return `${prefix}…${value.slice(-4)}`;
}

/**
 * The result with every known secret value replaced by its mask, wherever it
 * appears: masking doesn't depend on each message remembering to call mask().
 */
export function scrub<T>(value: T, secrets: readonly string[]): T {
  const known = secrets.filter((secret) => secret.length >= 8);

  if (known.length === 0) {
    return value;
  }

  const clean = (text: string) =>
    known.reduce((out, secret) => out.split(secret).join(mask(secret)), text);

  return JSON.parse(JSON.stringify(value), (_key, field: unknown) =>
    typeof field === 'string' ? clean(field) : field,
  ) as T;
}

export function humanStep(step: Omit<NextStep, 'actor'>): NextStep {
  return { actor: 'human', ...withoutEmpty(step) };
}

export function agentStep(step: Omit<NextStep, 'actor'>): NextStep {
  return { actor: 'agent', ...withoutEmpty(step) };
}

const ICONS: Record<string, string> = {
  done: '✓',
  todo: '•',
  waiting: '!',
  running: '…',
  skipped: '–',
  failed: '✗',
};

// for a person reading a terminal: the summary first, then each step (with
// who fixes it), then what to do next (design guidance)
export function renderText(result: HandoffResult) {
  const lines = ['', result.summary, ''];

  for (const step of result.steps) {
    lines.push(`${ICONS[step.state] ?? '•'} ${step.title}`);

    for (const line of [step.message, ...(step.changes ?? [])]) {
      if (line) {
        lines.push(`    ${line}`);
      }
    }

    if (step.fix && step.state !== 'done') {
      // who does the fix: the agent (a command) or the owner
      lines.push(
        `    → ${step.actor === 'human' ? 'You' : 'Agent'}: ${step.fix}${step.url ? ` (${step.url})` : ''}`,
      );
    }
  }

  if (result.nextSteps.length > 0) {
    lines.push('', 'Next:');

    for (const next of result.nextSteps) {
      lines.push(
        `  ${next.actor === 'human' ? 'You' : 'Agent'}: ${next.instructions}`,
      );

      if (next.url) {
        lines.push(`        ${next.url}`);
      }

      if (next.resumeWith) {
        lines.push(`        then run: ${next.resumeWith}`);
      }
    }
  }

  lines.push('');

  return lines.join('\n');
}

function withoutEmpty<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, field]) => field !== undefined && field !== '',
    ),
  ) as T;
}
