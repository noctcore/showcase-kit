import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture } from '../src/capture.js';
import { resolveConfig } from '../src/config/resolve.js';
import type { ResolvedConfig, ShowcaseConfig } from '../src/config/types.js';
import { frame } from '../src/frame/index.js';
import { exportPortfolio } from '../src/portfolio.js';
import { fixtureConfig, fixtureInput, serveFixture, tempDir, type FixtureServer } from './helpers.js';

type Rgba = [number, number, number, number];

async function pixel(path: string, x: number, y: number): Promise<Rgba> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 4;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!];
}

function near(actual: Rgba, expected: Rgba, tolerance = 6): boolean {
  return actual.every((channel, index) => Math.abs(channel - expected[index]!) <= tolerance);
}

let server: FixtureServer;
let root: string;
let base: ResolvedConfig;

/** Same root (so the raw captures are shared), different frame and output settings. */
function withConfig(overrides: Pick<ShowcaseConfig, 'frame' | 'outputs'>): ResolvedConfig {
  return resolveConfig(fixtureInput({ target: { mode: 'url', url: server.url }, ...overrides }), root);
}

beforeAll(async () => {
  server = await serveFixture();
  root = tempDir();
  base = fixtureConfig(root, { target: { mode: 'url', url: server.url } });
  await capture(base);
});

afterAll(async () => {
  await server.close();
});

describe('frame', () => {
  it('writes framed WebP images: raw CSS size plus bar and padding, at the capture DPR', async () => {
    const files = await frame(base);
    expect(files.map(file => file.id)).toEqual(['home', 'settings', 'about']);
    for (const file of files) {
      expect(file.path).toBe(join(root, 'assets', 'showcase', 'en', `${file.id}.webp`));
      const meta = await sharp(file.path).metadata();
      // (640 + 2 * 72) x (400 + 40 + 2 * 72) CSS pixels, times DPR 2.
      expect([meta.width, meta.height, meta.format]).toEqual([1568, 1168, 'webp']);
    }
  });

  it('draws the background, the title bar and the screenshot where they belong', async () => {
    const config = withConfig({
      frame: { background: '#ff0000', theme: 'light', shadow: false },
      outputs: { readme: 'solid/{lang}/{id}.png' },
    });
    const [file] = await frame(config, { only: ['settings'] });
    const raw = join(root, 'showcase-out', 'raw', 'en', 'settings.png');
    // Corner: background.
    expect(near(await pixel(file!.path, 4, 4), [255, 0, 0, 255])).toBe(true);
    // Inside the bar, right of the traffic lights: the light theme's bar color.
    expect(near(await pixel(file!.path, (72 + 320) * 2, (72 + 8) * 2), [0xec, 0xee, 0xf2, 255])).toBe(true);
    // The screenshot itself, 100 CSS pixels into it, matches the raw capture.
    const framed = await pixel(file!.path, (72 + 100) * 2, (72 + 40 + 100) * 2);
    expect(near(framed, await pixel(raw, 200, 200), 8)).toBe(true);
  });

  it('supports a bare style, transparent PNG and a width cap', async () => {
    const config = withConfig({
      frame: { style: 'none', background: { type: 'transparent' }, maxWidth: 784 },
      outputs: { readme: 'bare/{lang}/{id}.png' },
    });
    const [file] = await frame(config, { only: ['home'] });
    const meta = await sharp(file!.path).metadata();
    // (640 + 144) x (400 + 144) = 784 x 544 CSS, 1568 x 1088 at DPR 2, capped to 784 wide.
    expect([meta.width, meta.height, meta.format, meta.hasAlpha]).toEqual([784, 544, 'png', true]);
    expect((await pixel(file!.path, 2, 2))[3]).toBe(0);
  });

  it('explains a missing raw capture', async () => {
    const config = withConfig({ outputs: { raw: 'nowhere/{lang}/{id}.png' } });
    await expect(frame(config)).rejects.toThrow(/No raw capture for en\/home at .*Run `showcase capture` first/);
  });
});

describe('portfolio', () => {
  it('writes exact-size WebP images, a thumbnail and a gallery JSON that matches the files', async () => {
    const config = withConfig({
      frame: { background: '#00ff00', shadow: false },
      outputs: { portfolio: { dir: 'portfolio/public/projects/{slug}', size: [960, 540], thumbnail: 'settings', padding: 40 } },
    });
    const result = await exportPortfolio(config);
    const dir = join(root, 'portfolio', 'public', 'projects', 'fixture-app');
    expect(result.dir).toBe(dir);
    expect(readdirSync(dir).sort()).toEqual([
      'about.webp',
      'home.webp',
      'settings.webp',
      'showcase.gallery.json',
      'thumbnail.webp',
    ]);
    for (const name of ['about.webp', 'home.webp', 'settings.webp', 'thumbnail.webp']) {
      const meta = await sharp(join(dir, name)).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([960, 540, 'webp']);
    }
    expect(readFileSync(join(dir, 'thumbnail.webp')).equals(readFileSync(join(dir, 'settings.webp')))).toBe(true);

    const gallery = JSON.parse(readFileSync(join(dir, 'showcase.gallery.json'), 'utf8')) as unknown;
    expect(gallery).toEqual([
      { src: '/projects/fixture-app/home.webp', alt: 'Fixture App: Home', caption: 'The home view.' },
      { src: '/projects/fixture-app/settings.webp', alt: 'Fixture App: Settings', caption: 'Settings grid.' },
      { src: '/projects/fixture-app/about.webp', alt: 'Fixture App: About', caption: 'About' },
    ]);
    for (const item of gallery as { src: string }[]) {
      expect(readdirSync(dir)).toContain(item.src.split('/').pop());
    }
  });

  it('contains the window instead of cropping it: background shows on every side', async () => {
    const config = withConfig({
      frame: { background: '#00ff00', shadow: false },
      outputs: { portfolio: { dir: 'contain', size: [960, 540], padding: 40 } },
    });
    await exportPortfolio(config, { only: ['home'] });
    const file = join(root, 'contain', 'home.webp');
    const green: Rgba = [0, 255, 0, 255];
    for (const [x, y] of [
      [2, 270],
      [957, 270],
      [480, 2],
      [480, 537],
    ] as const) {
      expect(near(await pixel(file, x, y), green, 12), `background at ${String(x)},${String(y)}`).toBe(true);
    }
    expect(near(await pixel(file, 480, 300), green, 12)).toBe(false);
  });

  it('refuses to run without a portfolio output', async () => {
    await expect(exportPortfolio(withConfig({}))).rejects.toThrow(/No portfolio output configured/);
  });
});
