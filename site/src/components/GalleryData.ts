/**
 * Build-time lookups for the gallery page. Every image's size comes from the
 * manifest scripts/gallery.ts writes, so the page never guesses a width or
 * height, and a file the script did not produce fails the build.
 */
import type { Manifest, ManifestEntry } from '../../scripts/gallery.ts';
import manifestJson from '../../gallery/gallery.manifest.json';

const manifest: Manifest = manifestJson;

/** Where site/public/gallery/ is served, with the base: `/showcase-kit/gallery/`. */
export const GALLERY_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/gallery/`;

export interface GalleryFile extends ManifestEntry {
  /** Path under site/public/gallery/, with `/` separators. */
  path: string;
  /** Served URL, with the base. */
  src: string;
}

const REGENERATE = 'Run `bun run docs:gallery` from the repo root.';

export function galleryFile(path: string): GalleryFile {
  const entry = manifest[path];
  if (!entry) throw new Error(`gallery: "${path}" is not in site/gallery/gallery.manifest.json. ${REGENERATE}`);
  return { ...entry, path, src: GALLERY_URL + path };
}

/** Every file whose path starts with `prefix`, in manifest (path) order. */
export function galleryFiles(prefix: string): GalleryFile[] {
  const files = Object.keys(manifest)
    .filter(path => path.startsWith(prefix))
    .map(galleryFile);
  if (files.length === 0) throw new Error(`gallery: no files under "${prefix}" in the manifest. ${REGENERATE}`);
  return files;
}

/** The manifest path of a served gallery URL, such as a `src` in showcase.gallery.json. */
export function pathOfSrc(src: string): string {
  if (!src.startsWith(GALLERY_URL)) throw new Error(`gallery: "${src}" is not served from ${GALLERY_URL}`);
  return src.slice(GALLERY_URL.length);
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
