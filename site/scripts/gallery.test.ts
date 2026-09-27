import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { configSection } from '../src/components/GallerySection.ts';
import {
  BUDGET_BYTES,
  budgetLines,
  buildManifest,
  GALLERY_JSON,
  MANIFEST,
  missingBuild,
  OUTPUT_DIR,
  overBudget,
  README_CONFIG,
  README_LAYOUTS,
  SNIPPET_STEPS,
  STEPS,
  TTY_CONFIG,
  VARIANT_STEPS,
  VARIANTS,
  VARIANTS_DIR,
  variantConfig,
  WEB_CONFIG,
  type Manifest,
} from './gallery.ts';
import { SITE_BASE, SITE_DIR } from './site.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'gallery-test-'));
const solid = (width: number, height: number, r = 20) =>
  sharp({ create: { width, height, channels: 4, background: { r, g: 30, b: 60, alpha: 1 } } });

describe('missingBuild', () => {
  test('names the missing CLI and how to build it', () => {
    const message = missingBuild(join(tmp(), 'dist', 'cli.js'));
    expect(message).toContain('cli.js not found');
    expect(message).toContain('bun run build');
  });

  test('is quiet when the CLI exists', async () => {
    const cli = join(tmp(), 'cli.js');
    await writeFile(cli, '');
    expect(missingBuild(cli)).toBeUndefined();
  });
});

describe('budget', () => {
  test('passes at the limit and fails one byte over, naming both sizes', () => {
    expect(overBudget(BUDGET_BYTES)).toBeUndefined();
    const message = overBudget(BUDGET_BYTES + 1);
    expect(message).toContain('over the 4096.0 KB budget');
  });

  test('counts every output and every extra file', () => {
    const manifest: Manifest = { 'a.webp': { bytes: 10, sha256: 'x' }, 'b/c.png': { bytes: 5, sha256: 'y' } };
    const { lines, total } = budgetLines(manifest, { 'gallery/showcase.gallery.json': 7 });
    expect(total).toBe(22);
    expect(lines.map(([path]) => path)).toEqual([
      'public/gallery/a.webp',
      'public/gallery/b/c.png',
      'gallery/showcase.gallery.json',
    ]);
  });
});

describe('buildManifest', () => {
  test('hashes every file, keys it by a / path, and reads image and animation sizes', async () => {
    const dir = tmp();
    await mkdir(join(dir, 'nested', 'deeper'), { recursive: true });
    await solid(40, 20).png().toFile(join(dir, 'still.png'));
    const frames = [await solid(30, 10).png().toBuffer(), await solid(30, 10, 200).png().toBuffer()];
    const strip = await sharp(frames, { join: { animated: true } }).webp({ lossless: true }).toBuffer();
    await writeFile(join(dir, 'nested', 'deeper', 'clip.webp'), strip);
    await writeFile(join(dir, 'nested', 'favicon.ico'), 'not an image sharp reads');

    const manifest = await buildManifest(dir);
    expect(Object.keys(manifest)).toEqual(['nested/deeper/clip.webp', 'nested/favicon.ico', 'still.png']);
    expect(manifest['still.png']).toMatchObject({ width: 40, height: 20 });
    expect(manifest['still.png']?.frames).toBeUndefined();
    expect(manifest['nested/deeper/clip.webp']).toMatchObject({ width: 30, height: 10, frames: 2 });
    const ico = manifest['nested/favicon.ico'];
    expect(ico?.width).toBeUndefined();
    expect(ico?.sha256).toBe(createHash('sha256').update('not an image sharp reads').digest('hex'));
    expect(ico?.bytes).toBe(24);
  });
});

describe('the steps', () => {
  test('run all, hero, record and icons, with the web and the tty config', () => {
    expect(STEPS.map(step => step[0])).toEqual(['all', 'hero', 'all', 'record', 'icons']);
    expect(STEPS[0]).toContain(WEB_CONFIG);
    expect(STEPS[3]).toContain(TTY_CONFIG);
  });
});

describe('the variants', () => {
  test('every config in variants/ runs, and every step has its config', () => {
    const files = readdirSync(VARIANTS_DIR).filter(name => name.endsWith('.mjs'));
    expect(files.map(name => name.slice(0, -'.mjs'.length)).sort()).toEqual([...VARIANTS].sort());
    for (const name of VARIANTS) expect(existsSync(variantConfig(name))).toBe(true);
  });

  test('a hero- config runs hero, a web one frames only tonight, a tty one frames its only shot', () => {
    VARIANTS.forEach((name, index) => {
      const step = VARIANT_STEPS[index];
      if (name.startsWith('hero-')) expect(step).toEqual(['hero', '--config', variantConfig(name)]);
      else if (name.startsWith('tty-')) expect(step).toEqual(['frame', '--config', variantConfig(name)]);
      else expect(step).toEqual(['frame', '--config', variantConfig(name), '--only', 'tonight']);
    });
  });

  test('each one writes a file of its own under layouts/, named after the config', async () => {
    const outputs = new Set<string>();
    for (const name of VARIANTS) {
      const config = ((await import(pathToFileURL(variantConfig(name)).href)) as { default: Record<string, any> }).default;
      const option = name.slice(name.indexOf('-') + 1);
      if (name.startsWith('hero-')) {
        expect(config.hero.output).toBe(`../public/gallery/layouts/${name}.webp`);
        outputs.add(config.hero.output);
      } else {
        // The web variants frame `tonight`; a tty variant frames its config's only shot.
        const shots: { id: string }[] = config.shots;
        const id = name.startsWith('tty-') ? shots[0]?.id : 'tonight';
        if (name.startsWith('tty-')) expect(shots.length).toBe(1);
        expect(config.outputs.readme).toBe(`../public/gallery/layouts/{id}-${option}.webp`);
        outputs.add(config.outputs.readme.replace('{id}', String(id)));
      }
    }
    expect(outputs.size).toBe(VARIANTS.length);
  });
});

describe('the README snippets', () => {
  test('one run per layout with the web config, then the kit README table, each to its own file', () => {
    const layoutOf = (args: readonly string[]) => (args.includes('--layout') ? args[args.indexOf('--layout') + 1] : undefined);
    expect(SNIPPET_STEPS.map(step => layoutOf(step.args))).toEqual([...README_LAYOUTS, undefined]);
    expect(SNIPPET_STEPS.slice(0, -1).every(step => step.args.includes(WEB_CONFIG))).toBe(true);
    expect(SNIPPET_STEPS.at(-1)?.args).toContain(README_CONFIG);
    for (const { args, out } of SNIPPET_STEPS) {
      expect(args[0]).toBe('readme');
      expect(args.slice(-2)).toEqual(['--base', '../..']);
      expect(existsSync(out)).toBe(true);
    }
    expect(new Set(SNIPPET_STEPS.map(step => step.out)).size).toBe(SNIPPET_STEPS.length);
  });

  test('every image a snippet lists is a gallery file in the manifest', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
    for (const { out } of SNIPPET_STEPS) {
      const srcs = [...readFileSync(out, 'utf8').matchAll(/src="([^"]*)"/g)].map(match => match[1] ?? '');
      expect(srcs.length).toBeGreaterThan(0);
      for (const src of srcs) {
        expect(src.startsWith('site/public/gallery/')).toBe(true);
        expect(manifest[src.slice('site/public/gallery/'.length)]).toBeDefined();
      }
    }
  });
});

describe('the committed gallery', () => {
  test('matches its manifest byte for byte', async () => {
    const onDisk = await buildManifest(OUTPUT_DIR);
    const committed = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
    expect(onDisk).toEqual(committed);
  });

  test('fits the budget', async () => {
    const manifest = await buildManifest(OUTPUT_DIR);
    const snippets = Object.fromEntries(
      SNIPPET_STEPS.map(({ out }) => [relative(SITE_DIR, out).split(sep).join('/'), readFileSync(out).length]),
    );
    const { total } = budgetLines(manifest, {
      json: readFileSync(GALLERY_JSON).length,
      manifest: readFileSync(MANIFEST).length,
      ...snippets,
    });
    expect(overBudget(total)).toBeUndefined();
  });

  test('lists portfolio images the site serves', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
    const items = JSON.parse(readFileSync(GALLERY_JSON, 'utf8')) as { src: string; alt: string }[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.src.startsWith(`${SITE_BASE}/gallery/`)).toBe(true);
      expect(manifest[item.src.slice(`${SITE_BASE}/gallery/`.length)]).toBeDefined();
      expect(existsSync(join(OUTPUT_DIR, item.src.slice(`${SITE_BASE}/gallery/`.length)))).toBe(true);
    }
  });
});

describe('configSection', () => {
  const web = readFileSync(WEB_CONFIG, 'utf8');

  test('cuts a nested block out of the real config, dedented, up to its own closing brace', () => {
    const portfolio = configSection(web, 'portfolio');
    const lines = portfolio.split('\n');
    expect(lines[0]).toBe('portfolio: {');
    expect(lines.at(-1)).toBe('},');
    expect(portfolio).toContain("thumbnail: 'tonight',");
    expect(portfolio).not.toContain('hero');
    expect(web).toContain(lines.map(line => `    ${line}`).join('\n'));
  });

  test('cuts a top-level block', () => {
    const hero = configSection(web, 'hero');
    expect(hero.startsWith('hero: {\n')).toBe(true);
    expect(hero).toContain('tagline:');
    expect(hero.endsWith('},')).toBe(true);
  });

  test('ends a block at its own closing brace, not at a nested one', () => {
    const lines = configSection(web, 'outputs').split('\n');
    expect(lines[0]).toBe('outputs: {');
    expect(lines).toContain('  portfolio: {');
    expect(lines.slice(-2)).toEqual(['  },', '},']);
  });

  test('fails for a block the config does not have', () => {
    expect(() => configSection(web, 'clips')).toThrow('no "clips:" block');
  });
});
