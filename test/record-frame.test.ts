import type { Browser } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchBrowser } from '../src/browser.js';
import { resolveConfig } from '../src/config/resolve.js';
import type { FrameOptions, ResolvedConfig } from '../src/config/types.js';
import { composeInHole, renderFrame, renderFrameHole } from '../src/frame/render.js';
import { readmeLayout } from '../src/frame/template.js';

const CSS = { width: 300, height: 180 };

/** A busy screenshot whose edges and corners are loud colors, so any corner or outline mistake shows. */
async function screenshot(dpr: number): Promise<Buffer> {
  const w = CSS.width * dpr;
  const h = CSS.height * dpr;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(w)}" height="${String(h)}">
    <rect width="100%" height="100%" fill="#ff00ff"/>
    <rect x="${String(4 * dpr)}" y="${String(4 * dpr)}" width="${String(w - 8 * dpr)}" height="${String(h - 8 * dpr)}" fill="#1a1b26"/>
    <rect x="${String(20 * dpr)}" y="${String(20 * dpr)}" width="${String(120 * dpr)}" height="${String(30 * dpr)}" fill="#9ece6a"/>
    <rect x="${String(160 * dpr)}" y="${String(90 * dpr)}" width="${String(100 * dpr)}" height="${String(60 * dpr)}" fill="#e0af68"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function config(frame: FrameOptions, deviceScaleFactor: number): ResolvedConfig {
  return resolveConfig({ name: 'Hole', target: { mode: 'tty', command: 'x' }, shots: [{ id: 'a' }], frame, deviceScaleFactor }, process.cwd());
}

async function rgba(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Pixels whose largest channel difference (alpha included) is over 16, and the largest difference seen. */
async function compare(
  a: Buffer,
  b: Buffer,
): Promise<{ size: string[]; off: [number, number][]; total: number; max: number }> {
  const [x, y] = await Promise.all([rgba(a), rgba(b)]);
  const off: [number, number][] = [];
  let max = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    let worst = 0;
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs((x.data[i + c] ?? 0) - (y.data[i + c] ?? 0)));
    if (worst > 16) off.push([(i / 4) % x.width, Math.floor(i / 4 / x.width)]);
    max = Math.max(max, worst);
  }
  return { size: [`${String(x.width)}x${String(x.height)}`, `${String(y.width)}x${String(y.height)}`], off, total: x.data.length / 4, max };
}

let browser: Browser;
beforeAll(async () => {
  const any = config({}, 1);
  browser = await launchBrowser(any);
});
afterAll(async () => {
  await browser.close();
});

describe('frame hole for clips', () => {
  // Name, frame, DPR, and the bounds for differing pixels: share of all pixels and the largest channel difference.
  const cases: [string, FrameOptions, number, number, number][] = [
    ['window style, gradient, DPR 1', {}, 1, 0.0005, 64],
    ['window style, gradient, DPR 2', {}, 2, 0.0005, 64],
    ['minimal style, light, big radius, DPR 2', { style: 'minimal', theme: 'light', radius: 30, background: '#f5f5f5' }, 2, 0.0005, 64],
    // The corners are cut by a mask sharp draws, whose anti-aliasing is not Chromium's.
    ['no bar, transparent background, DPR 1', { style: 'none', background: { type: 'transparent' }, radius: 20 }, 1, 0.001, 160],
  ];

  it.each(cases)('matches framing the screenshot directly: %s', async (_, frameOptions, dpr, share, largest) => {
    const resolved = config(frameOptions, dpr);
    const png = await screenshot(dpr);
    const direct = await renderFrame(browser, resolved, {
      raw: { path: 'x.png', data: png, cssWidth: CSS.width, cssHeight: CSS.height },
      layout: readmeLayout(resolved.frame, CSS),
      // No title: a page screenshot with a transparent background draws text with grayscale instead of LCD
      // anti-aliasing, so a clip's title bar text is a shade softer. That is expected, not a hole problem.
      title: undefined,
      deviceScaleFactor: dpr,
    });
    const hole = await renderFrameHole(browser, resolved, { cssWidth: CSS.width, cssHeight: CSS.height, title: undefined });
    expect([hole.width, hole.height]).toEqual([CSS.width * dpr, CSS.height * dpr]);
    const composed = await composeInHole(hole, png);

    const { size, off, total, max } = await compare(direct, composed);
    expect(size[1]).toBe(size[0]);
    // Only anti-aliased pixels on the rounded corners may differ, and only a little.
    const r = resolved.frame.radius * dpr + 2;
    const inCorner = ([px, py]: [number, number]): boolean =>
      (px < hole.left + r || px >= hole.left + hole.width - r) && (py < hole.top + r || py >= hole.top + hole.height - r);
    expect(off.filter(pixel => !inCorner(pixel))).toEqual([]);
    expect(off.length / total).toBeLessThan(share);
    expect(max).toBeLessThan(largest);
  });

  it('leaves the hole see-through and paints nothing behind it', async () => {
    const resolved = config({}, 1);
    const hole = await renderFrameHole(browser, resolved, { cssWidth: CSS.width, cssHeight: CSS.height, title: undefined });
    const { data, width } = await rgba(hole.png);
    const alphaAt = (x: number, y: number): number => data[(y * width + x) * 4 + 3] ?? -1;
    // The middle of the hole is empty, the backdrop around the window is opaque.
    expect(alphaAt(hole.left + 150, hole.top + 90)).toBe(0);
    expect(alphaAt(2, 2)).toBe(255);
    // The window bar above the hole is opaque.
    expect(alphaAt(hole.left + 150, hole.top - 20)).toBe(255);
  });
});
