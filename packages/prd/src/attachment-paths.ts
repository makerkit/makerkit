import { assertSafeRelativePath } from './safe-file-name';
import type { StoryAttachment } from './schema';
import type { Attachment } from './types';

/**
 * The folder for a PRD's files, relative to `.prds`: the PRD file name
 * without `.json`, so `notes.json` keeps its files in `.prds/notes/`.
 */
export function attachmentsFolder(filename: string) {
  return filename.replace(/\.json$/, '');
}

/** An attachment's file relative to the project root, e.g. `.prds/notes/a.png`. */
export function attachmentProjectPath(filename: string, path: string) {
  return `.prds/${attachmentsFolder(filename)}/${path}`;
}

/** Attachments as an agent needs them: file paths from the project root. */
export function resolveAttachments(
  filename: string,
  attachments: Attachment[],
): StoryAttachment[] {
  return attachments.map(({ path, ...attachment }) => ({
    ...attachment,
    ...(path ? { path: attachmentProjectPath(filename, path) } : {}),
  }));
}

/**
 * Attachments as stored, with hand-edited entries that would break readers
 * or point outside the PRD folder dropped: each needs a string id and title
 * and either a safe relative path or an http(s) url.
 */
export function normalizeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): Attachment[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const { id, title, path, url, note } = entry as Record<string, unknown>;

    if (typeof id !== 'string' || typeof title !== 'string') {
      return [];
    }

    const base = {
      id,
      title,
      ...(typeof note === 'string' && note ? { note } : {}),
    };

    if (typeof path === 'string' && url === undefined && isSafePath(path)) {
      return [{ ...base, path }];
    }

    if (
      typeof url === 'string' &&
      path === undefined &&
      /^https?:\/\//i.test(url)
    ) {
      return [{ ...base, url }];
    }

    return [];
  });
}

function isSafePath(path: string) {
  try {
    return assertSafeRelativePath(path) === path;
  } catch {
    return false;
  }
}
