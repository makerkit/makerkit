import { appendChangeLog, nextId } from './prd-operations';
import {
  type AddDecisionInput,
  type AddDecisionOutput,
  type AddGlossaryTermInput,
  type AddGlossaryTermOutput,
  type DeletePhaseInput,
  type PhasesOutput,
  PrdSectionValueSchemas,
  type ReorderPhasesInput,
  type ResolveOpenQuestionInput,
  type ResolveOpenQuestionOutput,
  type UpdatePhaseInput,
  type UpdatePrdSectionInput,
  type UpdatePrdSectionOutput,
} from './schema';
import type { CustomPhase, StructuredPRD } from './types';

/**
 * Pure transforms for shaping a PRD after it was created: sections, decisions,
 * open questions, glossary and phases. Same contract as `prd-operations`:
 * mutate the loaded PRD, return the tool payload.
 */

/** Sections whose value replaces the whole list. */
const LIST_SECTIONS = new Set([
  'nonGoals',
  'outOfScope',
  'assumptions',
  'openQuestions',
]);

export function updatePrdSection(
  prd: StructuredPRD,
  input: UpdatePrdSectionInput,
  today: string,
): UpdatePrdSectionOutput {
  const parsed = PrdSectionValueSchemas[input.section].safeParse(input.value);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid value for section "${input.section}": ${issues}`);
  }

  const value = parsed.data;
  let updated: string[];

  if (input.section === 'risks') {
    const risks = value as (typeof PrdSectionValueSchemas)['risks']['_output'];
    const assigned: StructuredPRD['risks'] = [];

    for (const risk of risks) {
      assigned.push({ ...risk, id: risk.id ?? nextId(assigned, 'RISK') });
    }

    prd.risks = assigned;
    updated = assigned.map((risk) => risk.id);
  } else if (input.section === 'dependencies') {
    const items =
      value as (typeof PrdSectionValueSchemas)['dependencies']['_output'];
    const assigned: StructuredPRD['dependencies'] = [];

    for (const item of items) {
      assigned.push({ ...item, id: item.id ?? nextId(assigned, 'DEP') });
    }

    prd.dependencies = assigned;
    updated = assigned.map((item) => item.id);
  } else if (LIST_SECTIONS.has(input.section)) {
    const key = input.section as
      | 'nonGoals'
      | 'outOfScope'
      | 'assumptions'
      | 'openQuestions';

    prd[key] = value as string[];
    updated = [key];
  } else {
    const key = input.section as Exclude<
      keyof typeof PrdSectionValueSchemas,
      | 'risks'
      | 'dependencies'
      | 'nonGoals'
      | 'outOfScope'
      | 'assumptions'
      | 'openQuestions'
    >;

    Object.assign(prd[key], value);
    updated = Object.keys(value as object);
  }

  appendChangeLog(prd, `Updated ${input.section}`, today);

  return { section: input.section, updated };
}

export function addDecision(
  prd: StructuredPRD,
  input: AddDecisionInput,
  today: string,
): AddDecisionOutput {
  let superseded: string | null = null;

  if (input.supersedes) {
    const previous = prd.decisionLog.find(
      (entry) => entry.id === input.supersedes,
    );

    if (!previous) {
      throw new Error(`Decision "${input.supersedes}" not found.`);
    }

    previous.status = 'superseded';
    superseded = previous.id;
  }

  const id = nextId(prd.decisionLog, 'DEC');

  prd.decisionLog.push({
    id,
    date: today,
    decision: input.decision,
    rationale: input.rationale,
    status: input.status,
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
  });

  appendChangeLog(
    prd,
    superseded ? `Recorded ${id} (supersedes ${superseded})` : `Recorded ${id}`,
    today,
  );

  return {
    decision_id: id,
    superseded,
    total_decisions: prd.decisionLog.length,
  };
}

export function resolveOpenQuestion(
  prd: StructuredPRD,
  input: ResolveOpenQuestionInput,
  today: string,
): ResolveOpenQuestionOutput {
  const wanted = normalizeText(input.question);
  const index = prd.openQuestions.findIndex(
    (question) => normalizeText(question) === wanted,
  );

  if (index === -1) {
    throw new Error(
      `Open question not found: "${input.question}". ` +
        (prd.openQuestions.length
          ? `Open questions: ${prd.openQuestions.map((q) => `"${q}"`).join(', ')}.`
          : 'This PRD has no open questions.'),
    );
  }

  const [question] = prd.openQuestions.splice(index, 1);

  let decisionId: string | null = null;

  if (input.recordDecision) {
    decisionId = addDecision(
      prd,
      {
        filename: input.filename,
        decision: input.answer,
        rationale: `Answers the open question: ${question}`,
        topic: 'open-question',
        status: 'accepted',
      },
      today,
    ).decision_id;
  } else {
    appendChangeLog(prd, `Resolved open question: ${question}`, today);
  }

  return {
    remaining_questions: prd.openQuestions.length,
    decision_id: decisionId,
  };
}

/** Adds a term, or replaces the definition of an existing one (any casing). */
export function addGlossaryTerm(
  prd: StructuredPRD,
  input: AddGlossaryTermInput,
  today: string,
): AddGlossaryTermOutput {
  const term = input.term.trim();
  const existing = prd.glossary.find(
    (entry) => entry.term.toLowerCase() === term.toLowerCase(),
  );

  if (existing) {
    existing.term = term;
    existing.definition = input.definition;
    existing.avoid = input.avoid;
  } else {
    prd.glossary.push({
      term,
      definition: input.definition,
      avoid: input.avoid,
    });
  }

  appendChangeLog(
    prd,
    `${existing ? 'Redefined' : 'Defined'} glossary term "${term}"`,
    today,
  );

  return {
    term,
    replaced: Boolean(existing),
    total_terms: prd.glossary.length,
  };
}

export function updatePhase(
  prd: StructuredPRD,
  input: UpdatePhaseInput,
  today: string,
): PhasesOutput {
  const phase = findPhase(prd, input.phaseId);

  if (input.name !== undefined) {
    const name = input.name.trim();
    const clash = prd.customPhases.some(
      (other) =>
        other.id !== phase.id &&
        other.name.toLowerCase() === name.toLowerCase(),
    );

    if (clash) {
      throw new Error(`A phase named "${name}" already exists.`);
    }

    phase.name = name;
  }

  if (input.description !== undefined) phase.description = input.description;
  if (input.color !== undefined) phase.color = input.color;

  appendChangeLog(prd, `Updated phase ${phase.id}`, today);

  return phasesPayload(prd);
}

/** Deletes a phase; its stories stay in the PRD without a phase. */
export function deletePhase(
  prd: StructuredPRD,
  input: DeletePhaseInput,
  today: string,
): PhasesOutput {
  const phase = findPhase(prd, input.phaseId);

  prd.customPhases = prd.customPhases.filter((other) => other.id !== phase.id);
  renumberPhases(prd.customPhases);

  appendChangeLog(prd, `Deleted phase ${phase.id} (${phase.name})`, today);

  return phasesPayload(prd);
}

export function reorderPhases(
  prd: StructuredPRD,
  input: ReorderPhasesInput,
  today: string,
): PhasesOutput {
  const known = prd.customPhases.map((phase) => phase.id).sort();
  const given = [...input.phaseIds].sort();

  if (
    known.length !== given.length ||
    known.some((id, index) => id !== given[index])
  ) {
    throw new Error(
      `phaseIds must list every phase exactly once. Phases: ${known.join(', ') || 'none'}.`,
    );
  }

  prd.customPhases = input.phaseIds.map((id) => findPhase(prd, id));
  renumberPhases(prd.customPhases);

  appendChangeLog(prd, `Reordered phases: ${input.phaseIds.join(', ')}`, today);

  return phasesPayload(prd);
}

function findPhase(prd: StructuredPRD, phaseId: string): CustomPhase {
  const phase = prd.customPhases.find((candidate) => candidate.id === phaseId);

  if (!phase) {
    const known = prd.customPhases.map((candidate) => candidate.id).join(', ');

    throw new Error(
      `Phase "${phaseId}" not found.` +
        (known ? ` Known phases: ${known}.` : ' This PRD has no phases yet.'),
    );
  }

  return phase;
}

function renumberPhases(phases: CustomPhase[]) {
  phases.forEach((phase, index) => {
    phase.order = index;
  });
}

function phasesPayload(prd: StructuredPRD): PhasesOutput {
  return {
    phases: [...prd.customPhases]
      .sort((a, b) => a.order - b.order)
      .map((phase) => ({
        id: phase.id,
        name: phase.name,
        order: phase.order,
        user_story_ids: phase.userStoryIds,
      })),
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
