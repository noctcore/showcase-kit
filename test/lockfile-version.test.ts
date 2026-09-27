import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Dependabot's bun updater bundles bun 1.3, which reads `bun.lock` only up to `lockfileVersion` 1 and fails every
 * update run on a version 2 file. Bun 1.4 writes version 2 for a new lockfile but keeps the version it loaded, and
 * versions 1 and 2 hold the same content, so both lockfiles stay at 1 until Dependabot ships a bun that reads 2
 * (dependabot-core#16071). The one way back to 2 by accident is deleting a lockfile and regenerating it.
 */
describe('bun.lock format', () => {
  it.each(['bun.lock', 'site/bun.lock'])('%s stays at lockfileVersion 1 for Dependabot', file => {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    const version = /^ {2}"lockfileVersion": (\d+),$/m.exec(text)?.[1];
    expect(
      version,
      `${file} is lockfileVersion ${version ?? '(missing)'}, but Dependabot's bun reads only 1 and fails every ` +
        'update run on anything newer. Restore it with `git checkout -- ' +
        `${file}\`, or set "lockfileVersion" back to 1 and run \`bun install\` (bun 1.4 keeps the version it ` +
        'loaded). Move to 2 only once Dependabot runs a bun that reads it (dependabot-core#16071): then set the ' +
        'field to 2 in both lockfiles and update this test, CONTRIBUTING.md and .github/dependabot.yml.',
    ).toBe('1');
  });
});
