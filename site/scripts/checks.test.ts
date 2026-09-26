import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkBuild, idsOf, refsOf, type CheckOptions } from './checks';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fixture dist/ from a map of emitted paths to their contents. */
function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-build-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const page = (body: string) => `<!doctype html><html><body><h1 id="_top">T</h1>${body}</body></html>`;

const options: CheckOptions = {
  base: '/kit',
  routes: ['', 'guide/'],
  anchors: { 'guide/': ['setup'] },
  stubMarker: 'STUB(test)',
  allowStubs: false,
};

/** A dist/ that passes every check; each test breaks one thing. */
function healthy(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'index.html': page('<a href="/kit/guide/">Guide</a> <a href="/kit/guide/#setup">Setup</a> <a href="#_top">Top</a>'),
    'guide/index.html': page('<h2 id="setup">Setup</h2><img src="/kit/_astro/a.png"><a href="https://example.com/x">x</a>'),
    '_astro/a.png': 'png',
    ...overrides,
  };
}

describe('checkBuild', () => {
  test('a healthy dist passes and reports what it checked', () => {
    const result = checkBuild(dist(healthy()), options);
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ pages: 2, routes: 2, anchors: 1, links: 3, fragments: 2, stubPages: [] });
  });

  test('a missing dist fails', () => {
    const result = checkBuild(join(tmpdir(), 'no-such-dist-for-check-build'), options);
    expect(result.failures[0]).toContain('does not exist');
  });

  test('(a) a page-map route that was not emitted fails', () => {
    const result = checkBuild(dist(healthy()), { ...options, routes: [...options.routes, 'missing/'] });
    expect(result.failures).toEqual(['no page emitted for /kit/missing/']);
  });

  test('a missing contract anchor fails', () => {
    const files = healthy({ 'guide/index.html': page('<h2 id="install">Install</h2><img src="/kit/_astro/a.png">') });
    const result = checkBuild(dist(files), options);
    expect(result.failures).toContain('/kit/guide/: contract anchor #setup is missing');
  });

  test('(b) a link to a page that was not emitted fails', () => {
    const result = checkBuild(dist(healthy({ 'index.html': page('<a href="/kit/nope/">x</a>') })), options);
    expect(result.failures).toEqual(['/kit/: "/kit/nope/" does not resolve to an emitted file']);
  });

  test('(b) an asset that was not emitted fails', () => {
    const result = checkBuild(dist(healthy({ 'index.html': page('<script src="/kit/_astro/gone.js"></script>') })), options);
    expect(result.failures).toEqual(['/kit/: "/kit/_astro/gone.js" does not resolve to an emitted file']);
  });

  test('(b) a root-relative link without the base fails', () => {
    const result = checkBuild(dist(healthy({ 'index.html': page('<a href="/guide/">x</a>') })), options);
    expect(result.failures).toEqual(['/kit/: "/guide/" is outside the /kit/ base']);
  });

  test('(b) a relative link fails', () => {
    const result = checkBuild(dist(healthy({ 'index.html': page('<a href="../guide/">x</a>') })), options);
    expect(result.failures[0]).toContain('"../guide/" is relative');
  });

  test('(b) every srcset candidate is checked', () => {
    const files = healthy({ 'index.html': page('<img srcset="/kit/_astro/a.png 1x, /kit/_astro/b.png 2x">') });
    const result = checkBuild(dist(files), options);
    expect(result.failures).toEqual(['/kit/: "/kit/_astro/b.png" does not resolve to an emitted file']);
  });

  test('external, protocol-relative and mailto links are not checked', () => {
    const files = healthy({ 'index.html': page('<a href="https://x.dev/#a">a</a><a href="//cdn.x/y">b</a><a href="mailto:a@b.c">c</a>') });
    const result = checkBuild(dist(files), options);
    expect(result.failures).toEqual([]);
    expect(result.links).toBe(1);
  });

  test('(c) a cross-page fragment with no matching id fails', () => {
    const result = checkBuild(dist(healthy({ 'index.html': page('<a href="/kit/guide/#nope">x</a>') })), options);
    expect(result.failures).toEqual(['/kit/: "/kit/guide/#nope" points at no id on /kit/guide/']);
  });

  test('(c) a same-page fragment with no matching id fails', () => {
    const result = checkBuild(dist(healthy({ 'index.html': page('<a href="#nope">x</a>') })), options);
    expect(result.failures).toEqual(['/kit/: "#nope" points at no id on the same page']);
  });

  test('(c) percent-encoded fragments and entity-encoded ids match', () => {
    const files = healthy({
      'index.html': page('<a href="/kit/guide/#caf%C3%A9">x</a>'),
      'guide/index.html': page('<h2 id="setup">S</h2><h2 id="café">C</h2><img src="/kit/_astro/a.png">'),
    });
    expect(checkBuild(dist(files), options).failures).toEqual([]);
  });

  test('(c) a fragment on a link to a non-page file fails', () => {
    const result = checkBuild(dist(healthy({ 'index.html': page('<a href="/kit/_astro/a.png#x">x</a>') })), options);
    expect(result.failures).toEqual(['/kit/: "/kit/_astro/a.png#x" has a fragment but does not point at a page']);
  });

  test('(d) a stub page fails and is named', () => {
    const result = checkBuild(dist(healthy({ 'guide/index.html': page('<h2 id="setup">S</h2>STUB(test)<img src="/kit/_astro/a.png">') })), options);
    expect(result.stubPages).toEqual(['/kit/guide/']);
    expect(result.failures).toEqual(['/kit/guide/ still contains STUB(test)']);
  });

  test('(d) allowStubs lets stub pages through but still counts them', () => {
    const files = healthy({ 'guide/index.html': page('<h2 id="setup">S</h2>STUB(test)<img src="/kit/_astro/a.png">') });
    const result = checkBuild(dist(files), { ...options, allowStubs: true });
    expect(result.failures).toEqual([]);
    expect(result.stubPages).toEqual(['/kit/guide/']);
  });
});

describe('parsing', () => {
  test('refsOf reads href, src and srcset, decoding entities', () => {
    expect(refsOf('<a href="/a/?x=1&amp;y=2"></a><img src="/b.png" srcset="/c.png 1x,/d.png 2x">')).toEqual([
      '/a/?x=1&y=2',
      '/b.png',
      '/c.png',
      '/d.png',
    ]);
  });

  test('idsOf reads every id and ignores data-id', () => {
    expect([...idsOf('<h2 id="a"></h2><div data-id="b"></div><span id="c&amp;d"></span>')]).toEqual(['a', 'c&d']);
  });
});
