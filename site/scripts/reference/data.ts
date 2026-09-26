/**
 * Typed access to the reference data that scripts/gen/reference.ts writes.
 * The Reference*.astro components read it from here and nowhere else. Run
 * `bun run sync` (every dev, build and typecheck script does) to create it.
 */
import api from '../../src/generated/reference-api.json';
import cli from '../../src/generated/reference-cli.json';
import config from '../../src/generated/reference-config.json';
import type { ApiReference, CliReference, ConfigReference, ConfigTable } from './types';

export const configReference = config as ConfigReference;
export const cliReference = cli as CliReference;
export const apiReference = api as ApiReference;

export function configTable(id: string): ConfigTable {
  const table = configReference.tables.find((t) => t.id === id);
  if (!table) throw new Error(`No config table "${id}" in the generated reference. Run \`bun run sync\`.`);
  return table;
}
