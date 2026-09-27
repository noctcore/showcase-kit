/**
 * The repo's README.md shows gallery images by absolute URL, so they render on
 * npm as well as on GitHub. These checks keep every such URL pointing at a file
 * the site serves, and keep the README's layouts table the kit's own output.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_BASE, SITE_ORIGIN } from './site.ts';

/** Where site/public/ is served: `https://noctcore.github.io/showcase-kit/`. */
export const PUBLIC_URL = `${SITE_ORIGIN}${SITE_BASE}/`;

/** Where `showcase readme --base ../..` puts the gallery images, relative to the repo root. */
const SNIPPET_PREFIX = 'site/public/';

/** Every `src="..."` and Markdown image URL in `markdown` that is served from PUBLIC_URL, in order. */
export function publicImageUrls(markdown: string): string[] {
  const urls = [
    ...markdown.matchAll(/\bsrc="([^"]*)"/g),
    ...markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)/g),
  ].map(match => match[1] ?? '');
  return urls.filter(url => url.startsWith(PUBLIC_URL));
}

/** The URLs among `publicImageUrls(markdown)` with no file under `publicDir`. */
export function missingPublicImages(markdown: string, publicDir: string): string[] {
  return publicImageUrls(markdown).filter(url => {
    const path = decodeURI(url.slice(PUBLIC_URL.length).replace(/[?#].*$/, ''));
    return path === '' || !existsSync(join(publicDir, ...path.split('/')));
  });
}

/**
 * A snippet `showcase readme --base ../..` printed for a README at the repo root, with its image paths turned into
 * the URLs the site serves them from. A path outside site/public/ is an error: the site would not serve it.
 */
export function withPublicUrls(snippet: string): string {
  return snippet.replace(/\bsrc="([^"]*)"/g, (_match, src: string) => {
    if (!src.startsWith(SNIPPET_PREFIX)) throw new Error(`readme: "${src}" is not under ${SNIPPET_PREFIX}, so the site does not serve it`);
    return `src="${PUBLIC_URL}${src.slice(SNIPPET_PREFIX.length)}"`;
  });
}
