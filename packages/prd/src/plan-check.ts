import { isNotApplicable } from './applicability';
import { blockingQuestions } from './open-questions';
import type { NotApplicableTopic, StructuredPRD } from './types';

/**
 * What a plan is still missing, as items a UI can render as a checklist and an
 * agent can act on. `required` items mean the plan is not ready to build;
 * `recommended` items make it better but do not block.
 */
export interface PlanCheckItem {
  /** Stable key, e.g. `stories` or `vague-stories`. */
  id: string;
  /** The PRD section to change, matching `update_prd_section` where possible. */
  section: string;
  message: string;
  severity: 'required' | 'recommended';
  /** Stories the item is about, when it is about specific stories. */
  storyIds?: string[];
}

/** The not-applicable topic each "missing" check is about. */
const CHECK_TOPICS: Record<string, NotApplicableTopic> = {
  'edge-cases': 'edgeCases',
  'design-guidance': 'design',
  security: 'security',
  permissions: 'security',
  'global-acceptance-criteria': 'qualityBar',
  'target-metrics': 'measurement',
  rollout: 'rollout',
  'data-models': 'dataModel',
};

/** Above this many stories, grouping them into phases is recommended. */
const PHASE_THRESHOLD = 5;

export function checkPlan(prd: StructuredPRD) {
  const items: PlanCheckItem[] = [];
  const stories = prd.userStories;

  if (stories.length === 0) {
    items.push({
      id: 'stories',
      section: 'userStories',
      message: 'Add user stories to define specific functionality',
      severity: 'required',
    });
  }

  const withoutCriteria = stories.filter(
    (story) => story.acceptanceCriteria.length === 0,
  );

  if (withoutCriteria.length > 0) {
    items.push({
      id: 'stories-without-criteria',
      section: 'userStories',
      message: `${withoutCriteria.length} stories have no acceptance criteria`,
      severity: 'required',
      storyIds: withoutCriteria.map((story) => story.id),
    });
  }

  // What can go wrong is where agents guess most; a plan must say.
  if (stories.length > 0 && prd.edgeCases.length === 0) {
    items.push({
      id: 'edge-cases',
      section: 'edgeCases',
      message:
        'List what can go wrong (bad input, partial success, retries, permissions, limits, time zones) and what should happen',
      severity: 'required',
    });
  }

  const openEdgeCases = prd.edgeCases.filter(
    (edgeCase) => edgeCase.status === 'open',
  );

  if (openEdgeCases.length > 0) {
    items.push({
      id: 'open-edge-cases',
      section: 'edgeCases',
      message: `${openEdgeCases.length} edge cases are still open; decide what should happen`,
      severity: 'required',
      storyIds: [
        ...new Set(
          openEdgeCases.flatMap((edgeCase) => edgeCase.storyIds ?? []),
        ),
      ],
    });
  }

  if (stories.length > 0 && prd.designGuidance.length === 0) {
    items.push({
      id: 'design-guidance',
      section: 'designGuidance',
      message:
        'Add design guidance: the components, layout and tone stories should follow, and how empty and error states look',
      severity: 'recommended',
    });
  }

  // Who can do what must be stated once there is data or an outside service
  // to protect; agents otherwise default to "any signed-in user".
  if (
    stories.length > 0 &&
    prd.technicalContracts.permissions.length === 0 &&
    (prd.technicalContracts.dataModels.length > 0 ||
      prd.technicalRequirements.integrationNeeds.length > 0)
  ) {
    items.push({
      id: 'permissions',
      section: 'technicalContracts',
      message:
        'Say who can see and change what (roles, ownership, other tenants) in technicalContracts.permissions',
      severity: 'required',
    });
  }

  if (stories.length > 0 && prd.securityConsiderations.length === 0) {
    items.push({
      id: 'security',
      section: 'securityConsiderations',
      message:
        "Add security considerations: think like an attacker (inputs, access to other users' data, secrets, abuse, rate limits) and state the rules that prevent it",
      severity: 'recommended',
    });
  }

  if (prd.nonGoals.length === 0 && prd.outOfScope.length === 0) {
    items.push({
      id: 'scope',
      section: 'nonGoals',
      message:
        'Define both non-goals and out-of-scope items to reduce implementation drift',
      severity: 'required',
    });
  } else if (prd.nonGoals.length === 0 || prd.outOfScope.length === 0) {
    items.push({
      id: 'scope',
      section: prd.nonGoals.length === 0 ? 'nonGoals' : 'outOfScope',
      message:
        'Define both non-goals and out-of-scope items to reduce implementation drift',
      severity: 'recommended',
    });
  }

  if (prd.solutionOverview.successMetrics.length === 0) {
    items.push({
      id: 'success-metrics',
      section: 'solutionOverview',
      message: 'Define success metrics to measure progress',
      severity: 'recommended',
    });
  }

  if (prd.acceptanceCriteria.global.length === 0) {
    items.push({
      id: 'global-acceptance-criteria',
      section: 'acceptanceCriteria',
      message: 'Add global acceptance criteria for quality standards',
      severity: 'recommended',
    });
  }

  // A question that blocks a story must be answered before that story is
  // built; the others improve the plan but can wait.
  const blocking = blockingQuestions(prd);
  const others = prd.openQuestions.filter(
    (question) => !blocking.includes(question),
  );

  if (blocking.length > 0) {
    items.push({
      id: 'blocking-questions',
      section: 'openQuestions',
      message: `${blocking.length} open questions block stories; answer them before those stories are built`,
      severity: 'required',
      storyIds: [
        ...new Set(blocking.flatMap((question) => question.storyIds ?? [])),
      ],
    });
  }

  if (others.length > 0) {
    items.push({
      id: 'open-questions',
      section: 'openQuestions',
      message: `${others.length} open questions remain unresolved`,
      severity: 'recommended',
    });
  }

  if (prd.measurementPlan.targetMetrics.length === 0) {
    items.push({
      id: 'target-metrics',
      section: 'measurementPlan',
      message:
        'Define target metrics in measurementPlan to validate delivery impact',
      severity: 'recommended',
    });
  }

  if (prd.rolloutPlan.rolloutPhases.length === 0) {
    items.push({
      id: 'rollout',
      section: 'rolloutPlan',
      message: 'Add rollout phases and rollback conditions',
      severity: 'recommended',
    });
  }

  if (stories.length > 0 && prd.technicalContracts.dataModels.length === 0) {
    items.push({
      id: 'data-models',
      section: 'technicalContracts',
      message:
        'Describe the main entities and how they relate in technicalContracts.dataModels',
      severity: 'recommended',
    });
  }

  // Stories with no criteria are already reported as required.
  const vague = stories.filter(
    (story) =>
      story.acceptanceCriteria.length > 0 &&
      story.acceptanceCriteria.length < 2,
  );

  if (vague.length > 0) {
    items.push({
      id: 'vague-stories',
      section: 'userStories',
      message: `${vague.length} stories need more detailed acceptance criteria`,
      severity: 'recommended',
      storyIds: vague.map((story) => story.id),
    });
  }

  const withoutSeams = stories.filter(
    (story) => story.status !== 'completed' && !story.testSeams?.length,
  );

  if (withoutSeams.length > 0) {
    items.push({
      id: 'test-seams',
      section: 'userStories',
      message: `${withoutSeams.length} stories do not say where they are tested (testSeams)`,
      severity: 'recommended',
      storyIds: withoutSeams.map((story) => story.id),
    });
  }

  const phased = new Set(
    prd.customPhases.flatMap((phase) => phase.userStoryIds),
  );
  const unphased = stories.filter((story) => !phased.has(story.id));

  if (stories.length > PHASE_THRESHOLD && unphased.length > 0) {
    items.push({
      id: 'phases',
      section: 'customPhases',
      message: `${unphased.length} stories are not in a phase; group them into phases in build order`,
      severity: 'recommended',
      storyIds: unphased.map((story) => story.id),
    });
  }

  const blocked = stories.filter((story) => story.status === 'blocked');

  if (blocked.length > 0) {
    items.push({
      id: 'blocked-stories',
      section: 'userStories',
      message: `${blocked.length} stories are blocked and need attention`,
      severity: 'recommended',
      storyIds: blocked.map((story) => story.id),
    });
  }

  // Parts marked not applicable are not asked for. Open edge cases still
  // count: they were written down, so they need an answer.
  const applicable = items.filter((item) => {
    const topic = CHECK_TOPICS[item.id];

    return !topic || !isNotApplicable(prd, topic);
  });

  return {
    ready_to_build: !applicable.some((item) => item.severity === 'required'),
    items: applicable,
  };
}
