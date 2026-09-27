import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture } from '../src/capture.js';
import { HERO_LAYOUTS, resolveConfig } from '../src/config/resolve.js';
import type { HeroLayout, ResolvedConfig, ShowcaseConfig, TtyConfig } from '../src/config/types.js';
import { frame } from '../src/frame/index.js';
import { frameAddress, frameBarColor } from '../src/frame/render.js';
import { hero } from '../src/hero.js';
import { LIGHT_THEME } from '../src/tty/theme.js';
import { fixtureInput, serveFixture, tempDir, type FixtureServer } from './helpers.js';

type Rgb = [number, number, number];

async function raw(path: string): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function pixel(path: string, x: number, y: number): Promise<Rgb> {
  const { data, width } = await raw(path);
  const offset = (y * width + x) * 3;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
}

/** Share of the pixels in a box that differ from `background` by more than a lossy encoder would. */
async function covered(path: string, box: { x: number; y: number; w: number; h: number }, background: Rgb): Promise<number> {
  const { data, width } = await raw(path);
  let hits = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const offset = (y * width + x) * 3;
      if (background.some((channel, index) => Math.abs(data[offset + index]! - channel) > 16)) hits++;
    }
  }
  return hits / (box.w * box.h);
}

const near = (actual: number[], expected: number[], tolerance = 8): boolean =>
  actual.every((channel, index) => Math.abs(channel - expected[index]!) <= tolerance);

let server: FixtureServer;
let root: string;

function config(overrides: Pick<ShowcaseConfig, 'hero' | 'frame' | 'outputs'>): ResolvedConfig {
  return resolveConfig(fixtureInput({ target: { mode: 'url', url: server.url }, ...overrides }), root);
}

beforeAll(async () => {
  server = await serveFixture();
  root = tempDir();
  await capture(config({}));
});

afterAll(async () => {
  await server.close();
});

const BG: Rgb = [0x12, 0x34, 0x56];

/**
 * Where each layout puts windows and where it leaves the background, in banner pixels (1280x640). The boxes avoid
 * the text on the left or at the top.
 */
const PLACES: Record<HeroLayout, { windows: { x: number; y: number; w: number; h: number }; empty: { x: number; y: number; w: number; h: number } }> = {
  // Three windows at 0.42 to 0.56 of the width, tilted: the right half, low, is covered.
  stack: { windows: { x: 900, y: 380, w: 200, h: 100 }, empty: { x: 560, y: 590, w: 60, h: 40 } },
  // One window from x 550, y 128, running off the right and bottom edges.
  spotlight: { windows: { x: 1150, y: 560, w: 120, h: 70 }, empty: { x: 560, y: 20, w: 700, h: 80 } },
  // One window 640 wide from x 576, 400 high, centered: nothing below it.
  split: { windows: { x: 800, y: 260, w: 200, h: 120 }, empty: { x: 560, y: 580, w: 700, h: 50 } },
  // Three windows 365 wide from x 64 at y 320, under the centered text.
  row: { windows: { x: 100, y: 400, w: 1080, h: 60 }, empty: { x: 20, y: 20, w: 200, h: 200 } },
  // A wall on the right; the mask hides it on the left.
  mosaic: { windows: { x: 900, y: 200, w: 300, h: 250 }, empty: { x: 20, y: 500, w: 300, h: 120 } },
  // One window 794 wide from x 243 at y 320, leaning back: the bottom corners stay empty.
  centered: { windows: { x: 500, y: 450, w: 280, h: 150 }, empty: { x: 20, y: 400, w: 150, h: 220 } },
};

describe('hero layouts', () => {
  it.each(HERO_LAYOUTS)('%s puts the windows where it says and leaves the rest to the background', async layout => {
    const result = await hero(
      config({
        hero: { layout, output: `hero-${layout}.png`, background: '#123456' },
        frame: { shadow: false },
      }),
    );
    const meta = await sharp(result.path).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1280, 640, 'png']);
    const place = PLACES[layout];
    expect(await covered(result.path, place.windows, BG)).toBeGreaterThan(0.8);
    expect(await covered(result.path, place.empty, BG)).toBeLessThan(0.01);
  });

  it('renders the same bytes on a second run', async () => {
    const settings = { layout: 'mosaic' as const, background: { type: 'noise' as const, from: '#123456', to: '#345678' } };
    const first = readFileSync((await hero(config({ hero: { ...settings, output: 'a.png' } }))).path);
    const second = readFileSync((await hero(config({ hero: { ...settings, output: 'b.png' } }))).path);
    expect(first.equals(second)).toBe(true);
  });
});

describe('frame styles', () => {
  const framed = async (style: 'browser' | 'windows' | 'terminal', theme: 'light' | 'dark' = 'dark') => {
    const [file] = await frame(
      config({
        frame: { style, theme, background: '#ff0000', shadow: false, address: 'demo.app/{id}' },
        outputs: { readme: `styles/${style}-${theme}-{id}.png` },
      }),
      { only: ['home'] },
    );
    return file!;
  };

  it.each([
    // (640 + 2 * 72) x (400 + bar + 2 * 72) CSS pixels at DPR 2, with bars of 44, 32 and 34.
    ['browser', 1176],
    ['windows', 1152],
    ['terminal', 1156],
  ] as const)('%s adds its bar height', async (style, height) => {
    const file = await framed(style);
    expect([file.width, file.height]).toEqual([1568, height]);
  });

  it('draws the Windows bar in its own colors, light and dark', async () => {
    // A point in the bar between the title and the caption buttons, at DPR 2.
    const point = [(72 + 400) * 2, (72 + 16) * 2] as const;
    expect(await pixel((await framed('windows')).path, ...point)).toEqual([0x20, 0x20, 0x20]);
    expect(await pixel((await framed('windows', 'light')).path, ...point)).toEqual([0xf3, 0xf3, 0xf3]);
  });

  it('draws the address field in the middle of the browser bar', async () => {
    const { path } = await framed('browser');
    const bar = await pixel(path, (72 + 120) * 2, (72 + 36) * 2);
    // Inside the field, left of the address text: the bar color with 8% white over it.
    const field = await pixel(path, (72 + 190) * 2, (72 + 22) * 2);
    expect(near(bar, [0x1f, 0x24, 0x30])).toBe(true);
    expect(near(field, [0x2f, 0x34, 0x3f])).toBe(true);
  });

  it('draws the terminal bar without a line between bar and screen', async () => {
    const { path } = await framed('terminal');
    expect(near(await pixel(path, (72 + 100) * 2, (72 + 17) * 2), [0x16, 0x18, 0x1d])).toBe(true);
    // The last device pixel row of the 34 px bar, where the other styles draw their hairline.
    expect(near(await pixel(path, (72 + 100) * 2, (72 + 34) * 2 - 1), [0x16, 0x18, 0x1d], 4)).toBe(true);
  });

  it('fills the address from the shot: the url a path nav visits, the target url for a click', () => {
    const resolved = config({ frame: { style: 'browser' } });
    const host = server.url.replace('http://', '');
    const [home, , about] = resolved.shots;
    expect(frameAddress(resolved, home!, 'en')).toBe(host);
    expect(frameAddress(resolved, about!, 'en')).toBe(`${host}about`);
    const custom = config({ frame: { style: 'browser', address: '{name} {title} {id} {lang}' } });
    expect(frameAddress(custom, about!, 'pl')).toBe('Fixture App About about pl');
    expect(frameAddress(config({}), home!, 'en')).toBeUndefined();
  });

  it('gives the terminal bar the terminal background in tty mode only', () => {
    const tty = resolveConfig(
      {
        name: 'Rumi',
        target: { mode: 'tty', command: 'rumi' },
        shots: [{ id: 'home' }],
        terminal: { theme: 'light' },
        frame: { style: 'terminal' },
      } satisfies TtyConfig,
      root,
    );
    expect(frameBarColor(tty)).toBe(LIGHT_THEME.background);
    expect(frameBarColor({ ...tty, frame: { ...tty.frame, style: 'window' } })).toBeUndefined();
    expect(frameBarColor(config({ frame: { style: 'terminal' } }))).toBeUndefined();
  });
});

describe('backgrounds', () => {
  const framed = async (name: string, background: NonNullable<ShowcaseConfig['frame']>['background']) => {
    const [file] = await frame(config({ frame: { background, shadow: false }, outputs: { readme: `bg/${name}-{id}.png` } }), {
      only: ['home'],
    });
    return file!.path;
  };

  it('mesh: each color glows from its corner over the first', async () => {
    const path = await framed('mesh', { type: 'mesh', colors: ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00'] });
    const [width, height] = [1568, 1168];
    expect(near(await pixel(path, 2, 2), [255, 0, 0], 12)).toBe(true);
    expect(near(await pixel(path, width - 3, 2), [0, 255, 0], 12)).toBe(true);
    expect(near(await pixel(path, width - 3, height - 3), [0, 0, 255], 12)).toBe(true);
    expect(near(await pixel(path, 2, height - 3), [255, 255, 0], 12)).toBe(true);
  });

  it('dots: a dot in the middle of every tile, the color between them', async () => {
    const path = await framed('dots', { type: 'dots', color: '#000000', dot: '#ffffff', spacing: 24 });
    // The first tile is 24 CSS pixels square from the corner: its center is at 12, 12, or 24, 24 at DPR 2.
    expect((await pixel(path, 24, 24)).every(channel => channel > 200)).toBe(true);
    expect(await pixel(path, 0, 0)).toEqual([0, 0, 0]);
    expect(await pixel(path, 48 + 24, 24)).toEqual(await pixel(path, 24, 24));
  });

  it('noise: grain the gradient does not have, from amount 0 to 1', async () => {
    const spread = async (amount: number) => {
      const path = await framed(`noise-${String(amount)}`, { type: 'noise', from: '#404040', to: '#404040', amount });
      const { data, width } = await raw(path);
      const values = [];
      for (let x = 0; x < 120; x++) values.push(data[(10 * width + x) * 3]!);
      return Math.max(...values) - Math.min(...values);
    };
    expect(await spread(0)).toBe(0);
    expect(await spread(1)).toBeGreaterThan(40);
  });
});
