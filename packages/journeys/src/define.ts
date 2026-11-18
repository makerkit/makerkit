import type { CheckResult, Journey, Step, StepDefinition } from './types';

export function defineStep<D>(step: StepDefinition<D>): Step<D> {
  const actor = step.actor ?? 'agent';

  if (actor === 'human' && step.apply) {
    throw new Error(
      `Step "${step.id}" is a human step: it can't apply anything.`,
    );
  }

  if (actor === 'agent' && !step.apply) {
    throw new Error(`Step "${step.id}" needs an apply() (or actor: 'human').`);
  }

  return {
    ...step,
    actor,
    kind: step.stop ? 'process' : 'task',
    confirm: step.confirm ?? { level: 'run' },
  };
}

/**
 * A step the kit only checks: the agent runs the fix it names (`pnpm
 * install`, `pnpm db:start`). For kit:doctor; a journey applies its steps.
 */
export function defineCheck<D>(
  step: Omit<StepDefinition<D>, 'apply' | 'stop' | 'actor' | 'confirm'>,
): Step<D> {
  return {
    ...step,
    actor: 'agent',
    kind: 'check',
    confirm: { level: 'none' },
  };
}

export function defineJourney<D>(journey: Journey<D>): Journey<D> {
  if (journey.scope === '') {
    throw new Error(`Journey "${journey.id}" has an empty scope.`);
  }

  const ids = journey.steps.map((step) => step.id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);

  if (repeated.length > 0) {
    throw new Error(
      `Journey "${journey.id}" repeats step ids: ${repeated.join(', ')}.`,
    );
  }

  for (const [index, step] of journey.steps.entries()) {
    const unknown = (step.needs ?? []).filter(
      (id) => !ids.slice(0, index).includes(id),
    );

    if (unknown.length > 0) {
      throw new Error(
        `Step "${step.id}" needs ${unknown.join(', ')}, which ${unknown.length === 1 ? "isn't an earlier step" : "aren't earlier steps"}.`,
      );
    }
  }

  return journey;
}

export const done = (message?: string): CheckResult => ({
  state: 'done',
  message,
});

export const todo = (
  message: string,
  more: Omit<CheckResult, 'state' | 'message'> = {},
): CheckResult => ({ state: 'todo', message, ...more });

export const waiting = (
  message: string,
  more: Omit<CheckResult, 'state' | 'message'> = {},
): CheckResult => ({ state: 'waiting', message, ...more });

export const failed = (
  message: string,
  more: Omit<CheckResult, 'state' | 'message'> = {},
): CheckResult => ({ state: 'failed', message, ...more });
