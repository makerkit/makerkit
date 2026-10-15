import { attachmentsFolder } from './attachment-paths';
import type {
  Attachment,
  StoryStatus,
  StructuredPRD,
  UserStory,
} from './types';

const STATUS_LABELS: Record<StoryStatus, string> = {
  not_started: '[not started]',
  research: '[research]',
  in_progress: '[in progress]',
  review: '[review]',
  completed: '[completed]',
  blocked: '[blocked]',
};

/**
 * Pass the PRD file name to link attachment files relative to `.prds/`, where
 * the markdown export is written.
 */
export function formatPrdMarkdown(
  prd: StructuredPRD,
  filename?: string,
): string {
  const lines: string[] = [];

  lines.push(`# ${prd.introduction.title}`, '');
  lines.push('## Introduction', '', prd.introduction.overview, '');
  lines.push(`**Last Updated:** ${prd.introduction.lastUpdated}`);
  lines.push(`**Version:** ${prd.metadata.version}`, '');

  lines.push('## Problem Statement', '', prd.problemStatement.problem, '');
  lines.push(
    '### Market Opportunity',
    prd.problemStatement.marketOpportunity,
    '',
  );
  lines.push('### Target Users');
  lines.push(...bullets(prd.problemStatement.targetUsers));

  lines.push(
    '',
    '## Solution Overview',
    '',
    prd.solutionOverview.description,
    '',
  );
  lines.push('### Key Features', ...bullets(prd.solutionOverview.keyFeatures));
  lines.push('', '### Success Metrics');
  lines.push(...bullets(prd.solutionOverview.successMetrics));

  lines.push('', '## Scope Guardrails', '');
  lines.push('### Non-Goals', ...bullets(prd.nonGoals, 'None specified'));
  lines.push(
    '',
    '### Out of Scope',
    ...bullets(prd.outOfScope, 'None specified'),
  );
  lines.push(
    '',
    '### Assumptions',
    ...bullets(prd.assumptions, 'None specified'),
  );
  lines.push(
    '',
    '### Open Questions',
    ...bullets(
      prd.openQuestions.map(
        (question) =>
          `${question.id}: ${question.question}` +
          (question.storyIds?.length ? ` (blocks ${question.storyIds.join(', ')})` : '') +
          (question.recommended ? ` Recommended: ${question.recommended}` : ''),
      ),
      'None',
    ),
  );

  if (prd.edgeCases.length > 0) {
    lines.push('', '## Edge Cases');

    for (const edgeCase of prd.edgeCases) {
      const stories = edgeCase.storyIds?.length ? ` (${edgeCase.storyIds.join(', ')})` : '';
      const behaviour =
        edgeCase.status === 'decided' ? edgeCase.expectedBehavior : 'OPEN: ask, do not assume';

      lines.push(`- ${edgeCase.case}${stories} -> ${behaviour}`);
    }
  }

  const security = [
    ...prd.technicalContracts.permissions.map((item) => `Permission: ${item}`),
    ...prd.technicalRequirements.complianceRequirements.map((item) => `Data: ${item}`),
    ...prd.securityConsiderations,
  ];

  if (security.length > 0) {
    lines.push('', '## Security', ...bullets(security));
  }

  const notApplicable = Object.entries(prd.notApplicable);

  if (notApplicable.length > 0) {
    lines.push(
      '',
      '## Not Applicable',
      ...notApplicable.map(([topic, reason]) => `- ${topic}${reason ? `: ${reason}` : ''}`),
    );
  }

  if (prd.designGuidance.length > 0) {
    lines.push('', '## Design Guidance', ...bullets(prd.designGuidance));
  }

  if (prd.risks.length > 0) {
    lines.push('', '## Risks');

    for (const risk of prd.risks) {
      lines.push(
        `- [${risk.severity}] ${risk.description} | Mitigation: ${risk.mitigation} | Owner: ${risk.owner}`,
      );
    }
  }

  if (prd.dependencies.length > 0) {
    lines.push('', '## Dependencies');

    for (const dependency of prd.dependencies) {
      const mode = dependency.blocking ? 'blocking' : 'non-blocking';
      lines.push(`- ${dependency.name} (${mode}) - ${dependency.description}`);
    }
  }

  if (prd.attachments.length > 0) {
    lines.push('', '## Attachments');

    for (const attachment of prd.attachments) {
      lines.push(formatAttachment(attachment, filename));
    }
  }

  lines.push('', '## User Stories', '');

  for (const priority of ['P0', 'P1', 'P2', 'P3'] as const) {
    const stories = prd.userStories.filter((s) => s.priority === priority);

    if (stories.length === 0) continue;

    lines.push(`### Priority ${priority}`, '');

    for (const story of stories) {
      lines.push(...formatStory(story));
    }
  }

  lines.push('', '## Progress', '');
  lines.push(
    `**Overall:** ${prd.progress.overall}% (${prd.progress.completed}/${prd.progress.total} stories)`,
  );

  if (prd.progress.blocked > 0) {
    lines.push(`**Blocked:** ${prd.progress.blocked} stories need attention`);
  }

  if (prd.rolloutPlan.rolloutPhases.length > 0) {
    lines.push(
      '',
      '## Rollout Plan',
      ...bullets(prd.rolloutPlan.rolloutPhases),
    );
  }

  if (prd.measurementPlan.targetMetrics.length > 0) {
    lines.push(
      '',
      '## Measurement Plan',
      ...bullets(prd.measurementPlan.targetMetrics),
    );
  }

  lines.push(
    '',
    '---',
    '',
    `*Approver: ${prd.metadata.approver || 'TBD'}*`,
    '',
  );

  return lines.join('\n');
}

function formatStory(story: UserStory): string[] {
  const lines = [
    `#### ${story.id}: ${story.title} ${STATUS_LABELS[story.status]} [${story.estimatedComplexity}]`,
    '',
    `**User Story:** ${story.userStory}`,
    '',
    `**Business Value:** ${story.businessValue}`,
    '',
    '**Acceptance Criteria:**',
    ...bullets(story.acceptanceCriteria),
  ];

  if (story.dependencies.length > 0) {
    lines.push('', `**Dependencies:** ${story.dependencies.join(', ')}`);
  }

  if (story.attachmentIds?.length) {
    lines.push('', `**Attachments:** ${story.attachmentIds.join(', ')}`);
  }

  if (story.verification) {
    lines.push(
      '',
      `**Verified:** ${story.verification.verifiedAt} (${story.verification.checks.join(', ')})`,
    );
  }

  lines.push('');

  return lines;
}

function formatAttachment(attachment: Attachment, filename?: string) {
  const title = oneLine(attachment.title).replace(/[[\]]/g, '\\$&');
  const target = attachment.url
    ? linkTarget(attachment.url)
    : filename
      ? linkTarget(
          encodeURI(`${attachmentsFolder(filename)}/${attachment.path}`),
        )
      : undefined;
  const label = target
    ? `[${title}](${target})`
    : `${title} (${attachment.path})`;
  const note = attachment.note ? ` - ${oneLine(attachment.note)}` : '';

  return `- ${attachment.id}: ${label}${note}`;
}

/** Keeps a list item on one line, so text cannot start a new block. */
function oneLine(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

/** Parentheses and spaces would end a markdown link target early. */
function linkTarget(value: string) {
  return value
    .replace(/\s/g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function bullets(items: string[], emptyLabel?: string) {
  if (items.length === 0) {
    return emptyLabel ? [`- ${emptyLabel}`] : [];
  }

  return items.map((item) => `- ${item}`);
}
