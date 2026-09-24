import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative } from 'node:path';
import type { Browser } from 'playwright';
import sharp from 'sharp';
import type { ResolvedConfig, ResolvedShot } from '../config/types.js';
import { ShowcaseError } from '../errors.js';
import { log } from '../log.js';
import { outputPath } from '../paths.js';
import { fillTemplate } from '../template.js';
import { frameHtml, readmeLayout, type FrameLayout } from './template.js';

export type ImageFormat = 'webp' | 'png';

export interface RawImage {
  path: string;
  data: Buffer;
  /** Size in CSS pixels: device pixels divided by the capture's device scale factor. */
  cssWidth: number;
  cssHeight: number;
}

/** Read a raw capture, or explain that `showcase capture` has to run first. */
export async function readRaw(config: ResolvedConfig, lang: string, shot: ResolvedShot): Promise<RawImage> {
  const path = outputPath(config, config.outputs.raw, lang, shot.id);
  if (!existsSync(path)) {
    throw new ShowcaseError(`No raw capture for ${lang}/${shot.id} at ${path}. Run \`showcase capture\` first.`);
  }
  const data = await readFile(path);
  const { width, height } = await sharp(data).metadata();
  if (!width || !height) throw new ShowcaseError(`Cannot read image size of ${path}`);
  return {
    path,
    data,
    cssWidth: Math.round(width / config.deviceScaleFactor),
    cssHeight: Math.round(height / config.deviceScaleFactor),
  };
}

export function frameTitle(config: ResolvedConfig, shot: ResolvedShot, lang: string): string | undefined {
  if (config.frame.title === false || config.frame.style === 'none') return undefined;
  return fillTemplate(config.frame.title, { name: config.name, title: shot.title, id: shot.id, lang });
}

/** Render one framed image to a PNG buffer at `layout.canvas * deviceScaleFactor` pixels. */
export async function renderFrame(
  browser: Browser,
  config: ResolvedConfig,
  { raw, layout, title, deviceScaleFactor }: { raw: RawImage; layout: FrameLayout; title: string | undefined; deviceScaleFactor: number },
): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: Math.round(layout.canvas.width), height: Math.round(layout.canvas.height) },
    deviceScaleFactor,
  });
  try {
    const page = await context.newPage();
    const imageSrc = `data:image/png;base64,${raw.data.toString('base64')}`;
    await page.setContent(frameHtml({ frame: config.frame, layout, imageSrc, title }), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    return await page.screenshot({
      type: 'png',
      scale: 'device',
      omitBackground: config.frame.background.type === 'transparent',
    });
  } finally {
    await context.close();
  }
}

export function formatOf(path: string): ImageFormat {
  const extension = extname(path).toLowerCase();
  if (extension === '.webp') return 'webp';
  if (extension === '.png') return 'png';
  throw new ShowcaseError(`Unsupported image extension "${extension}" in ${path} (use .webp or .png)`);
}

/** Encode a rendered PNG as WebP or PNG, optionally capping the width, and write it. */
export async function writeImage(
  png: Buffer,
  path: string,
  {
    format,
    quality,
    maxWidth,
    resize,
  }: { format: ImageFormat; quality: number; maxWidth?: number; resize?: { width: number; height: number } },
): Promise<{ width: number; height: number }> {
  let image = sharp(png);
  if (resize) image = image.resize(resize.width, resize.height);
  else if (maxWidth) image = image.resize({ width: maxWidth, withoutEnlargement: true });
  image = format === 'webp' ? image.webp({ quality, effort: 5 }) : image.png({ compressionLevel: 9 });
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return { width: info.width, height: info.height };
}

export function logWritten(label: string, path: string, size: { width: number; height: number }): void {
  log.info(`  ok    ${label}  ${String(size.width)}x${String(size.height)}  ${relative(process.cwd(), path)}`);
}

/** A frame rendered around a transparent hole, and where the hole is, in device pixels. */
export interface FrameHole {
  png: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * With a transparent frame background nothing covers the screenshot's corners, so it is cut to the hole's shape
   * (a hole-sized PNG whose alpha is the coverage). An opaque background covers them exactly, so it has none.
   */
  shape: Buffer | undefined;
}

/**
 * Render the README frame for a screenshot of `cssWidth` x `cssHeight` once, with a transparent hole where the
 * screenshot goes. `composeInHole` then puts any number of frames into it without a browser, which is how clips
 * are framed. The hole follows the window's rounded corners, and the window outline is drawn over it.
 */
export async function renderFrameHole(
  browser: Browser,
  config: ResolvedConfig,
  { cssWidth, cssHeight, title }: { cssWidth: number; cssHeight: number; title: string | undefined },
): Promise<FrameHole> {
  const deviceScaleFactor = config.deviceScaleFactor;
  const layout = readmeLayout(config.frame, { width: cssWidth, height: cssHeight });
  const context = await browser.newContext({
    viewport: { width: Math.round(layout.canvas.width), height: Math.round(layout.canvas.height) },
    deviceScaleFactor,
  });
  try {
    const page = await context.newPage();
    await page.setContent(frameHtml({ frame: config.frame, layout, imageSrc: undefined, title }), { waitUntil: 'load' });
    // Measured in the page, so the hole always matches the layout the template really produced.
    const hole = await page.evaluate(async () => {
      await document.fonts.ready;
      const slot = document.getElementById('hole');
      const win = slot?.closest('.window');
      const backdrop = document.getElementById('backdrop');
      if (!slot || !win || !backdrop) throw new Error('frame page is missing its hole');
      const { x, y, width: w, height: h } = slot.getBoundingClientRect();
      const box = win.getBoundingClientRect();
      const r = Math.min(parseFloat(getComputedStyle(win).borderBottomLeftRadius) || 0, w / 2, h / 2);
      // Top corners are only rounded when there is no title bar above the screenshot.
      const rt = Math.abs(y - box.y) < 0.5 ? r : 0;
      const arc = (radius: number, toX: number, toY: number): string =>
        radius > 0 ? `A${String(radius)} ${String(radius)} 0 0 1 ${String(toX)} ${String(toY)}` : `L${String(toX)} ${String(toY)}`;
      const { innerWidth: W, innerHeight: H } = window;
      const hole = (ox: number, oy: number): string =>
        `M${String(x - ox + rt)} ${String(y - oy)}H${String(x - ox + w - rt)}${arc(rt, x - ox + w, y - oy + rt)}` +
        `V${String(y - oy + h - r)}${arc(r, x - ox + w - r, y - oy + h)}H${String(x - ox + r)}${arc(r, x - ox, y - oy + h - r)}` +
        `V${String(y - oy + rt)}${arc(rt, x - ox + rt, y - oy)}Z`;
      backdrop.style.clipPath = `path(evenodd, "M0 0H${String(W)}V${String(H)}H0Z${hole(0, 0)}")`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { x, y, w, h, shape: hole(x, y) };
    });
    const png = await page.screenshot({ type: 'png', scale: 'device', omitBackground: true });
    const width = Math.round(hole.w * deviceScaleFactor);
    const height = Math.round(hole.h * deviceScaleFactor);
    let shape: Buffer | undefined;
    if (config.frame.background.type === 'transparent') {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(hole.w)} ${String(hole.h)}">` +
        `<path d="${hole.shape}" fill="#fff"/></svg>`;
      shape = await sharp(Buffer.from(svg)).png().toBuffer();
    }
    return {
      png,
      left: Math.round(hole.x * deviceScaleFactor),
      top: Math.round(hole.y * deviceScaleFactor),
      width,
      height,
      shape,
    };
  } finally {
    await context.close();
  }
}

/** Put one screenshot into a frame's hole: the screenshot underneath, the frame (corners, outline) on top. */
export async function composeInHole(hole: FrameHole, screenshot: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(hole.png).metadata();
  let inner = screenshot;
  const size = await sharp(screenshot).metadata();
  // Only a fractional device scale factor can make these differ by a pixel.
  if (size.width !== hole.width || size.height !== hole.height) {
    inner = await sharp(screenshot).resize(hole.width, hole.height, { fit: 'fill' }).png().toBuffer();
  }
  if (hole.shape) inner = await sharp(inner).composite([{ input: hole.shape, blend: 'dest-in' }]).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: inner, left: hole.left, top: hole.top },
      { input: hole.png, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 1 })
    .toBuffer();
}
