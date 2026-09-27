/**
 * The variant configs in site/gallery/variants/ and the README snippets in
 * site/gallery/readme/, as the files on disk. The page shows the config that
 * made an image and the snippet the kit printed, never a copy of either.
 */
import { galleryFile, GALLERY_URL } from './GalleryData';

const variants = import.meta.glob<string>('../../gallery/variants/*.mjs', { query: '?raw', import: 'default', eager: true });
const snippets = import.meta.glob<string>('../../gallery/readme/*.html', { query: '?raw', import: 'default', eager: true });

const REGENERATE = 'Run `bun run docs:gallery` from the repo root.';

/** A variant config's text and its path from the repo root, by file name without `.mjs`. */
export function variantConfig(name: string): { code: string; file: string } {
  const code = variants[`../../gallery/variants/${name}.mjs`];
  if (code === undefined) throw new Error(`gallery: no site/gallery/variants/${name}.mjs`);
  return { code, file: `site/gallery/variants/${name}.mjs` };
}

/** What `showcase readme` printed to site/gallery/readme/<name>.html. */
export function readmeSnippet(name: string): { code: string; file: string } {
  const code = snippets[`../../gallery/readme/${name}.html`];
  if (code === undefined) throw new Error(`gallery: no site/gallery/readme/${name}.html. ${REGENERATE}`);
  return { code, file: `site/gallery/readme/${name}.html` };
}

/** Where `--base ../..` (the repo root) puts the gallery's files in a snippet. */
const SNIPPET_GALLERY = 'site/public/gallery/';

/**
 * A snippet with its image paths served from this site, for a live preview. Every image must be a gallery file in
 * the manifest, so a snippet that points anywhere else fails the build.
 */
export function servedSnippet(code: string): string {
  return code.replace(/\bsrc="([^"]*)"/g, (_match, src: string) => {
    if (!src.startsWith(SNIPPET_GALLERY)) throw new Error(`gallery: a README snippet lists "${src}", outside ${SNIPPET_GALLERY}`);
    const path = src.slice(SNIPPET_GALLERY.length);
    galleryFile(path);
    return `src="${GALLERY_URL}${path}"`;
  });
}
