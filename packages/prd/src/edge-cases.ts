import type { EdgeCase, StructuredPRD } from './types';

/**
 * Edge cases as stored, with hand-edited entries that would break readers
 * dropped: each needs a string id and case; status defaults to "open".
 */
export function normalizeEdgeCases(value: unknown): EdgeCase[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): EdgeCase[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const { id, case: caseText, expectedBehavior, status, storyIds } =
      entry as Record<string, unknown>;

    if (typeof id !== 'string' || typeof caseText !== 'string' || !caseText) {
      return [];
    }

    const ids = Array.isArray(storyIds)
      ? storyIds.filter((storyId): storyId is string => typeof storyId === 'string')
      : [];

    return [
      {
        id,
        case: caseText,
        expectedBehavior: typeof expectedBehavior === 'string' ? expectedBehavior : '',
        status: status === 'decided' ? 'decided' : 'open',
        ...(ids.length > 0 ? { storyIds: ids } : {}),
      },
    ];
  });
}

/** The edge cases that apply to a story: those linked to it, and those linked to no story. */
export function edgeCasesForStory(prd: StructuredPRD, storyId: string) {
  return prd.edgeCases.filter(
    (edgeCase) => !edgeCase.storyIds?.length || edgeCase.storyIds.includes(storyId),
  );
}

/** Accepted decisions whose topic starts with `design`, e.g. `design:navigation`. */
export function designDecisions(prd: StructuredPRD) {
  return prd.decisionLog.filter(
    (entry) => entry.status === 'accepted' && entry.topic?.startsWith('design'),
  );
}
