# @makerkit/kit-tools

The data tools every Makerkit kit's MCP server registers, with one input and output schema each across kits: `kit_status`, `kit_prerequisites`, `kit_db_status`, `kit_db_migrate`, `kit_db_seed`, `kit_db_reset`, `kit_dev_start`, `kit_dev_stop`, `kit_dev_status`, `kit_mailbox_status`. Agents and the Makerkit Console read the same shape in every kit.

```ts
import { KitStatusInputSchema, KitStatusOutputSchema } from '@makerkit/kit-tools';

server.registerTool('kit_status', {
  inputSchema: KitStatusInputSchema,
  outputSchema: KitStatusOutputSchema,
  annotations: { readOnlyHint: true },
}, handler);
```

## Contract test

```ts
import { checkKitToolsContract } from '@makerkit/kit-tools';

expect(checkKitToolsContract(registeredTools, { required: ['kit_status'] })).toEqual([]);
```

It fails when a kit registers a shared tool with another schema, or misses a tool it must have.

## Registering (`@makerkit/kit-tools/mcp`)

```ts
import { registerKitTool } from '@makerkit/kit-tools/mcp';

registerKitTool(server, 'kit_db_status', { description: '…' }, () => db.status());
```

The schemas come from the name, so a kit can't register a shared tool with another shape. `toolResult(value)` builds the structured result (plus the same JSON as text); `READ_ONLY_TOOL`, `MUTATING_TOOL` and `DESTRUCTIVE_TOOL` are the annotation presets.
