import { handoffJsonSchema } from '../src/schema.ts';

// Writes handoff.schema.json from the zod schema; a test fails when they differ.
import { writeFileSync } from 'node:fs';

writeFileSync(
  new URL('../handoff.schema.json', import.meta.url),
  `${JSON.stringify(handoffJsonSchema(), null, 2)}\n`,
);
