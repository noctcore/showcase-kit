import { describe, expect, test } from 'bun:test';

import { feedData, releaseHtml, renderAtomFeed } from './feed';
import { fixtureModel } from './fixtures/model';
import { xmlProblems } from './xml';

describe('feedData', () => {
  const data = feedData(fixtureModel({ pending: true }));

  test('has one entry per released version, newest first, and no pending changesets', () => {
    expect(data.entries.map((e) => e.title)).toEqual(['@scope/pkg 1.0.0', '@scope/pkg 0.9.0']);
    expect(data.updated).toBe('2026-03-02T08:00:00Z');
  });

  test('each entry has a stable tag URI, its release timestamp and a link to its section', () => {
    expect(data.entries[0]).toMatchObject({
      id: 'tag:noctcore.github.io,2026-09-24:showcase-kit/changelog/1.0.0',
      updated: '2026-03-02T08:00:00Z',
      url: 'https://noctcore.github.io/showcase-kit/changelog/#v1.0.0',
    });
    expect(data.selfUrl).toBe('https://noctcore.github.io/showcase-kit/changelog.xml');
  });
});

describe('releaseHtml', () => {
  const html = releaseHtml(fixtureModel().releases[0]!, 'maint');

  test('renders groups and entries, with links and inline code', () => {
    expect(html).toContain('<h3>Major changes</h3>');
    expect(html).toContain('<a href="https://github.com/o/r/commit/abc1234def"><code>abc1234</code></a>');
    expect(html).toContain('<code>a | b</code>');
    expect(html).toContain('<code>a`b</code>');
    expect(html).toContain('Thanks <a href="https://github.com/guest">@guest</a>!');
    expect(html).not.toContain('@maint');
  });

  test('an alert becomes a blockquote that opens with its label', () => {
    expect(html).toMatch(/<blockquote>\s*<p><strong>Warning<\/strong><\/p>\s*<p>Replace <code>old\(\)<\/code>/);
    expect(html).not.toContain('[!');
  });
});

describe('renderAtomFeed', () => {
  test('is well-formed Atom 1.0 with the feed and entry elements', () => {
    const xml = renderAtomFeed(feedData(fixtureModel()));
    expect(xmlProblems(xml)).toEqual([]);
    expect(xml).toStartWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">');
    for (const element of ['id', 'title', 'subtitle', 'updated', 'author']) expect(xml).toContain(`<${element}>`);
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://noctcore.github.io/showcase-kit/changelog.xml"/>');
    expect(xml.match(/<entry>/g)).toHaveLength(2);
    expect(xml).toContain('<link rel="alternate" type="text/html" href="https://noctcore.github.io/showcase-kit/changelog/#v0.9.0"/>');
  });

  test('escapes the HTML content and every text field', () => {
    const data = feedData(fixtureModel());
    data.title = 'a < b & "c"';
    data.entries[0]!.html = '<p>x &lt; y & z</p>';
    const xml = renderAtomFeed(data);
    expect(xmlProblems(xml)).toEqual([]);
    expect(xml).toContain('<title>a &lt; b &amp; &quot;c&quot;</title>');
    expect(xml).toContain('<content type="html">&lt;p&gt;x &amp;lt; y &amp; z&lt;/p&gt;</content>');
  });

  test('a < in an entry reaches the feed escaped, twice over for HTML-in-XML', () => {
    const model = fixtureModel();
    model.releases[0]!.groups[0]!.entries[0]!.body = 'Fails when x < y, see `a<b>`.';
    const xml = renderAtomFeed(feedData(model));
    expect(xmlProblems(xml)).toEqual([]);
    expect(xml).toContain('Fails when x &amp;lt; y, see &lt;code&gt;a&amp;lt;b&amp;gt;&lt;/code&gt;.');
  });
});
