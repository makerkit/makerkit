export interface CustomPhase {
  id: string;
  name: string;
  description: string;
  color: string;
  order: number;
  userStoryIds: string[];
}

export type StoryStatus =
  | 'not_started'
  | 'research'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'blocked';

export type StoryPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type StoryComplexity = 'XS' | 'S' | 'M' | 'L' | 'XL';

/** Recorded when a story is marked completed and the project checks passed. */
export interface StoryVerification {
  verifiedAt: string;
  checks: string[];
  passed: true;
}

/**
 * A hand-off note an agent writes when it finishes working on a story, so the
 * next story (often a fresh session with an empty context) knows what changed.
 */
export interface StoryLogEntry {
  at: string;
  /** Plain-language list of what a human should now be able to try. */
  whatsNew: string[];
  /** Decisions, gotchas and file locations for the next agent. */
  technicalNotes: string[];
  /**
   * Where the work departed from the PRD and why, so the person approving
   * the story and the review_story prompt can judge it. Absent when there
   * were none, and on logs written before it existed.
   */
  deviations?: string[];
}

export interface UserStory {
  id: string;
  title: string;
  userStory: string;
  businessValue: string;
  acceptanceCriteria: string[];
  status: StoryStatus;
  priority: StoryPriority;
  estimatedComplexity: StoryComplexity;
  dependencies: string[];
  notes?: string;
  completedAt?: string;
  verification?: StoryVerification;
  log?: StoryLogEntry[];
  /**
   * Where this story is tested: the public entry points (a route, a server
   * action, a service function) whose behaviour the tests exercise.
   */
  testSeams?: string[];
  /** Ids of the PRD's attachments this story uses, e.g. a mockup. */
  attachmentIds?: string[];
}

/**
 * A file or link the plan refers to: a mockup, a screenshot, reference docs.
 * Files live in the PRD's own folder, `.prds/<prd name>/`, next to its JSON
 * file. Exactly one of `path` and `url` is set.
 */
export interface Attachment {
  id: string;
  title: string;
  /** Relative to the PRD's folder, e.g. `mockups/approve-view.png`. */
  path?: string;
  url?: string;
  /** What to take from it, e.g. "Layout only; colours are placeholders". */
  note?: string;
}

/** A term the team has agreed on, so people and agents use the same words. */
export interface GlossaryTerm {
  term: string;
  definition: string;
  /** Synonyms that should not be used for this concept. */
  avoid: string[];
}

export interface RiskItem {
  id: string;
  description: string;
  mitigation: string;
  owner: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CrossDependency {
  id: string;
  name: string;
  description: string;
  blocking: boolean;
  owner?: string;
}

export interface DecisionLogEntry {
  id: string;
  date: string;
  decision: string;
  rationale: string;
  owner?: string;
  status: 'proposed' | 'accepted' | 'superseded';
  /**
   * What the decision is about, e.g. `story:US001:dependencies`. Optional so
   * hand-written decision logs stay valid; deleting a story supersedes the
   * accepted decisions whose topic names it.
   */
  topic?: string;
}

export interface AgentTaskPacket {
  id: string;
  title: string;
  scope: string;
  doneCriteria: string[];
  testPlan: string[];
  likelyFiles: string[];
  linkedStoryIds: string[];
  dependencies: string[];
}

export interface StoryTraceabilityMap {
  storyId: string;
  featureId: string;
  acceptanceCriteriaIds: string[];
  successMetricIds: string[];
}

/**
 * Text fields may use Markdown. Longer text (the overview, problem, solution
 * description, story notes, decision rationale) may use any block Markdown;
 * items of a list (acceptance criteria, non-goals, story log entries...) are
 * rendered as bullets, so they keep to inline Markdown: bold, italics, code
 * and links. Raw HTML is not rendered.
 */
export interface StructuredPRD {
  introduction: {
    title: string;
    overview: string;
    lastUpdated: string;
  };

  problemStatement: {
    problem: string;
    marketOpportunity: string;
    targetUsers: string[];
  };

  solutionOverview: {
    description: string;
    keyFeatures: string[];
    successMetrics: string[];
  };

  nonGoals: string[];
  outOfScope: string[];
  assumptions: string[];
  openQuestions: string[];
  risks: RiskItem[];
  dependencies: CrossDependency[];

  userStories: UserStory[];
  customPhases: CustomPhase[];
  storyTraceability: StoryTraceabilityMap[];

  technicalRequirements: {
    constraints: string[];
    integrationNeeds: string[];
    complianceRequirements: string[];
  };

  technicalContracts: {
    apis: string[];
    dataModels: string[];
    permissions: string[];
    integrationBoundaries: string[];
  };

  acceptanceCriteria: {
    global: string[];
    qualityStandards: string[];
  };

  constraints: {
    timeline: string;
    budget?: string;
    resources: string[];
    nonNegotiables: string[];
  };

  rolloutPlan: {
    featureFlags: string[];
    migrationPlan: string[];
    rolloutPhases: string[];
    rollbackConditions: string[];
  };

  measurementPlan: {
    events: string[];
    dashboards: string[];
    baselineMetrics: string[];
    targetMetrics: string[];
    guardrailMetrics: string[];
  };

  decisionLog: DecisionLogEntry[];
  glossary: GlossaryTerm[];
  attachments: Attachment[];
  agentTaskPackets: AgentTaskPacket[];
  changeLog: string[];

  metadata: {
    version: string;
    created: string;
    lastUpdated: string;
    lastValidatedAt: string;
    approver: string;
    /**
     * High-water mark for story numbering. Story ids are quoted in commits and
     * conversations, so a deleted id must never be handed to a different
     * story: `max(existing) + 1` would recycle US002 as soon as US002 (the
     * highest) was deleted. Absent on PRDs written before this existed, which
     * fall back to the highest id present.
     */
    lastStoryNumber?: number;
    /** High-water mark for attachment ids, for the same reason. */
    lastAttachmentNumber?: number;
    /**
     * Incremented on every save. A write whose PRD was read at an older
     * revision is rejected, so two writers (an agent and the Board) cannot
     * silently overwrite each other. Absent on files written before it existed.
     */
    revision?: number;
  };

  progress: {
    overall: number;
    completed: number;
    total: number;
    blocked: number;
  };
}
