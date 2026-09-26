/**
 * The checks behind scripts/check-build.ts, kept free of process state so the
 * tests can run them against a fixture dist/.
 *
 * A green `astro build` proves little here: a wrong `base` builds fine and
 * 404s every asset, a dropped page builds fine, and a link to a heading that
 * was renamed builds fine. This reads what was actually emitted.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface CheckOptions {
  /** Deploy base without a trailing slash, for example `/showcase-kit`. */
  base: string;
  /** Routes relative to the base that must each emit an index.html. */
  routes: readonly string[];
  /** Ids that must exist on a route, keyed by route. */
  anchors: Readonly<Record<string, readonly string[]>>;
  /** Text that marks a page nobody has written yet. */
  stubMarker: string;
  /** Let stub pages through (lane builds only, never CI). */
  allowStubs: boolean;
}

export interface CheckResult {
  failures: string[];
  pages: number;
  routes: number;
  anchors: number;
  links: number;
  fragments: number;
  stubPages: string[];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** Every `id` in a page. */
export function idsOf(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => decodeEntities(m[1]!)));
}

/** Every URL a page points at through `href`, `src` or `srcset`. */
export function refsOf(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(/\s(href|src|srcset)="([^"]*)"/g)) {
    const value = decodeEntities(match[2]!);
    if (match[1] === 'srcset') {
      for (const candidate of value.split(',')) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) refs.push(url);
      }
    } else {
      refs.push(value);
    }
  }
  return refs;
}

export function checkBuild(dist: string, options: CheckOptions): CheckResult {
  const { base } = options;
  const result: CheckResult = { failures: [], pages: 0, routes: 0, anchors: 0, links: 0, fragments: 0, stubPages: [] };
  const fail = (message: string) => result.failures.push(message);

  if (!existsSync(dist)) {
    fail(`${dist} does not exist: run astro build first`);
    return result;
  }

  /** A page's site path (`/showcase-kit/guides/clips/`) from its file. */
  const routeOf = (file: string) => {
    const rel = relative(dist, file).split(sep).join('/');
    return `${base}/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
  };

  /** Map a site path to the emitted file, or null. */
  const emitted = (pathname: string): string | null => {
    if (!pathname.startsWith(`${base}/`)) return null;
    let rel: string;
    try {
      rel = decodeURIComponent(pathname.slice(base.length + 1));
    } catch {
      return null;
    }
    const candidates =
      rel === '' || rel.endsWith('/') ? [join(dist, rel, 'index.html')] : [join(dist, rel), join(dist, rel, 'index.html')];
    return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
  };

  const pages = walk(dist).filter((f) => f.endsWith('.html'));
  result.pages = pages.length;
  const html = new Map(pages.map((page) => [page, readFileSync(page, 'utf8')]));
  const idCache = new Map<string, Set<string>>();
  const idsFor = (page: string) => {
    let ids = idCache.get(page);
    if (!ids) {
      ids = idsOf(html.get(page) ?? readFileSync(page, 'utf8'));
      idCache.set(page, ids);
    }
    return ids;
  };

  // (a) Every page in the page map was emitted.
  for (const route of options.routes) {
    result.routes++;
    if (!existsSync(join(dist, route, 'index.html'))) fail(`no page emitted for ${base}/${route}`);
  }

  // Anchors other pages are allowed to link to: the page must keep them.
  for (const [route, ids] of Object.entries(options.anchors)) {
    const page = join(dist, route, 'index.html');
    if (!existsSync(page)) continue;
    for (const id of ids) {
      result.anchors++;
      if (!idsFor(page).has(id)) fail(`${base}/${route}: contract anchor #${id} is missing`);
    }
  }

  for (const [page, text] of html) {
    const from = routeOf(page);

    // (d) No page nobody has written yet.
    if (text.includes(options.stubMarker)) result.stubPages.push(from);

    // (b) and (c) Links resolve, fragments included.
    for (const ref of refsOf(text)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(ref) || ref.startsWith('//')) continue;
      const hash = ref.indexOf('#');
      const fragment = hash === -1 ? '' : decodeFragment(ref.slice(hash + 1));
      const path = (hash === -1 ? ref : ref.slice(0, hash)).replace(/\?.*$/, '');

      if (path === '') {
        if (fragment === '') continue;
        result.fragments++;
        if (!idsFor(page).has(fragment)) fail(`${from}: "${ref}" points at no id on the same page`);
        continue;
      }

      result.links++;
      if (!path.startsWith('/')) {
        fail(`${from}: "${ref}" is relative; write internal links root-relative, starting with ${base}/`);
        continue;
      }
      if (!path.startsWith(`${base}/`)) {
        fail(`${from}: "${ref}" is outside the ${base}/ base`);
        continue;
      }
      const target = emitted(path);
      if (!target) {
        fail(`${from}: "${ref}" does not resolve to an emitted file`);
        continue;
      }
      if (fragment !== '') {
        result.fragments++;
        if (!target.endsWith('.html')) fail(`${from}: "${ref}" has a fragment but does not point at a page`);
        else if (!idsFor(target).has(fragment)) fail(`${from}: "${ref}" points at no id on ${routeOf(target)}`);
      }
    }
  }

  result.stubPages.sort();
  if (!options.allowStubs) {
    for (const route of result.stubPages) fail(`${route} still contains ${options.stubMarker}`);
  }

  result.failures = [...new Set(result.failures)];
  return result;
}
