import type { z } from 'zod/v4';

import { KIT_TOOL_SCHEMAS, type KitToolName } from './schemas';

export const READ_ONLY_TOOL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const MUTATING_TOOL = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// asks first (seed, reset): only with confirm
export const DESTRUCTIVE_TOOL = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

type Annotations =
  | typeof READ_ONLY_TOOL
  | typeof MUTATING_TOOL
  | typeof DESTRUCTIVE_TOOL;

// a tool's result: structured content plus the same JSON as text
export function toolResult<T extends object>(value: T) {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

type Input<N extends KitToolName> = z.output<
  (typeof KIT_TOOL_SCHEMAS)[N]['input']
>;
type Output<N extends KitToolName> = z.input<
  (typeof KIT_TOOL_SCHEMAS)[N]['output']
>;

// any server with McpServer's registerTool, without the SDK's types: works
// across SDK copies (a kit's SDK and this package's needn't be one install)
export type ToolServer = {
  registerTool(
    name: string,
    config: {
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
      annotations?: object;
    },
    handler: (input: never, extra: never) => unknown,
  ): unknown;
};

/**
 * Registers a shared kit tool with its @makerkit/kit-tools schemas, picked by
 * name: a kit writes the description and the handler, never the shape.
 */
export function registerKitTool<N extends KitToolName>(
  server: ToolServer,
  name: N,
  {
    description,
    annotations = READ_ONLY_TOOL,
  }: { description: string; annotations?: Annotations },
  run: (input: Input<N>) => Promise<Output<N>>,
) {
  const { input, output } = KIT_TOOL_SCHEMAS[name];

  server.registerTool(
    name,
    { description, inputSchema: input, outputSchema: output, annotations },
    async (raw: unknown) =>
      toolResult(await run(input.parse(raw ?? {}) as Input<N>)),
  );
}
