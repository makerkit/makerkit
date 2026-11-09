import { renderText, scrub } from './render';
import { EXIT_CODES, type HandoffResult } from './schema';

export * from './index';

/**
 * Prints the result for its reader and sets the exit code from its status.
 * With `json`, stdout holds exactly one JSON document (prompts and progress
 * belong on stderr). Every value in `secrets` is masked first.
 */
export function finish({
  result,
  json,
  secrets = [],
  stdout = process.stdout,
}: {
  result: HandoffResult;
  json: boolean;
  secrets?: readonly string[];
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
}) {
  const safe = scrub(result, secrets);

  stdout.write(json ? `${JSON.stringify(safe, null, 2)}\n` : renderText(safe));
  process.exitCode = EXIT_CODES[safe.status];
}
