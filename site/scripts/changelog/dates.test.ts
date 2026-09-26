import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { gitIn, listTags, releaseDates, tagCandidates, type Git } from './dates';

const PACKAGE = '@scope/pkg';
const dirs: string[] = [];
let repo: string;

/** Run git in `cwd` with fixed author and committer dates, so tag dates are known. */
function git(cwd: string, args: string[], date = '2026-01-01T12:00:00+00:00'): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(tmpdir(), 'no-such-gitconfig'),
    },
  });
}

function commitChangelog(cwd: string, text: string, date: string): void {
  writeFileSync(join(cwd, 'CHANGELOG.md'), text);
  git(cwd, ['add', 'CHANGELOG.md'], date);
  git(cwd, ['commit', '-q', '-m', `changelog at ${date}`], date);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'changelog-dates-'));
  dirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  // 0.1.0: annotated tag in the scoped format, created later than its commit.
  commitChangelog(repo, '# p\n\n## 0.1.0\n', '2026-01-10T10:00:00+00:00');
  git(repo, ['tag', '-a', `${PACKAGE}@0.1.0`, '-m', 'release'], '2026-01-11T09:30:00+00:00');
  // 0.1.1: lightweight v tag; its commit is late on the 20th in UTC+2, the 20th in UTC too.
  commitChangelog(repo, '# p\n\n## 0.1.1\n\n## 0.1.0\n', '2026-01-20T23:30:00+02:00');
  git(repo, ['tag', 'v0.1.1']);
  // 0.2.0: never tagged; its heading lands at 01:30 on the 3rd in UTC+2, the 2nd in UTC,
  // then later commits remove it and add it back (the oldest commit must win).
  commitChangelog(repo, '# p\n\n## 0.2.0\n\n## 0.1.1\n\n## 0.1.0\n', '2026-02-03T01:30:00+02:00');
  commitChangelog(repo, '# p\n\n## 0.1.1\n\n## 0.1.0\n', '2026-02-05T12:00:00+00:00');
  commitChangelog(repo, '# p\n\n## 0.2.0\n\nedited\n\n## 0.1.1\n\n## 0.1.0\n', '2026-02-09T12:00:00+00:00');
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const dates = (versions: string[], runner: Git = gitIn(repo)) =>
  releaseDates(versions, { git: runner, packageName: PACKAGE, changelogPath: 'CHANGELOG.md' });

test('tagCandidates tries the v tag first, then the scoped one', () => {
  expect(tagCandidates('1.2.3', PACKAGE)).toEqual(['v1.2.3', '@scope/pkg@1.2.3']);
});

test('listTags reads every tag with its creation date', () => {
  const tags = listTags(gitIn(repo));
  expect([...tags.keys()].sort()).toEqual(['@scope/pkg@0.1.0', 'v0.1.1']);
});

describe('releaseDates', () => {
  test('an annotated tag is dated by its tagger date, not its commit', () => {
    expect(dates(['0.1.0']).get('0.1.0')).toEqual({
      timestamp: '2026-01-11T09:30:00Z',
      day: '2026-01-11',
      tag: '@scope/pkg@0.1.0',
    });
  });

  test('a lightweight tag is dated by its commit, converted to UTC', () => {
    expect(dates(['0.1.1']).get('0.1.1')).toEqual({ timestamp: '2026-01-20T21:30:00Z', day: '2026-01-20', tag: 'v0.1.1' });
  });

  test('without a tag, the commit that first added the heading dates it, in UTC', () => {
    expect(dates(['0.2.0']).get('0.2.0')).toEqual({ timestamp: '2026-02-02T23:30:00Z', day: '2026-02-02' });
  });

  test('a version with no tag and no heading commit throws, naming it and the fix', () => {
    expect(() => dates(['0.3.0', '0.2.0'])).toThrow(
      'No release date for 0.3.0: no tag (v0.3.0 or @scope/pkg@0.3.0) and no commit that adds the "## <version>" heading to CHANGELOG.md.',
    );
    expect(() => dates(['0.3.0'])).toThrow(/git fetch --unshallow --tags/);
  });

  test('regex characters in a version are literal', () => {
    // "0x2x0" would match "0.2.0" if the dots were not escaped.
    expect(() => dates(['0x2x0'])).toThrow(/No release date for 0x2x0/);
  });

  test('a real shallow clone throws, naming the versions and how to fix it', () => {
    const shallow = mkdtempSync(join(tmpdir(), 'changelog-shallow-'));
    dirs.push(shallow);
    git(shallow, ['clone', '-q', '--depth', '1', pathToFileURL(repo).href, 'clone']);
    expect(() => dates(['0.2.0', '0.1.0'], gitIn(join(shallow, 'clone')))).toThrow(
      /^Cannot date 0\.2\.0, 0\.1\.0: this is a shallow clone.*fetch-depth: 0/s,
    );
  });

  test('no versions need no git at all', () => {
    expect(dates([], () => {
      throw new Error('git ran');
    }).size).toBe(0);
  });
});
