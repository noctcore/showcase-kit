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
import { frameHtml, type FrameLayout } from './template.js';

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
