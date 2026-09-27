/**
 * Facts about the site that more than one script needs: where things live on
 * disk, where the site is served from, and which pages it must have.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(SITE_DIR, '..');
export const DOCS_DIR = join(SITE_DIR, 'src', 'content', 'docs');
export const DIST_DIR = join(SITE_DIR, 'dist');

export const SITE_ORIGIN = 'https://noctcore.github.io';
/** The Pages base path, as in astro.config.mjs, without a trailing slash. */
export const SITE_BASE = '/showcase-kit';

/**
 * Every page in the sidebar plus the splash page, as routes relative to the
 * base. Adding, renaming or dropping a page means changing this list, the
 * sidebar in astro.config.mjs and the page itself together.
 */
export const PAGE_ROUTES: readonly string[] = [
  '',
  'getting-started/',
  'gallery/',
  'guides/web-apps/',
  'guides/electron/',
  'guides/tauri/',
  'guides/terminal-apps/',
  'guides/terminal-determinism/',
  'guides/clips/',
  'guides/frames/',
  'guides/readme-table/',
  'guides/portfolio/',
  'guides/hero/',
  'guides/icons/',
  'reference/config/',
  'reference/cli/',
  'reference/api/',
  'changelog/',
];

/** Text a page carries until its wave-2 owner writes it. */
export const STUB_MARKER = 'STUB(wave-2)';

/**
 * Headings other pages may link to by fragment. The page's owner must keep
 * them; check-build fails when one goes missing. Any other cross-page link
 * points at a page, without a fragment.
 */
export const CONTRACT_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  'gallery/': ['hero-banner', 'hero-layouts', 'frame-styles-and-backgrounds', 'readme-layouts'],
  'reference/config/': ['top-level', 'target', 'shots', 'frame', 'outputs', 'hero', 'terminal', 'clips'],
  'reference/cli/': ['options', 'capture', 'frame', 'portfolio', 'readme', 'record', 'all', 'hero', 'icons', 'init'],
};
