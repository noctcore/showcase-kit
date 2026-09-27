import { describe, expect, test } from 'bun:test';

import { fixtureModel } from './fixtures/model';
import { renderChangelogPage } from './page';

describe('renderChangelogPage', () => {
  const page = renderChangelogPage(fixtureModel());

  test('frontmatter sets the title, a description, the root CHANGELOG.md as edit link and a versions-only TOC', () => {
    expect(page).toStartWith(
      [
        '---',
        'title: Changelog',
        'description: Every release of @scope/pkg, generated from CHANGELOG.md.',
        'editUrl: https://github.com/o/r/edit/main/CHANGELOG.md',
        'tableOfContents:',
        '  maxHeadingLevel: 2',
        '---',
      ].join('\n'),
    );
  });

  test('the intro links the feed under the base, GitHub releases and the npm versions', () => {
    expect(page).toContain('[Atom feed](/showcase-kit/changelog.xml)');
    expect(page).toContain('[GitHub releases](https://github.com/o/r/releases)');
    expect(page).toContain('[npm version list](https://www.npmjs.com/package/@scope/pkg?activeTab=versions)');
  });

  test('every version is a heading with an explicit readable id, newest first', () => {
    const headings = page.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## 1.0.0 {#v1.0.0}', '## 0.9.0 {#v0.9.0}']);
  });

  test('the meta line is one .nc-release-meta line: the date, npm, the real tag and a compare link across tag formats', () => {
    expect(page).toContain(
      '## 1.0.0 {#v1.0.0}\n\n<p class="nc-release-meta">' +
        '<span>Released <time datetime="2026-03-02T08:00:00Z">2026-03-02</time></span>' +
        '<a href="https://www.npmjs.com/package/@scope/pkg/v/1.0.0">npm</a>' +
        '<a href="https://github.com/o/r/releases/tag/v1.0.0">tag <code>v1.0.0</code></a>' +
        '<a href="https://github.com/o/r/compare/%40scope%2Fpkg%400.9.0...v1.0.0">changes since 0.9.0</a></p>\n',
    );
    // The oldest release has nothing to compare with.
    expect(page).toContain(
      '<p class="nc-release-meta"><span>Released <time datetime="2026-02-01T23:59:59Z">2026-02-01</time></span>' +
        '<a href="https://www.npmjs.com/package/@scope/pkg/v/0.9.0">npm</a>' +
        '<a href="https://github.com/o/r/releases/tag/%40scope%2Fpkg%400.9.0">tag <code>@scope/pkg@0.9.0</code></a></p>\n',
    );
  });

  test('an untagged release says so and has no tag or compare link', () => {
    const model = fixtureModel();
    delete model.releases[0]!.date.tag;
    const untagged = renderChangelogPage(model);
    expect(untagged).toContain('<a href="https://www.npmjs.com/package/@scope/pkg/v/1.0.0">npm</a><span>not tagged yet</span></p>\n');
    expect(untagged).not.toContain('/compare/');
  });

  test('groups are subheadings with ids and a one-line legend', () => {
    expect(page).toContain('### Major changes {#v1.0.0-major}\n\nBreaking changes: read these before you upgrade.\n');
    expect(page).toContain('### Patch changes {#v1.0.0-patch}\n\nFixes and small improvements that need no change on your side.\n');
    expect(page).toContain('### Minor changes {#v0.9.0-minor}\n');
  });

  test('entries keep their links, thank everyone but the maintainer and keep follow-on lines in the item', () => {
    expect(page).toContain(
      [
        '- [#12](https://github.com/o/r/pull/12) <a class="nc-sha" href="https://github.com/o/r/commit/abc1234def">abc1234</a> Thanks [@guest](https://github.com/guest)! Drops `old()`.',
        '',
        '  Second paragraph with `a | b` and `` a`b `` and a table-like `x|y|z`.',
        '',
        '      indented code keeps its extra indent',
        '',
        '  :::caution[Warning]',
        '  Replace `old()` with `next()`.',
        '  :::',
      ].join('\n'),
    );
    expect(page).toContain(
      '- <a class="nc-sha" href="https://github.com/o/r/commit/0123abc999">0123abc</a> A maintainer fix.\n\n  :::tip[Tip]\n',
    );
    expect(page).toContain(
      '- <a class="nc-sha" href="https://github.com/o/r/commit/def5678abc">def5678</a> A fix with a link but no author.\n',
    );
    expect(page).toContain('- First release, written by hand.\n');
    expect(page).not.toContain('@maint');
  });

  test('no Unreleased section when nothing is pending', () => {
    expect(page).not.toContain('Unreleased');
  });

  test('pending changesets render first as Unreleased, with the bump they add up to', () => {
    const withPending = renderChangelogPage(fixtureModel({ pending: true }));
    const unreleased = withPending.indexOf('## Unreleased {#unreleased}');
    expect(unreleased).toBeGreaterThan(-1);
    expect(unreleased).toBeLessThan(withPending.indexOf('## 1.0.0'));
    const section = withPending.slice(unreleased, withPending.indexOf('## 1.0.0'));
    expect(section).toContain('Together these make the next release a **minor** one.');
    expect(section).toContain('### Minor changes {#unreleased-minor}');
    expect(section).toContain('- Adds `next()`.\n\n  A second paragraph.');
    expect(section).toContain('### Patch changes {#unreleased-patch}');
    expect(section).toContain('- Fixes `next()` when x < y.');
    expect(section).not.toContain('Not for this package');
  });

  test('an unknown alert type fails the page, naming the release', () => {
    const model = fixtureModel();
    model.releases[1]!.groups[0]!.entries[0]!.body += '\n\n> [!DANGER]\n> x';
    expect(() => renderChangelogPage(model)).toThrow('CHANGELOG.md 0.9.0: unknown alert type [!DANGER]');
  });
});
