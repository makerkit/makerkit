import { appendChangeLog } from './prd-operations';
import type { NotApplicableTopic, StructuredPRD } from './types';

/**
 * Parts of a PRD that can be marked "not applicable" (e.g. no rollout plan
 * for an internal tool), so the plan check stops asking for them and agents
 * do not invent them. The core (overview, problem, solution, scope, stories)
 * always applies.
 */
export const NOT_APPLICABLE_TOPICS = [
  'dataModel',
  'outsideServices',
  'security',
  'design',
  'qualityBar',
  'edgeCases',
  'rollout',
  'measurement',
  'glossary',
  'risks',
] as const satisfies readonly NotApplicableTopic[];

export function isNotApplicable(prd: StructuredPRD, topic: NotApplicableTopic) {
  return prd.notApplicable[topic] !== undefined;
}

/** Stored values, with unknown topics and non-string reasons dropped. */
export function normalizeNotApplicable(
  value: unknown,
): StructuredPRD['notApplicable'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const topics = new Set<string>(NOT_APPLICABLE_TOPICS);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([topic, reason]) => topics.has(topic) && typeof reason === 'string',
    ),
  );
}

export function setNotApplicable(
  prd: StructuredPRD,
  input: { topic: NotApplicableTopic; notApplicable: boolean; reason?: string },
  today: string,
) {
  if (input.notApplicable) {
    prd.notApplicable = {
      ...prd.notApplicable,
      [input.topic]: input.reason?.trim() ?? '',
    };
  } else {
    const { [input.topic]: _removed, ...rest } = prd.notApplicable;

    prd.notApplicable = rest;
  }

  appendChangeLog(
    prd,
    input.notApplicable
      ? `Marked ${input.topic} not applicable`
      : `Marked ${input.topic} applicable`,
    today,
  );

  return {
    topic: input.topic,
    not_applicable: input.notApplicable,
    reason: prd.notApplicable[input.topic] ?? null,
  };
}
