/**
 * Starting points for new PRDs. A template fills sections the author would
 * otherwise start empty, and gives `shape_prd` extra questions that matter for
 * that kind of work. Everything it adds can be edited or removed afterwards.
 */
export interface PrdTemplate {
  id: TemplateId;
  name: string;
  description: string;
  /** Sentence an agent can use to pick the right template. */
  whenToUse: string;
  defaults: {
    nonGoals?: string[];
    outOfScope?: string[];
    openQuestions?: string[];
    globalAcceptanceCriteria?: string[];
    qualityStandards?: string[];
    technicalConstraints?: string[];
    rolloutPhases?: string[];
    rollbackConditions?: string[];
  };
  /** Extra questions for the shaping interview. */
  interviewFocus: string[];
}

export const TEMPLATE_IDS = [
  'saas-feature',
  'internal-tool',
  'integration',
  'mvp',
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const PRD_TEMPLATES: readonly PrdTemplate[] = [
  {
    id: 'saas-feature',
    name: 'SaaS feature',
    description:
      'A new feature in a multi-tenant SaaS: data scoped to accounts or teams, roles and permissions, and possibly plan limits.',
    whenToUse:
      'Customers of an existing SaaS will use it, and its data belongs to an account or team.',
    defaults: {
      openQuestions: [
        'Does the data belong to a personal account, a team account, or both?',
        'Which roles can view, create, edit and delete it?',
        'Is it limited by billing plan, and what happens when a limit is reached?',
      ],
      globalAcceptanceCriteria: [
        'Members of one account cannot read or change another account’s data, including through the database API directly.',
        'Every action respects the role permissions agreed in this PRD.',
        'Empty, loading and error states are handled on every new screen.',
      ],
      qualityStandards: [
        'Access rules are enforced in the database (e.g. row-level security), not only in the UI.',
        'New database changes ship as migrations with tests for the access rules.',
      ],
      technicalConstraints: [
        'Follow the existing project conventions for data access, server actions and UI components.',
      ],
      rolloutPhases: [
        'Release behind a feature flag to internal accounts',
        'Enable for all accounts',
      ],
      rollbackConditions: [
        'Errors or data-access problems reported after release: turn the flag off',
      ],
    },
    interviewFocus: [
      'Who owns the data: a personal account, a team, or both?',
      'Which roles can do what, and is anything limited by plan?',
      'What does a new account see before any data exists?',
    ],
  },
  {
    id: 'internal-tool',
    name: 'Internal tool',
    description:
      'A tool for yourself or your own team, where speed matters more than configurability.',
    whenToUse:
      'Only you or your team will use it; it will not be sold to other organisations.',
    defaults: {
      nonGoals: [
        'Settings screens for things that can be hard-coded for our own use',
        'Support for other organisations or tenants',
      ],
      openQuestions: [
        'Who exactly will use it, and how often?',
        'What is hard-coded (stages, categories, fields) rather than configurable?',
      ],
      globalAcceptanceCriteria: [
        'Works on the devices the team actually uses (desktop and phone if needed).',
        'Only signed-in team members can access it.',
      ],
      qualityStandards: [
        'Prefer the simplest working version; no configuration UI unless asked for.',
      ],
    },
    interviewFocus: [
      'What can be hard-coded because only we use it?',
      'Which existing tool or spreadsheet does this replace, and what annoys us about it?',
    ],
  },
  {
    id: 'integration',
    name: 'Third-party integration',
    description:
      'Connecting to an external service: an API, webhooks, OAuth, or a data sync.',
    whenToUse: 'The work depends on an external service you do not control.',
    defaults: {
      openQuestions: [
        'Which direction does data flow: we call them, they call us (webhooks), or both?',
        'How do users connect their account (API key, OAuth), and where are credentials stored?',
        'What happens when the service is down, slow or rate-limits us?',
      ],
      globalAcceptanceCriteria: [
        'Credentials and tokens are stored encrypted or in secrets, never in client code or logs.',
        'Incoming webhooks are verified (signature) and safe to receive twice.',
        'Failures are retried or surfaced to the user; nothing fails silently.',
      ],
      qualityStandards: [
        'The external service is called through one module, so it can be faked in tests.',
      ],
      technicalConstraints: [
        'Respect the service’s rate limits and terms of use.',
      ],
      rollbackConditions: [
        'The integration can be disconnected without losing the user’s own data',
      ],
    },
    interviewFocus: [
      'What exactly do we read from and write to the service?',
      'What does the user see while the service is unavailable?',
      'How is the integration disconnected, and what happens to synced data?',
    ],
  },
  {
    id: 'mvp',
    name: 'First version (MVP)',
    description:
      'The first version of a new product, cut down to what proves the idea.',
    whenToUse:
      'The product does not exist yet and the goal is to learn whether it works.',
    defaults: {
      openQuestions: [
        'What is the one thing a first user must be able to do?',
        'How will we know it works (a number or a behaviour we can observe)?',
        'What is the deadline or budget for this first version?',
      ],
      outOfScope: ['Features that are not needed to prove the main idea'],
      globalAcceptanceCriteria: [
        'A new user can sign up and reach the main action without help.',
      ],
      qualityStandards: ['Cut scope before cutting quality on the main flow.'],
    },
    interviewFocus: [
      'What is the smallest version that proves the idea?',
      'Which features can wait until after the first users try it?',
    ],
  },
];

export function getTemplate(id: TemplateId): PrdTemplate {
  const template = PRD_TEMPLATES.find((candidate) => candidate.id === id);

  if (!template) {
    throw new Error(
      `Unknown template "${id}". Templates: ${TEMPLATE_IDS.join(', ')}.`,
    );
  }

  return template;
}
