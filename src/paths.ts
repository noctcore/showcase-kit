import { resolve } from 'node:path';
import type {
  ResolvedConfig,
  ResolvedShot,
  ResolvedTtyConfig,
  ResolvedTtyShot,
  ResolvedWebConfig,
  ResolvedWebShot,
} from './config/types.js';
import { ShowcaseError } from './errors.js';
import { fillTemplate } from './template.js';

/** Absolute path of an output file for one shot in one language. */
export function outputPath(config: ResolvedConfig, template: string, lang: string, id: string): string {
  return resolve(config.root, fillTemplate(template, { lang, id, slug: config.slug }));
}

export interface Selection<S extends ResolvedShot = ResolvedShot> {
  shots: S[];
  langs: string[];
}

/** Apply `--only` and `--langs`, refusing names the config does not know so typos do not silently do nothing. */
export function select(config: ResolvedWebConfig, only?: string[], langs?: string[]): Selection<ResolvedWebShot>;
export function select(config: ResolvedTtyConfig, only?: string[], langs?: string[]): Selection<ResolvedTtyShot>;
export function select(config: ResolvedConfig, only?: string[], langs?: string[]): Selection;
export function select(config: ResolvedConfig, only?: string[], langs?: string[]): Selection {
  const shots: ResolvedShot[] = config.shots;
  const unknownShots = (only ?? []).filter(id => !shots.some(shot => shot.id === id));
  if (unknownShots.length > 0) {
    throw new ShowcaseError(
      `Unknown shot id(s): ${unknownShots.join(', ')}. Known: ${shots.map(shot => shot.id).join(', ')}`,
    );
  }
  const unknownLangs = (langs ?? []).filter(lang => !config.langs.includes(lang));
  if (unknownLangs.length > 0) {
    throw new ShowcaseError(`Unknown lang(s): ${unknownLangs.join(', ')}. Known: ${config.langs.join(', ')}`);
  }
  return {
    shots: only?.length ? shots.filter(shot => only.includes(shot.id)) : shots,
    langs: langs?.length ? config.langs.filter(lang => langs.includes(lang)) : config.langs,
  };
}

/**
 * Where a `goto` nav goes in url mode. A nav that starts with `/` resolves like a relative link from the app's base
 * directory: the target url's path, with or without a trailing slash, except that a last segment with a dot
 * (`index.html`, `app.php`) names a file and is dropped. A trailing slash always means a directory, so
 * `https://x.io/v1.2/` is one. So `/docs/` against `https://x.io/app/` is `https://x.io/app/docs/`, not the origin's
 * `/docs/`, and `/about` against `http://localhost:5173/index.html` is `http://localhost:5173/about`.
 *
 * Everything else resolves against the target url as a browser would (`#x`, `?tab=2`, `docs/`, `../x`,
 * `https://...`), except a protocol-relative `//host/x`: it takes the base directory rule too, so it stays on the
 * target origin (`https://x.io/app//host/x`) instead of visiting another host.
 */
export function navUrl(nav: string, base: string): string {
  // A url with a scheme is absolute.
  if (URL.canParse(nav)) return new URL(nav).href;
  // What the url parser reads: it drops leading spaces and control characters and every tab and newline, and in
  // http(s) urls a backslash is a slash. So ` //x`, `/<tab>/x` and `\x` start with a slash too.
  const path = nav.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, '');
  if (!/^[/\\]/.test(path)) return new URL(nav, base).href;
  const url = new URL(base);
  const { pathname } = url;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dir = pathname.endsWith('/') ? pathname : last.includes('.') ? pathname.slice(0, -last.length) : `${pathname}/`;
  return new URL(`.${path}`, `${url.origin}${dir}`).href;
}

