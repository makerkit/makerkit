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
  };

  progress: {
    overall: number;
    completed: number;
    total: number;
    blocked: number;
  };
}
