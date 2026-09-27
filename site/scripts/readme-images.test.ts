import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SNIPPET_DIR } from './gallery.ts';
import { missingPublicImages, PUBLIC_URL, publicImageUrls, withPublicUrls } from './readme-images.ts';
import { REPO_ROOT, SITE_DIR } from './site.ts';

const README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const PUBLIC_DIR = join(SITE_DIR, 'public');

describe('the repo README', () => {
  test('shows gallery images, and every one is a file the site serves', () => {
    expect(publicImageUrls(README).length).toBeGreaterThan(0);
    expect(missingPublicImages(README, PUBLIC_DIR)).toEqual([]);
  });

  test('has the layouts table exactly as `showcase readme` printed it, with the served URLs', () => {
    const snippet = readFileSync(join(SNIPPET_DIR, 'kit-readme.html'), 'utf8');
    expect(README).toContain(withPublicUrls(snippet).trimEnd());
  });
});

describe('publicImageUrls', () => {
  test('reads src attributes and Markdown images under the site, and nothing else', () => {
    const markdown = [
      `<img src="${PUBLIC_URL}gallery/hero.webp" alt="" />`,
      `![banner](${PUBLIC_URL}gallery/a.webp "title")`,
      `![angle](<${PUBLIC_URL}gallery/b.webp>)`,
      '<img src="https://example.com/x.png" />',
      `[a link, not an image](${PUBLIC_URL}gallery/c.webp)`,
    ].join('\n');
    expect(publicImageUrls(markdown)).toEqual([
      `${PUBLIC_URL}gallery/hero.webp`,
      `${PUBLIC_URL}gallery/a.webp`,
      `${PUBLIC_URL}gallery/b.webp`,
    ]);
  });
});

describe('missingPublicImages', () => {
  test('names the URLs with no file under the public folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'readme-images-'));
    await mkdir(join(dir, 'gallery'), { recursive: true });
    await writeFile(join(dir, 'gallery', 'there.webp'), '');
    const markdown = [
      `<img src="${PUBLIC_URL}gallery/there.webp?v=1" />`,
      `<img src="${PUBLIC_URL}gallery/gone.webp" />`,
      `<img src="${PUBLIC_URL}" />`,
    ].join('\n');
    expect(missingPublicImages(markdown, dir)).toEqual([`${PUBLIC_URL}gallery/gone.webp`, PUBLIC_URL]);
  });
});

describe('withPublicUrls', () => {
  test('turns repo-root paths under site/public/ into served URLs', () => {
    expect(withPublicUrls('<td><img src="site/public/gallery/x.webp" alt="X" /></td>')).toBe(
      `<td><img src="${PUBLIC_URL}gallery/x.webp" alt="X" /></td>`,
    );
  });

  test('refuses a path the site does not serve', () => {
    expect(() => withPublicUrls('<img src="assets/showcase/en/x.webp" />')).toThrow('not under site/public/');
  });
});
