/**
 * Owner: L6 (generated reference).
 *
 * Generates the data behind the three reference pages from the library:
 *
 * - src/generated/reference-config.json: every config key, from the type
 *   declarations, with its modes, messages and path rules from the built
 *   validator (scripts/reference/config.ts);
 * - src/generated/reference-cli.json: every command and option, from the built
 *   CLI's `--help` and src/cli.ts (scripts/reference/cli.ts);
 * - src/generated/reference-api.json: every export of src/index.ts
 *   (scripts/reference/api.ts).
 *
 * The pages under src/content/docs/reference/ keep their headings and prose in
 * MDX and render these files with the Reference*.astro components. When the
 * types, the validator, the help text and the CLI code disagree, this refuses
 * to write anything and lists why, so the build fails instead of drifting.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SITE_DIR } from '../site';
import { buildApiReference } from '../reference/api';
import { buildCliReference } from '../reference/cli';
import { buildConfigReference } from '../reference/config';

export const GENERATED_DIR = join(SITE_DIR, 'src', 'generated');
export const REFERENCE_FILES = {
  config: join(GENERATED_DIR, 'reference-config.json'),
  cli: join(GENERATED_DIR, 'reference-cli.json'),
  api: join(GENERATED_DIR, 'reference-api.json'),
} as const;

export async function generateReference(): Promise<void> {
  const config = await buildConfigReference();
  const cli = buildCliReference();
  const api = buildApiReference();
  const problems = [...config.problems, ...cli.problems, ...api.problems];
  if (problems.length > 0) {
    throw new Error(
      `reference: the library source disagrees with itself, so the reference was not written:\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
  }

  mkdirSync(GENERATED_DIR, { recursive: true });
  const write = (file: string, data: unknown): void => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  write(REFERENCE_FILES.config, config.reference);
  write(REFERENCE_FILES.cli, cli.reference);
  write(REFERENCE_FILES.api, api.reference);

  const keys = config.reference.tables.reduce((sum, table) => sum + table.rows.length + table.forms.length, 0);
  console.log(
    `reference: ${String(config.reference.tables.length)} config tables (${String(keys)} keys and forms), ` +
      `${String(cli.reference.commands.length)} commands, ${String(cli.reference.options.length)} options, ` +
      `${String(api.reference.exports.length)} exports`,
  );
}
