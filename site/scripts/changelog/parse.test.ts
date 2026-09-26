import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../site';
import { parseChangelog, parseEntryLine } from './parse';

const fixture = readFileSync(join(import.meta.dir, 'fixtures', 'CHANGELOG.md'), 'utf8');

describe('parseChangelog on the fixture', () => {
  const parsed = parseChangelog(fixture);

  test('reads the title, the versions newest first and their groups', () => {
    expect(parsed.title).toBe('@scope/pkg');
    expect(parsed.releases.map((r) => r.version)).toEqual(['1.0.0', '0.9.0']);
    expect(parsed.releases[0]!.groups.map((g) => [g.type, g.entries.length])).toEqual([
      ['major', 1],
      ['patch', 2],
    ]);
    expect(parsed.releases[1]!.groups.map((g) => g.type)).toEqual(['minor']);
  });

  test('reads the pull request, commit and every author of an entry', () => {
    const entry = parsed.releases[0]!.groups[0]!.entries[0]!;
    expect(entry.pr).toEqual({ label: '#12', url: 'https://github.com/o/r/pull/12' });
    expect(entry.commit).toEqual({ label: 'abc1234', url: 'https://github.com/o/r/commit/abc1234def' });
    expect(entry.authors).toEqual([
      { label: 'maint', url: 'https://github.com/maint' },
      { label: 'guest', url: 'https://github.com/guest' },
    ]);
  });

  test('keeps a multi-paragraph body, dedented, with inline code holding pipes and backticks verbatim', () => {
    const body = parsed.releases[0]!.groups[0]!.entries[0]!.body;
    expect(body.split('\n')).toEqual([
      'Drops `old()`.',
      '',
      'Second paragraph with `a | b` and `` a`b `` and a table-like `x|y|z`.',
      '',
      '    indented code keeps its extra indent',
      '',
      '> [!WARNING]',
      '> Replace `old()` with `next()`.',
    ]);
  });

  test('an unindented alert after an entry belongs to that entry, an indented one too', () => {
    const [linkOnly, maintainer] = parsed.releases[0]!.groups[1]!.entries;
    expect(linkOnly!.body).toBe('A fix with a link but no author.');
    expect(linkOnly!.authors).toEqual([]);
    expect(maintainer!.body).toBe('A maintainer fix.\n\n> [!tip]\n> Indented alerts work too.');
  });

  test('a hand-written entry has no links and no author', () => {
    const entry = parsed.releases[1]!.groups[0]!.entries[0]!;
    expect(entry).toEqual({ authors: [], body: 'First release, written by hand.' });
  });

  test('CRLF line endings parse the same', () => {
    expect(parseChangelog(fixture.replace(/\n/g, '\r\n'))).toEqual(parsed);
  });
});

describe('parseEntryLine', () => {
  test('a summary that itself contains " - " is kept whole', () => {
    const entry = parseEntryLine('[`abc1234`](https://x/c) Thanks [@a](https://x/a)! - Use `a - b` - not c');
    expect(entry.summary).toBe('Use `a - b` - not c');
  });

  test('a plain line is all summary', () => {
    expect(parseEntryLine('Thanks to nobody - really')).toEqual({ authors: [], summary: 'Thanks to nobody - really' });
  });
});

describe('parseChangelog refuses what it does not understand', () => {
  const cases: [string, string, RegExp][] = [
    ['an unknown group', '# p\n\n## 1.0.0\n\n### Breaking\n\n- x\n', /:5: an unknown group/],
    ['an entry outside a group', '# p\n\n## 1.0.0\n\n- x\n', /:5: an entry outside/],
    ['text at column 0 after an entry', '# p\n\n## 1.0.0\n\n### Patch Changes\n\n- x\nstray\n', /:8: an unexpected line/],
    ['a plain quote after an entry', '# p\n\n## 1.0.0\n\n### Patch Changes\n\n- x\n\n> not an alert\n', /:9: an unexpected line/],
    ['a version twice', '# p\n\n## 1.0.0\n\n### Patch Changes\n\n- x\n\n## 1.0.0\n', /:9: version 1.0.0 appears twice/],
    ['a heading that is not a version', '# p\n\n## Next\n', /:3: a "##" heading that is not a version/],
    ['a version without groups', '# p\n\n## 1.0.0\n', /1\.0\.0 has no Major\/Minor\/Patch Changes group/],
    ['no title', '## 1.0.0\n\n### Patch Changes\n\n- x\n', /no "#" heading/],
  ];
  for (const [name, text, error] of cases) {
    test(name, () => expect(() => parseChangelog(text)).toThrow(error));
  }
});

test('smoke: the real CHANGELOG.md parses into every release', () => {
  const parsed = parseChangelog(readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'));
  expect(parsed.title).toBe('@noctcore/showcase-kit');
  const versions = parsed.releases.map((r) => r.version);
  expect(versions.slice(-3)).toEqual(['0.2.0', '0.1.1', '0.1.0']);
  for (const release of parsed.releases) {
    for (const group of release.groups) {
      for (const entry of group.entries) expect(entry.body.trim()).not.toBe('');
    }
  }
  const first = parsed.releases.at(-1)!.groups[0]!.entries[0]!;
  expect(first.commit).toBeUndefined();
  expect(first.body).toStartWith('First release');
});
