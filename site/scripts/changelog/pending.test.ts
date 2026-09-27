import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { nextBump, parseChangeset, readPendingChangesets } from './pending';

const dir = join(import.meta.dir, 'fixtures', 'pending');

test('reads the pending changesets for the package, skipping README.md, empty and other-package ones', () => {
  expect(readPendingChangesets(dir, '@scope/pkg')).toEqual([
    { id: 'brave-lions-dance', type: 'minor', body: 'Adds `next()`.\n\nA second paragraph.' },
    { id: 'calm-owls-sing', type: 'patch', body: 'Fixes `next()` when x < y.' },
  ]);
});

test('a missing .changeset directory means nothing is pending', () => {
  expect(readPendingChangesets(join(dir, 'nope'), '@scope/pkg')).toEqual([]);
});

test('nextBump is the largest pending bump, undefined when nothing is pending', () => {
  const pending = readPendingChangesets(dir, '@scope/pkg');
  expect(nextBump(pending)).toBe('minor');
  expect(nextBump(pending.filter((c) => c.type === 'patch'))).toBe('patch');
  expect(nextBump([])).toBeUndefined();
});

test('an unknown bump type or missing frontmatter is reported', () => {
  expect(() => parseChangeset('x', '---\n"@scope/pkg": huge\n---\n\nx', '@scope/pkg')).toThrow(/unknown bump type "huge"/);
  expect(() => parseChangeset('x', 'no frontmatter', '@scope/pkg')).toThrow(/no frontmatter/);
});
