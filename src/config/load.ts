import { existsSync } from 'node:fs';
import { basename, dirname, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ShowcaseError } from '../errors.js';
import { resolveConfig } from './resolve.js';
import type { ResolvedConfig, ShowcaseConfig } from './types.js';

export const CONFIG_NAMES = [
  'showcase.config.ts',
  'showcase.config.mts',
  'showcase.config.mjs',
  'showcase.config.js',
] as const;

/** Find a config file in `from` or the nearest parent directory that has one. */
export function findConfigFile(from: string = process.cwd()): string | undefined {
  let dir = resolve(from);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) return undefined;
    dir = parent;
  }
}

/** Load, validate and resolve a config file. Without `file`, search from `cwd` upward. */
export async function loadConfig(file?: string, cwd: string = process.cwd()): Promise<ResolvedConfig> {
  const path = file ? resolve(cwd, file) : findConfigFile(cwd);
  if (!path) {
    throw new ShowcaseError(
      `No showcase config found in ${cwd} or its parents (looked for ${CONFIG_NAMES.join(', ')}). ` +
        'Run `showcase init` to create one, or pass --config <file>.',
    );
  }
  if (!existsSync(path)) {
    throw new ShowcaseError(`Config file not found: ${path}`);
  }

  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION' && /\.m?ts$/.test(path)) {
      throw new ShowcaseError(
        `This Node (${process.version}) cannot import ${basename(path)}: TypeScript configs need Node 22.18 or newer ` +
          '(native type stripping). Rename it to showcase.config.mjs, or upgrade Node.',
      );
    }
    throw new ShowcaseError(`Failed to load ${path}: ${(error as Error).stack ?? String(error)}`);
  }
  if (mod.default === undefined) {
    throw new ShowcaseError(`${basename(path)} has no default export. Use \`export default defineConfig({ ... })\`.`);
  }
  return resolveConfig(mod.default as ShowcaseConfig, dirname(path), basename(path));
}
