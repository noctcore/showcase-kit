import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONTRACT_ANCHORS, DOCS_DIR, PAGE_ROUTES, SITE_BASE, SITE_DIR } from './site';

/** The source file for a route, as Starlight maps `src/content/docs/` to routes. */
function sourceOf(route: string): string | null {
  const stem = route === '' ? 'index' : route.replace(/\/$/, '');
  return ['.mdx', '.md'].map((ext) => join(DOCS_DIR, stem + ext)).find((file) => existsSync(file)) ?? null;
}

describe('page map', () => {
  const config = readFileSync(join(SITE_DIR, 'astro.config.mjs'), 'utf8');

  test('the sidebar links exactly the page-map routes, in order', () => {
    const links = [...config.matchAll(/link: '\/([^']*)'/g)].map((m) => m[1]);
    expect(links).toEqual(PAGE_ROUTES.filter((route) => route !== ''));
  });

  test('astro.config.mjs serves from the same base', () => {
    expect(config).toContain(`base: '${SITE_BASE}'`);
  });

  test('every authored route has a source page', () => {
    // changelog/ is written by scripts/gen/changelog.ts during sync.
    for (const route of PAGE_ROUTES.filter((r) => r !== 'changelog/')) {
      expect({ route, source: sourceOf(route) }).toEqual({ route, source: expect.any(String) });
    }
  });

  test('every contract anchor is on a page-map route', () => {
    for (const route of Object.keys(CONTRACT_ANCHORS)) expect(PAGE_ROUTES).toContain(route);
  });
});
