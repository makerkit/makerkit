import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

type TextContent = {
  type: 'text';
  text: string;
};

/**
 * Standard annotation presets. Every registered tool must declare one so MCP
 * clients can gate permissions correctly (e.g. auto-approve read-only tools,
 * always confirm destructive ones).
 */
export const READ_ONLY_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Writes files or state but can be re-applied safely and is reversible. */
export const MUTATING_TOOL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Same as MUTATING_TOOL but repeating the call has no further effect. */
export const IDEMPOTENT_MUTATING_TOOL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Deletes or irreversibly replaces data. Clients should always confirm. */
export const DESTRUCTIVE_TOOL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** Read-only but reaches the network (e.g. registry lookups). */
export const READ_ONLY_OPEN_WORLD_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function buildStructuredResponse<T extends Record<string, unknown>>(
  result: T,
) {
  return {
    structuredContent: result,
    content: buildTextContent(JSON.stringify(result)),
  };
}

export function buildErrorResponse(tool: string, error: unknown) {
  const message = `${tool} failed: ${toErrorMessage(error)}`;

  return {
    isError: true as const,
    structuredContent: {
      error: {
        message,
      },
    },
    content: buildTextContent(message),
  };
}

export function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export function buildTextContent(text: string): TextContent[] {
  return [{ type: 'text', text }];
}
