import { defineConfig } from 'tsdown';

import { libraryConfig } from '../../tsdown.base.mts';

export default defineConfig(
  libraryConfig({
    index: 'src/index.ts',
    operations: 'src/prd-operations.ts',
    node: 'src/node.ts',
    mcp: 'src/mcp/index.ts',
  }),
);
