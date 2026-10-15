import { defineConfig } from 'tsdown';

import { libraryConfig } from '../../../../tsdown.base.mts';

export default defineConfig(
  libraryConfig({ index: 'src/index.ts', client: 'src/client.ts' }),
);
