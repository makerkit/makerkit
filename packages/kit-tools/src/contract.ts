import { z } from 'zod/v4';

import { KIT_TOOL_SCHEMAS, type KitToolName } from './schemas';

// what a kit registered: from its McpServer, or a fake one in tests
export type RegisteredKitTool = {
  name: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

const shapeOf = (schema: unknown) =>
  JSON.stringify(z.toJSONSchema(schema as z.ZodType, { io: 'input' }));

/**
 * The contract every kit's MCP server keeps: each shared data tool it
 * registers uses the shared input and output schemas (equal JSON Schema).
 * Returns the problems, empty when it holds. `required` lists the tools this
 * kit must have.
 */
export function checkKitToolsContract(
  tools: RegisteredKitTool[],
  { required = [] }: { required?: KitToolName[] } = {},
) {
  const problems: string[] = [];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const name of required) {
    if (!byName.has(name)) {
      problems.push(`${name} is not registered`);
    }
  }

  for (const [name, shared] of Object.entries(KIT_TOOL_SCHEMAS)) {
    const tool = byName.get(name);

    if (!tool) {
      continue;
    }

    for (const side of ['input', 'output'] as const) {
      const registered =
        side === 'input' ? tool.inputSchema : tool.outputSchema;

      if (!registered) {
        problems.push(`${name} has no ${side} schema`);
      } else if (!isZod4(registered)) {
        problems.push(
          `${name}'s ${side} schema is not a zod v4 schema: use @makerkit/kit-tools`,
        );
      } else if (shapeOf(registered) !== shapeOf(shared[side])) {
        problems.push(
          `${name}'s ${side} schema differs from @makerkit/kit-tools`,
        );
      }
    }
  }

  return problems;
}

function isZod4(schema: unknown) {
  return typeof schema === 'object' && schema !== null && '_zod' in schema;
}
