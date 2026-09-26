import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkChangelogDist, type ChangelogCheckInput } from './check';
import { feedData, renderAtomFeed } from './feed';
import { fixtureModel } from './fixtures/model';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-changelog-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const input: ChangelogCheckInput = {
  base: '/showcase-kit',
  versions: ['1.0.0', '0.9.0'],
  tags: new Set(['v1.0.0', '@scope/pkg@0.9.0']),
};

const section = (version: string, meta: string) =>
  `<div class="sl-heading-wrapper level-h2"><h2 id="v${version}">${version}</h2><a href="#v${version}">#</a></div><p>${meta}</p><h3 id="v${version}-minor">Minor changes</h3><ul><li>x</li></ul>`;
const released = (day: string) => `Released <time datetime="${day}T10:00:00Z">${day}</time>`;

/** A dist/ that passes; each test breaks one thing. */
function healthy(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const files: Record<string, string | undefined> = {
    'changelog/index.html': `<html><body><h1 id="_top">Changelog</h1>${section(
      '1.0.0',
      `${released('2026-03-02')} · <a href="https://github.com/o/r/releases/tag/v1.0.0">tag</a> · <a href="https://github.com/o/r/compare/%40scope%2Fpkg%400.9.0...v1.0.0">changes</a>`,
    )}${section('0.9.0', `${released('2026-02-01')} · <a href="https://github.com/o/r/releases/tag/%40scope%2Fpkg%400.9.0">tag</a>`)}</body></html>`,
    'changelog.xml': renderAtomFeed(feedData(fixtureModel())),
    'index.html': '<html><body><h1 id="_top">Home</h1></body></html>',
    ...overrides,
  };
  return Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => e[1] !== undefined));
}

describe('checkChangelogDist', () => {
  test('a healthy dist/ passes and counts what it checked', () => {
    const result = checkChangelogDist(dist(healthy()), input);
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ sections: 2, tagLinks: 4, feedEntries: 2 });
  });

  test('a missing page and a missing feed fail', () => {
    const failures = checkChangelogDist(dist({ 'index.html': '<p></p>' }), input).failures;
    expect(failures).toContain('no changelog page emitted at /showcase-kit/changelog/');
    expect(failures).toContain('no feed emitted at /showcase-kit/changelog.xml');
  });

  test('a released version without a section fails', () => {
    const failures = checkChangelogDist(dist(healthy()), { ...input, versions: ['1.1.0', ...input.versions] }).failures;
    expect(failures).toContain('/showcase-kit/changelog/: no section #v1.1.0 for 1.1.0');
  });

  test('a section with no date fails', () => {
    const files = healthy();
    files['changelog/index.html'] = files['changelog/index.html']!.replace(released('2026-02-01'), 'Released');
    expect(checkChangelogDist(dist(files), input).failures).toEqual(['/showcase-kit/changelog/: the 0.9.0 section has no release date']);
  });

  test('a section for a version CHANGELOG.md does not list fails', () => {
    const files = healthy();
    files['changelog/index.html'] = files['changelog/index.html']!.replace('</body>', `${section('9.9.9', released('2026-01-01'))}</body>`);
    expect(checkChangelogDist(dist(files), input).failures).toContain(
      '/showcase-kit/changelog/: a section #v9.9.9 for a version CHANGELOG.md does not list',
    );
  });

  test('a duplicate id fails', () => {
    const files = healthy();
    files['changelog/index.html'] = files['changelog/index.html']!.replace('</body>', '<h2 id="v1.0.0">again</h2></body>');
    expect(checkChangelogDist(dist(files), input).failures).toContain('/showcase-kit/changelog/: the id "v1.0.0" appears more than once');
  });

  test('a tag or compare link to a tag that does not exist fails', () => {
    const failures = checkChangelogDist(dist(healthy()), { ...input, tags: new Set(['v1.0.0']) }).failures;
    expect(failures).toHaveLength(2);
    for (const failure of failures) expect(failure).toContain('names the tag "@scope/pkg@0.9.0", which does not exist');
  });

  test('a feed that is not well-formed fails', () => {
    const failures = checkChangelogDist(dist(healthy({ 'changelog.xml': '<feed><entry></feed>' })), input).failures;
    expect(failures[0]).toMatch(/^\/showcase-kit\/changelog\.xml is not well-formed XML: /);
  });

  test('a feed with an entry missing fails', () => {
    const model = fixtureModel();
    model.releases.pop();
    const failures = checkChangelogDist(dist(healthy({ 'changelog.xml': renderAtomFeed(feedData(model)) })), input).failures;
    expect(failures).toContain('/showcase-kit/changelog.xml has 1 entries for 2 releases');
  });

  test('a feed entry linking to the wrong section fails', () => {
    const files = healthy();
    files['changelog.xml'] = files['changelog.xml']!.replace('#v0.9.0', '#v0.8.0');
    expect(checkChangelogDist(dist(files), input).failures).toEqual([
      '/showcase-kit/changelog.xml entry 2 should link to /showcase-kit/changelog/#v0.9.0, got https://noctcore.github.io/showcase-kit/changelog/#v0.8.0',
    ]);
  });

  test('a feed entry without a timestamp or content fails', () => {
    const files = healthy();
    files['changelog.xml'] = files['changelog.xml']!.replace('<updated>2026-02-01T23:59:59Z</updated>', '<updated>yesterday</updated>');
    files['changelog.xml'] = files['changelog.xml'].replace(/<content type="html">[^<]*<\/content>/, '<content type="html"></content>');
    expect(checkChangelogDist(dist(files), input).failures).toEqual([
      '/showcase-kit/changelog.xml entry 1 has no HTML content',
      '/showcase-kit/changelog.xml entry 2: <updated> yesterday is not a UTC timestamp',
    ]);
  });

  test('an empty id on any page fails, naming the page', () => {
    const failures = checkChangelogDist(dist(healthy({ 'guides/x/index.html': '<h2 not="" id="">x</h2>' })), input).failures;
    expect(failures).toEqual(['/showcase-kit/guides/x/index.html has an empty id (a Markdown heading ending in {...}?)']);
  });
});
