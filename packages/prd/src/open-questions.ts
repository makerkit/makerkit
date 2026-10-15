import type { OpenQuestion, StructuredPRD } from './types';

/**
 * Open questions as stored. Older files hold plain strings; they become
 * questions with ids in list order. Entries without question text are dropped.
 */
export function normalizeOpenQuestions(value: unknown): OpenQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const questions: OpenQuestion[] = [];

  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) {
        questions.push({ id: '', question: entry });
      }

      continue;
    }

    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const { id, question, why, options, recommended, storyIds } = entry as Record<
      string,
      unknown
    >;

    if (typeof question !== 'string' || !question.trim()) {
      continue;
    }

    const strings = (list: unknown) =>
      Array.isArray(list)
        ? list.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [];

    questions.push({
      id: typeof id === 'string' ? id : '',
      question,
      ...(typeof why === 'string' && why ? { why } : {}),
      ...(strings(options).length ? { options: strings(options) } : {}),
      ...(typeof recommended === 'string' && recommended ? { recommended } : {}),
      ...(strings(storyIds).length ? { storyIds: strings(storyIds) } : {}),
    });
  }

  // Legacy strings (and hand-written entries) get ids after the highest one present
  let highest = questions.reduce((max, question) => {
    const match = /^Q(\d+)$/.exec(question.id);

    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return questions.map((question) =>
    question.id ? question : { ...question, id: formatQuestionId(++highest) },
  );
}

function formatQuestionId(number: number) {
  return `Q${String(number).padStart(3, '0')}`;
}

/**
 * The next question id. Answered questions are quoted in decisions, so an id
 * is never handed out twice: the high-water mark is kept in metadata.
 */
export function nextQuestionId(prd: StructuredPRD, extra: OpenQuestion[] = []) {
  const present = [...prd.openQuestions, ...extra].reduce((max, question) => {
    const match = /^Q(\d+)$/.exec(question.id);

    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const next = Math.max(prd.metadata.lastQuestionNumber ?? 0, present) + 1;

  prd.metadata.lastQuestionNumber = next;

  return formatQuestionId(next);
}

/** Open questions that block a story that is not completed yet. */
export function blockingQuestions(prd: StructuredPRD) {
  const unfinished = new Set(
    prd.userStories.filter((story) => story.status !== 'completed').map((story) => story.id),
  );

  return prd.openQuestions.filter((question) =>
    question.storyIds?.some((id) => unfinished.has(id)),
  );
}
