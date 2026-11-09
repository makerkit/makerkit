import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Minimal stand-in for McpServer used by tool adapter tests. Captures every
 * registerTool call so tests can assert names, annotations and that the
 * handler's structuredContent satisfies the declared outputSchema.
 */
export interface RegisteredTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    // zod v3 or v4: both parse
    inputSchema?: { parse(value: unknown): unknown };
    outputSchema?: { parse(value: unknown): unknown };
    annotations?: ToolAnnotations;
  };
  handler: (
    input: unknown,
    extra?: unknown,
  ) => Promise<Record<string, unknown>>;
}

export function createFakeMcpServer() {
  const tools: RegisteredTool[] = [];

  const server = {
    registerTool(
      name: string,
      config: RegisteredTool['config'],
      handler: RegisteredTool['handler'],
    ) {
      tools.push({ name, config, handler });
      return {};
    },
    registerPrompt() {
      return {};
    },
  };

  return {
    server: server as unknown as McpServer,
    tools,
    tool(name: string) {
      const tool = tools.find((item) => item.name === name);

      if (!tool) {
        throw new Error(`Tool "${name}" was not registered`);
      }

      return tool;
    },
    /** Call a tool and validate the result against its own outputSchema. */
    async call(name: string, input: unknown = {}, extra?: unknown) {
      const tool = this.tool(name);
      const result = await tool.handler(input, extra);

      if (result.isError) {
        return result;
      }

      if (tool.config.outputSchema) {
        tool.config.outputSchema.parse(result.structuredContent);
      }

      return result;
    },
  };
}
