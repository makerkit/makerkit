import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { type ZodRawShape, type ZodTypeAny, z } from 'zod/v3';

/**
 * Minimal stand-in for McpServer used by tool adapter tests. Captures every
 * registerTool call so tests can assert names, annotations and that the
 * handler's structuredContent satisfies the declared outputSchema. Prompt
 * arguments are parsed with the prompt's argsSchema, as the real server does.
 */
export interface RegisteredTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: ZodTypeAny;
    outputSchema?: ZodTypeAny;
    annotations?: ToolAnnotations;
  };
  handler: (input: unknown) => Promise<Record<string, unknown>>;
}

export interface RegisteredPrompt {
  name: string;
  handler: (args: Record<string, unknown>) => {
    messages: Array<{ role: string; content: { type: string; text: string } }>;
  };
}

export function createFakeMcpServer() {
  const tools: RegisteredTool[] = [];
  const prompts: RegisteredPrompt[] = [];

  const server = {
    registerTool(
      name: string,
      config: RegisteredTool['config'],
      handler: RegisteredTool['handler'],
    ) {
      tools.push({ name, config, handler });
      return {};
    },
    registerPrompt(
      name: string,
      config: { argsSchema?: ZodRawShape },
      handler: RegisteredPrompt['handler'],
    ) {
      const args = z.object(config.argsSchema ?? {});

      prompts.push({ name, handler: (input) => handler(args.parse(input)) });
      return {};
    },
  };

  return {
    server: server as unknown as McpServer,
    tools,
    prompts,
    tool(name: string) {
      const tool = tools.find((item) => item.name === name);

      if (!tool) {
        throw new Error(`Tool "${name}" was not registered`);
      }

      return tool;
    },
    /** Call a tool and validate the result against its own outputSchema. */
    async call(name: string, input: unknown = {}) {
      const tool = this.tool(name);
      const result = await tool.handler(input);

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
