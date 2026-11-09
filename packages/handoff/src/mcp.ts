import { scrub } from './render';
import type { HandoffResult } from './schema';

export * from './index';

/**
 * The result as an MCP tool response: structured content for clients that
 * read it (the Console, agents), the same JSON as text for those that don't.
 * Every value in `secrets` is masked first. A failed run is an MCP error so
 * clients surface it.
 */
export function toToolResult({
  result,
  secrets = [],
}: {
  result: HandoffResult;
  secrets?: readonly string[];
}) {
  const safe = scrub(result, secrets);

  return {
    structuredContent: safe as Record<string, unknown>,
    content: [{ type: 'text' as const, text: JSON.stringify(safe) }],
    ...(safe.status === 'failed' && { isError: true }),
  };
}
