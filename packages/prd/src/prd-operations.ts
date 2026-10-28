import { resolveAttachments } from './attachment-paths';
import { designDecisions, edgeCasesForStory } from './edge-cases';
import type {
  AssignStoryToPhaseInput,
  AssignStoryToPhaseOutput,
  CreateCustomPhaseInput,
  CreateCustomPhaseOutput,
  DeleteUserStoryOutput,
  UpdateUserStoryInput,
  UpdateUserStoryOutput,
} from './schema';
import type {
  CriterionProof,
  StoryLogEntry,
  StoryStatus,
  StructuredPRD,
  UserStory,
} from './types';

/**
 * Pure PRD transforms.
 *
 * Everything here takes an already-loaded `StructuredPRD`, mutates it, and
 * returns the tool payload. No filesystem, no clock, no deps — the service is
 * left with load → transform → save, and every rule below is unit-testable
 * without a harness.
 */

/**
 * Issues the next story id and advances the high-water mark.
 *
 * Deliberately not `max(existing) + 1`: delete the highest-numbered story and
 * that hands its id straight to the next one, so a story id quoted in a commit
 * or a decision-log topic would silently come to mean something else.
 */
export function nextId(items: { id: string }[], prefix: string) {
  const highest = items.reduce((max, item) => {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(item.id);

    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

export function nextStoryId(prd: StructuredPRD) {
  const highestPresent = prd.userStories.reduce((max, story) => {
    const match = /^US(\d+)$/.exec(story.id);

    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  const next = Math.max(prd.metadata.lastStoryNumber ?? 0, highestPresent) + 1;

  prd.metadata.lastStoryNumber = next;

  return `US${String(next).padStart(3, '0')}`;
}

export function recomputeProgress(prd: StructuredPRD) {
  const total = prd.userStories.length;
  const completed = prd.userStories.filter(
    (story) => story.status === 'completed',
  ).length;
  const blocked = prd.userStories.filter(
    (story) => story.status === 'blocked',
  ).length;

  prd.progress = {
    completed,
    blocked,
    total,
    overall: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export function appendChangeLog(
  prd: StructuredPRD,
  entry: string,
  today: string,
) {
  prd.changeLog.push(`${today}: ${entry}`);
}

export function findStory(prd: StructuredPRD, storyId: string): UserStory {
  const story = prd.userStories.find((candidate) => candidate.id === storyId);

  if (!story) {
    const known = prd.userStories.map((candidate) => candidate.id).join(', ');

    throw new Error(
      `Story ${storyId} not found.` +
        (known ? ` Known stories: ${known}.` : ' This PRD has no stories yet.'),
    );
  }

  return story;
}

const USER_STORY_SENTENCE =
  /^As an?\s+(.+?),\s*I want to\s+(.+?)\s+so that\s+(.+)$/i;

/** Splits the rendered sentence back into its parts so one can be patched. */
/** The parts of an "As a X, I want to Y so that Z" story, or undefined. */
export function splitUserStory(sentence: string) {
  const match = USER_STORY_SENTENCE.exec(sentence.trim());

  if (!match) {
    return undefined;
  }

  return { userType: match[1]!, action: match[2]!, benefit: match[3]! };
}

export function renderUserStory(parts: {
  userType: string;
  action: string;
  benefit: string;
}) {
  return `As a ${parts.userType}, I want to ${parts.action} so that ${parts.benefit}`;
}

export function updateStory(
  prd: StructuredPRD,
  input: UpdateUserStoryInput,
  today: string,
): UpdateUserStoryOutput {
  const story = findStory(prd, input.storyId);
  const updated: string[] = [];

  const wantsSentenceEdit =
    input.userType !== undefined ||
    input.action !== undefined ||
    input.benefit !== undefined;

  if (wantsSentenceEdit) {
    const current = splitUserStory(story.userStory);

    if (
      !current &&
      (input.userType === undefined ||
        input.action === undefined ||
        input.benefit === undefined)
    ) {
      throw new Error(
        `Story ${story.id} does not use the "As a X, I want to Y so that Z" form, ` +
          'so its parts cannot be patched individually. Supply userType, action and benefit together.',
      );
    }

    const parts = {
      userType: input.userType ?? current!.userType,
      action: input.action ?? current!.action,
      benefit: input.benefit ?? current!.benefit,
    };

    story.userStory = renderUserStory(parts);
    updated.push('userStory');

    // The benefit *is* the business value unless one was set explicitly.
    if (input.benefit !== undefined && input.businessValue === undefined) {
      story.businessValue = input.benefit;
      updated.push('businessValue');
    }
  }

  if (input.title !== undefined) {
    story.title = input.title;
    updated.push('title');
  }

  if (input.testSeams !== undefined) {
    story.testSeams = input.testSeams;
    updated.push('testSeams');
  }

  if (input.designNotes !== undefined) {
    story.designNotes = withoutBlanks(input.designNotes);
    updated.push('designNotes');
  }

  if (input.securityNotes !== undefined) {
    story.securityNotes = withoutBlanks(input.securityNotes);
    updated.push('securityNotes');
  }

  if (input.businessValue !== undefined) {
    story.businessValue = input.businessValue;
    updated.push('businessValue');
  }

  if (input.acceptanceCriteria !== undefined) {
    story.acceptanceCriteria = input.acceptanceCriteria.filter(
      (entry) => entry.trim().length > 0,
    );
    updated.push('acceptanceCriteria');

    // A proof for a criterion that is gone proves nothing.
    if (input.proofs === undefined && story.proofs?.length) {
      const kept = story.proofs.filter((proof) =>
        story.acceptanceCriteria.includes(proof.criterion),
      );

      if (kept.length !== story.proofs.length) {
        story.proofs = kept;
        updated.push('proofs');
      }
    }
  }

  if (input.proofs !== undefined) {
    story.proofs = validateProofs(story.acceptanceCriteria, input.proofs);
    updated.push('proofs');
  }

  if (input.priority !== undefined) {
    story.priority = input.priority;
    updated.push('priority');
  }

  if (input.estimatedComplexity !== undefined) {
    story.estimatedComplexity = input.estimatedComplexity;
    updated.push('estimatedComplexity');
  }

  if (input.dependencies !== undefined) {
    story.dependencies = validateDependencies(
      prd,
      story.id,
      input.dependencies,
    );
    updated.push('dependencies');
  }

  if (input.notes !== undefined) {
    story.notes = input.notes;
    updated.push('notes');
  }

  if (input.attachmentIds !== undefined) {
    story.attachmentIds = validateAttachmentIds(prd, input.attachmentIds);
    updated.push('attachmentIds');
  }

  // In the same write, so a story and its phase never change half-way
  if (input.phaseId !== undefined) {
    assignStoryToPhase(
      prd,
      { filename: input.filename, storyId: story.id, phaseId: input.phaseId },
      today,
    );
    updated.push('phase');
  }

  if (updated.length === 0) {
    throw new Error(
      `No fields supplied to update on ${story.id}. Provide at least one of: ` +
        'title, userType, action, benefit, businessValue, acceptanceCriteria, ' +
        'priority, estimatedComplexity, dependencies, notes, testSeams, proofs, designNotes, securityNotes, attachmentIds, phaseId.',
    );
  }

  appendChangeLog(prd, `Updated ${story.id} (${updated.join(', ')})`, today);

  return {
    story_id: story.id,
    title: story.title,
    updated_fields: [...new Set(updated)],
    story: story as unknown as Record<string, unknown>,
  };
}

export function findAttachment(prd: StructuredPRD, attachmentId: string) {
  const attachment = prd.attachments.find(
    (candidate) => candidate.id === attachmentId,
  );

  if (!attachment) {
    throw new Error(`Attachment "${attachmentId}" not found.`);
  }

  return attachment;
}

/** Attachment ids must name attachments in the PRD. */
export function validateAttachmentIds(prd: StructuredPRD, ids: string[]) {
  for (const id of ids) {
    findAttachment(prd, id);
  }

  return [...new Set(ids)];
}

/**
 * Each proof must name one of the story's criteria, at most once, and a proof
 * no test makes must say why — the reason is what a reviewer judges.
 */
export function validateProofs(
  criteria: string[],
  proofs: CriterionProof[],
): CriterionProof[] {
  const seen = new Set<string>();

  return proofs.map((proof) => {
    const criterion = criteria.find(
      (candidate) => candidate.trim() === proof.criterion.trim(),
    );

    if (criterion === undefined) {
      throw new Error(
        `Proof names a criterion the story does not have: "${proof.criterion}". Copy the criterion exactly.`,
      );
    }

    if (seen.has(criterion)) {
      throw new Error(`Criterion "${criterion}" has more than one proof.`);
    }

    seen.add(criterion);

    const reason = proof.reason?.trim();

    if ((proof.kind === 'manual' || proof.kind === 'post-deploy') && !reason) {
      throw new Error(
        `A ${proof.kind} proof needs a reason: why no test can prove "${criterion}".`,
      );
    }

    const rubric = (proof.rubric ?? [])
      .map((point) => point.trim())
      .filter(Boolean);

    if (proof.kind === 'judge' && rubric.length === 0) {
      throw new Error(
        `A judge proof needs a rubric: what the reviewer scores "${criterion}" against.`,
      );
    }

    const seam = proof.seam?.trim();
    const fallback = proof.fallback?.trim();

    return {
      criterion,
      kind: proof.kind,
      ...(seam ? { seam } : {}),
      ...(reason ? { reason } : {}),
      ...(fallback ? { fallback } : {}),
      ...(rubric.length > 0 ? { rubric } : {}),
    };
  });
}

/**
 * Dependencies must name real stories, never the story itself, and never form
 * a cycle — an unsatisfiable order is worse than no order at all.
 */
export function validateDependencies(
  prd: StructuredPRD,
  storyId: string,
  dependencies: string[],
) {
  const unique = [
    ...new Set(dependencies.filter((id) => id.trim().length > 0)),
  ];

  for (const id of unique) {
    if (id === storyId) {
      throw new Error(`Story ${storyId} cannot depend on itself.`);
    }

    findStory(prd, id);
  }

  const edges = new Map(
    prd.userStories.map((story) => [
      story.id,
      story.id === storyId ? unique : story.dependencies,
    ]),
  );

  const cycle = findCycle(edges, storyId);

  if (cycle) {
    throw new Error(
      `Dependency cycle: ${cycle.join(' -> ')}. Remove one of these links.`,
    );
  }

  return unique;
}

function findCycle(edges: Map<string, string[]>, from: string) {
  const visiting = new Set<string>();
  const done = new Set<string>();

  const walk = (id: string, trail: string[]): string[] | undefined => {
    if (done.has(id)) return undefined;
    if (visiting.has(id)) return [...trail, id];

    visiting.add(id);

    for (const next of edges.get(id) ?? []) {
      const found = walk(next, [...trail, id]);

      if (found) return found;
    }

    visiting.delete(id);
    done.add(id);

    return undefined;
  };

  return walk(from, []);
}

export function deleteStory(
  prd: StructuredPRD,
  storyId: string,
  today: string,
): DeleteUserStoryOutput {
  const story = findStory(prd, storyId);

  prd.userStories = prd.userStories.filter(
    (candidate) => candidate.id !== storyId,
  );

  // Ids are never reissued, but references to the deleted story have to go or
  // the plan describes an ordering against something that no longer exists.
  const dependencyReferencesRemoved: string[] = [];

  for (const candidate of prd.userStories) {
    if (candidate.dependencies.includes(storyId)) {
      candidate.dependencies = candidate.dependencies.filter(
        (id) => id !== storyId,
      );
      dependencyReferencesRemoved.push(candidate.id);
    }
  }

  const phasesUpdated: string[] = [];

  for (const phase of prd.customPhases) {
    if (phase.userStoryIds.includes(storyId)) {
      phase.userStoryIds = phase.userStoryIds.filter((id) => id !== storyId);
      phasesUpdated.push(phase.id);
    }
  }

  // An edge case linked only to the deleted story would otherwise become
  // PRD-wide, so it is dropped; shared ones lose the link.
  prd.edgeCases = prd.edgeCases.flatMap((edgeCase) => {
    if (!edgeCase.storyIds?.includes(storyId)) {
      return [edgeCase];
    }

    const storyIds = edgeCase.storyIds.filter((id) => id !== storyId);

    return storyIds.length > 0 ? [{ ...edgeCase, storyIds }] : [];
  });

  for (const question of prd.openQuestions) {
    if (question.storyIds?.includes(storyId)) {
      const storyIds = question.storyIds.filter((id) => id !== storyId);

      if (storyIds.length > 0) {
        question.storyIds = storyIds;
      } else {
        delete question.storyIds;
      }
    }
  }

  // Decisions about a deleted story are history, not live commitments.
  for (const entry of prd.decisionLog) {
    if (
      entry.topic?.startsWith(`story:${storyId}:`) &&
      entry.status === 'accepted'
    ) {
      entry.status = 'superseded';
    }
  }

  recomputeProgress(prd);
  appendChangeLog(prd, `Deleted ${storyId} (${story.title})`, today);

  return {
    story_id: storyId,
    title: story.title,
    total_stories: prd.userStories.length,
    progress: prd.progress.overall,
    dependency_references_removed: dependencyReferencesRemoved,
    phases_updated: phasesUpdated,
  };
}

export function createPhase(
  prd: StructuredPRD,
  input: CreateCustomPhaseInput,
  today: string,
): CreateCustomPhaseOutput {
  const name = input.name.trim();

  if (
    prd.customPhases.some(
      (phase) => phase.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error(`A phase named "${name}" already exists.`);
  }

  const phase = {
    id: nextId(prd.customPhases, 'PHASE'),
    name,
    description: input.description,
    color: input.color,
    order: prd.customPhases.length,
    userStoryIds: [] as string[],
  };

  prd.customPhases.push(phase);
  appendChangeLog(prd, `Created phase ${phase.id} (${name})`, today);

  return {
    phase: {
      id: phase.id,
      name: phase.name,
      description: phase.description,
      color: phase.color,
      order: phase.order,
      user_story_ids: phase.userStoryIds,
    },
    total_phases: prd.customPhases.length,
  };
}

export function assignStoryToPhase(
  prd: StructuredPRD,
  input: AssignStoryToPhaseInput,
  today: string,
): AssignStoryToPhaseOutput {
  findStory(prd, input.storyId);

  const target =
    input.phaseId === null
      ? undefined
      : prd.customPhases.find((phase) => phase.id === input.phaseId);

  if (input.phaseId !== null && !target) {
    const known = prd.customPhases.map((phase) => phase.id).join(', ');

    throw new Error(
      `Phase "${input.phaseId}" not found.` +
        (known ? ` Known phases: ${known}.` : ' This PRD has no phases yet.'),
    );
  }

  // A story belongs to at most one phase, so clear it out of the others first.
  const previous = prd.customPhases.find((phase) =>
    phase.userStoryIds.includes(input.storyId),
  );

  for (const phase of prd.customPhases) {
    phase.userStoryIds = phase.userStoryIds.filter(
      (id) => id !== input.storyId,
    );
  }

  target?.userStoryIds.push(input.storyId);

  appendChangeLog(
    prd,
    target
      ? `Assigned ${input.storyId} to ${target.id} (${target.name})`
      : `Removed ${input.storyId} from all phases`,
    today,
  );

  return {
    story_id: input.storyId,
    phase_id: target?.id ?? null,
    phase_name: target?.name ?? null,
    moved_from: previous && previous.id !== target?.id ? previous.id : null,
  };
}

// Workflow ------------------------------------------------------------------

/** Statuses that mean work on the story has started or finished. */
const WORK_STATUSES: StoryStatus[] = ['in_progress', 'review', 'completed'];

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

/** Dependencies of `story` that are not completed yet. */
export function incompleteDependencies(prd: StructuredPRD, story: UserStory) {
  return story.dependencies.filter((id) => {
    const dependency = prd.userStories.find((candidate) => candidate.id === id);

    return dependency?.status !== 'completed';
  });
}

/**
 * A story cannot be worked on, reviewed or completed before the stories it
 * depends on are completed. `not_started`, `research` and `blocked` stay
 * available so a story can still be planned or parked.
 */
export function assertCanEnterStatus(
  prd: StructuredPRD,
  story: UserStory,
  status: StoryStatus,
) {
  if (!WORK_STATUSES.includes(status)) {
    return;
  }

  const waitingOn = incompleteDependencies(prd, story);

  if (waitingOn.length > 0) {
    throw new Error(
      `Cannot move ${story.id} to ${status}: it depends on ${waitingOn.join(', ')}, which ${waitingOn.length === 1 ? 'is' : 'are'} not completed yet.`,
    );
  }
}

/** Position of the story's phase; stories without a phase come last. */
function phaseRank(prd: StructuredPRD, storyId: string) {
  const phase = prd.customPhases.find((candidate) =>
    candidate.userStoryIds.includes(storyId),
  );

  return phase ? phase.order : Number.MAX_SAFE_INTEGER;
}

/**
 * The next story to start: not started, every dependency completed, ordered
 * by phase, then priority, then position in the PRD.
 */
export function pickNextStory(prd: StructuredPRD) {
  const notStarted = prd.userStories.filter(
    (story) => story.status === 'not_started',
  );

  const ready = notStarted
    .filter((story) => incompleteDependencies(prd, story).length === 0)
    .sort(
      (a, b) =>
        phaseRank(prd, a.id) - phaseRank(prd, b.id) ||
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        prd.userStories.indexOf(a) - prd.userStories.indexOf(b),
    );

  const waiting = notStarted
    .map((story) => ({
      id: story.id,
      title: story.title,
      waiting_on: incompleteDependencies(prd, story),
    }))
    .filter((entry) => entry.waiting_on.length > 0);

  return {
    story: ready[0] ?? null,
    ready_count: ready.length,
    in_progress: prd.userStories
      .filter((story) => story.status === 'in_progress')
      .map((story) => story.id),
    waiting,
  };
}

/**
 * Everything an agent needs to work on one story without loading the whole
 * PRD: the story, the scope boundaries, its dependencies with their hand-off
 * logs, and the log of the most recently completed story.
 */
/** `filename` is the PRD's file name, used to give attachment paths. */
export function buildStoryContext(
  prd: StructuredPRD,
  storyId: string,
  filename: string,
) {
  const story = findStory(prd, storyId);
  const linked = new Set(story.attachmentIds ?? []);
  const phase =
    prd.customPhases.find((candidate) =>
      candidate.userStoryIds.includes(story.id),
    ) ?? null;

  const lastCompleted =
    prd.userStories
      .filter((candidate) => candidate.status === 'completed')
      .filter((candidate) => candidate.id !== story.id)
      .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''))
      .at(-1) ?? null;

  return {
    prd: {
      title: prd.introduction.title,
      overview: prd.introduction.overview,
      non_goals: prd.nonGoals,
      out_of_scope: prd.outOfScope,
      global_acceptance_criteria: prd.acceptanceCriteria.global,
      attachments: resolveAttachments(filename, prd.attachments),
    },
    story,
    attachments: resolveAttachments(
      filename,
      prd.attachments.filter((attachment) => linked.has(attachment.id)),
    ),
    phase: phase ? { id: phase.id, name: phase.name } : null,
    edge_cases: edgeCasesForStory(prd, story.id),
    open_questions: prd.openQuestions.filter((question) =>
      question.storyIds?.includes(story.id),
    ),
    security: {
      permissions: prd.technicalContracts.permissions,
      compliance: prd.technicalRequirements.complianceRequirements,
      considerations: prd.securityConsiderations,
      story_notes: story.securityNotes ?? [],
    },
    not_applicable: prd.notApplicable as Record<string, string>,
    design: {
      guidance: prd.designGuidance,
      story_notes: story.designNotes ?? [],
      decisions: designDecisions(prd).map(({ id, decision, rationale }) => ({
        id,
        decision,
        rationale,
      })),
    },
    dependencies: story.dependencies.map((id) => {
      const dependency = prd.userStories.find(
        (candidate) => candidate.id === id,
      );

      return {
        id,
        title: dependency?.title ?? null,
        status: dependency?.status ?? null,
        log: dependency?.log ?? [],
      };
    }),
    previous_story: lastCompleted
      ? {
          id: lastCompleted.id,
          title: lastCompleted.title,
          log: lastCompleted.log ?? [],
        }
      : null,
  };
}

export function appendStoryLog(
  prd: StructuredPRD,
  storyId: string,
  entry: StoryLogEntry,
) {
  const story = findStory(prd, storyId);

  story.log = [...(story.log ?? []), entry];

  return { story_id: story.id, entries: story.log.length };
}

function withoutBlanks(entries: string[]) {
  return entries.map((entry) => entry.trim()).filter(Boolean);
}
