import { attachmentProjectPath } from './attachment-paths';
import { appendChangeLog, findAttachment, findStory } from './prd-operations';
import { assertSafeRelativePath } from './safe-file-name';
import type { AddAttachmentInput, RemoveAttachmentOutput } from './schema';
import type { StructuredPRD } from './types';

/**
 * Adds an attachment and links it to the given stories. The caller checks
 * that a `path` exists on disk; this only validates the PRD.
 */
export function addAttachment(
  prd: StructuredPRD,
  input: AddAttachmentInput,
  today: string,
) {
  if (Boolean(input.path) === Boolean(input.url)) {
    throw new Error('Give either path or url for an attachment, not both.');
  }

  if (input.url && !/^https?:\/\//i.test(input.url)) {
    throw new Error('An attachment url must start with http:// or https://.');
  }

  const path = input.path
    ? assertSafeRelativePath(input.path, 'attachment path')
    : undefined;

  const stories = (input.storyIds ?? []).map((id) => findStory(prd, id));
  const id = nextAttachmentId(prd);

  prd.attachments.push({
    id,
    title: input.title,
    ...(path ? { path } : { url: input.url }),
    ...(input.note ? { note: input.note } : {}),
  });

  for (const story of stories) {
    story.attachmentIds = [...new Set([...(story.attachmentIds ?? []), id])];
  }

  appendChangeLog(prd, `Added attachment ${id} (${input.title})`, today);

  return {
    attachment_id: id,
    path: path ? attachmentProjectPath(input.filename, path) : null,
    stories_updated: stories.map((story) => story.id),
    total_attachments: prd.attachments.length,
  };
}

/**
 * Issues the next attachment id and advances the high-water mark, like story
 * ids. Ids still linked from stories count too: a writer that predates
 * attachments drops the list and the counter but keeps the stories' links,
 * and those must never come to mean a different file.
 */
function nextAttachmentId(prd: StructuredPRD) {
  const numbers = [
    ...prd.attachments.map((attachment) => attachment.id),
    ...prd.userStories.flatMap((story) => story.attachmentIds ?? []),
  ].map((id) => Number(/^ATT(\d+)$/.exec(id)?.[1] ?? 0));

  const next =
    Math.max(prd.metadata.lastAttachmentNumber ?? 0, 0, ...numbers) + 1;

  prd.metadata.lastAttachmentNumber = next;

  return `ATT${String(next).padStart(3, '0')}`;
}

/**
 * Removes an attachment and every story's link to it. The file itself stays
 * on disk.
 */
export function removeAttachment(
  prd: StructuredPRD,
  attachmentId: string,
  today: string,
): RemoveAttachmentOutput {
  const attachment = findAttachment(prd, attachmentId);

  prd.attachments = prd.attachments.filter(
    (candidate) => candidate.id !== attachment.id,
  );

  const storiesUpdated: string[] = [];

  for (const story of prd.userStories) {
    if (story.attachmentIds?.includes(attachment.id)) {
      story.attachmentIds = story.attachmentIds.filter(
        (id) => id !== attachment.id,
      );
      storiesUpdated.push(story.id);
    }
  }

  appendChangeLog(
    prd,
    `Removed attachment ${attachment.id} (${attachment.title})`,
    today,
  );

  return {
    attachment_id: attachment.id,
    stories_updated: storiesUpdated,
    total_attachments: prd.attachments.length,
  };
}
