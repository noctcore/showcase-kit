import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture } from '../src/capture.js';
import { resolveConfig } from '../src/config/resolve.js';
import type { ResolvedConfig, ShowcaseConfig } from '../src/config/types.js';
import { ConfigError } from '../src/errors.js';
import { hero } from '../src/hero.js';
import { generateIcons, ICON_PRESETS } from '../src/icons.js';
import { fixtureInput, serveFixture, tempDir, type FixtureServer } from './helpers.js';

async function pixel(path: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 4;
  return [...data.subarray(offset, offset + 4)];
}

/** Size, format, and whether it is full-color RGBA (4 channels, not a 256-color palette). */
async function pngSize(data: Buffer): Promise<[number | undefined, number | undefined, string | undefined, string]> {
  const meta = await sharp(data).metadata();
  return [meta.width, meta.height, meta.format, meta.channels === 4 && !meta.isPalette ? 'rgba' : 'not rgba'];
}

describe('hero', () => {
  let server: FixtureServer;
  let root: string;
  const config = (overrides: Pick<ShowcaseConfig, 'hero'>): ResolvedConfig =>
    resolveConfig(fixtureInput({ target: { mode: 'url', url: server.url }, ...overrides }), root);

  beforeAll(async () => {
    server = await serveFixture();
    root = tempDir();
    await capture(config({}));
    await sharp({ create: { width: 256, height: 256, channels: 4, background: '#f59e0b' } })
      .png()
      .toFile(join(root, 'logo.png'));
  });
  afterAll(async () => {
    await server.close();
  });

  it('renders an exact-size banner with the text on the background and the windows on the right', async () => {
    const result = await hero(
      config({ hero: { tagline: 'Pictures of a tiny app.', logo: 'logo.png', background: '#123456' } }),
    );
    expect(result.path).toBe(join(root, 'assets', 'showcase', 'hero.webp'));
    const meta = await sharp(result.path).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1280, 640, 'webp']);
    // Top left corner: plain background.
    const corner = await pixel(result.path, 4, 4);
    expect(corner.slice(0, 3).every((channel, index) => Math.abs(channel - [0x12, 0x34, 0x56][index]!) <= 6)).toBe(true);
    // The logo (amber square) sits above the name, left of center.
    const logo = await pixel(result.path, 72 + 48, 320 - 90);
    expect(logo[0]).toBeGreaterThan(200);
    expect(logo[2]).toBeLessThan(80);
    // Right half, low: a window, not background.
    const window = await pixel(result.path, 1000, 450);
    expect(window.slice(0, 3)).not.toEqual(corner.slice(0, 3));
  });

  it('honours size, output and shot choice', async () => {
    const result = await hero(config({ hero: { size: [640, 320], output: 'banner-{lang}.png', shots: ['settings'] } }));
    expect(result.path).toBe(join(root, 'banner-en.png'));
    const meta = await sharp(result.path).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([640, 320, 'png']);
  });

  it('validates its options with the rest of the config', () => {
    expect(() => config({ hero: { shots: ['home', 'nope'], size: [100, 50] } })).toThrow(ConfigError);
    try {
      config({ hero: { shots: ['home', 'nope'], size: [100, 50] } });
    } catch (error) {
      expect((error as ConfigError).issues).toEqual([
        'hero.shots: "nope" is not a shot id',
        'hero.size: must be [width, height] in whole pixels (320 to 8192), got an array',
      ]);
    }
  });
});

describe('icons', () => {
  let source: string;
  beforeAll(async () => {
    source = join(tempDir(), 'mascot.png');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="480" fill="#0f766e"/></svg>';
    await sharp(Buffer.from(svg)).png().toFile(source);
  });

  it.each(['web', 'electron', 'tauri'] as const)('writes the %s preset at the listed sizes', async preset => {
    const out = tempDir();
    const written = await generateIcons(source, preset, out);
    expect(readdirSync(out).sort()).toEqual(ICON_PRESETS[preset].map(entry => entry.file).sort());
    expect(written).toHaveLength(ICON_PRESETS[preset].length);
    for (const entry of ICON_PRESETS[preset]) {
      if ('size' in entry) {
        expect(await pngSize(readFileSync(join(out, entry.file)))).toEqual([entry.size, entry.size, 'png', 'rgba']);
      }
    }
  });

  it('writes a valid .ico with one PNG per size', async () => {
    const out = tempDir();
    await generateIcons(source, 'electron', out);
    const ico = readFileSync(join(out, 'icon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    expect(count).toBe(4);
    const sizes = [];
    for (let index = 0; index < count; index++) {
      const at = 6 + index * 16;
      const declared = ico.readUInt8(at) || 256;
      const length = ico.readUInt32LE(at + 8);
      const offset = ico.readUInt32LE(at + 12);
      expect(await pngSize(ico.subarray(offset, offset + length))).toEqual([declared, declared, 'png', 'rgba']);
      sizes.push(declared);
    }
    expect(sizes).toEqual([16, 32, 48, 256]);
  });

  it('writes a valid .icns whose chunks hold PNGs of the right size', async () => {
    const out = tempDir();
    await generateIcons(source, 'tauri', out);
    const icns = readFileSync(join(out, 'icon.icns'));
    expect(icns.toString('ascii', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const expected: Record<string, number> = { ic11: 32, ic12: 64, ic07: 128, ic13: 256, ic08: 256, ic14: 512, ic09: 512, ic10: 1024 };
    const seen: string[] = [];
    for (let at = 8; at < icns.length; ) {
      const type = icns.toString('ascii', at, at + 4);
      const length = icns.readUInt32BE(at + 4);
      const size = expected[type];
      expect(size, `unexpected chunk ${type}`).toBeDefined();
      expect(await pngSize(icns.subarray(at + 8, at + length))).toEqual([size, size, 'png', 'rgba']);
      seen.push(type);
      at += length;
    }
    expect(seen.sort()).toEqual(Object.keys(expected).sort());
  });

  it('keeps an alpha channel for an opaque source too', async () => {
    const dir = tempDir();
    const opaque = join(dir, 'opaque.png');
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#1e1b4b' } })
      .png()
      .toFile(opaque);
    await generateIcons(opaque, 'electron', join(dir, 'out'));
    expect(await pngSize(readFileSync(join(dir, 'out', 'icon.png')))).toEqual([1024, 1024, 'png', 'rgba']);
  });

  it('refuses an unknown preset and a missing source', async () => {
    await expect(generateIcons(source, 'android' as never, tempDir())).rejects.toThrow(/Unknown icon preset "android"/);
    await expect(generateIcons('nope.png', 'web', tempDir())).rejects.toThrow(/Icon source not found/);
  });
});
