import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { launchBrowser } from './browser.js';
import type { ResolvedConfig, ResolvedShot } from './config/types.js';
import { ShowcaseError } from './errors.js';
import { formatOf, frameTitle, logWritten, readRaw, writeImage, type RawImage } from './frame/render.js';
import { backgroundCss, escapeHtml, page, windowMarkup } from './frame/template.js';
import { fillTemplate } from './template.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

// Back to front. Window widths and offsets are fractions of the canvas, so any `size` keeps the composition.
const STACKS: Record<number, { left: number; top: number; rotate: number }[]> = {
  1: [{ left: 0.47, top: 0.14, rotate: -3 }],
  2: [
    { left: 0.44, top: 0.1, rotate: -7 },
    { left: 0.53, top: 0.27, rotate: 2 },
  ],
  3: [
    { left: 0.42, top: 0.07, rotate: -9 },
    { left: 0.49, top: 0.2, rotate: -3 },
    { left: 0.56, top: 0.33, rotate: 3 },
  ],
};

async function logoSrc(config: ResolvedConfig): Promise<string | undefined> {
  if (!config.hero.logo) return undefined;
  const path = resolve(config.root, config.hero.logo);
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new ShowcaseError(`hero.logo must be a PNG, SVG, WebP or JPEG file, got ${path}`);
  if (!existsSync(path)) throw new ShowcaseError(`hero.logo not found: ${path}`);
  return `data:${mime};base64,${(await readFile(path)).toString('base64')}`;
}

/** The hero page: text on the left, framed shots stacked and tilted on the right. */
export function heroHtml(
  config: ResolvedConfig,
  { windows, logo }: { windows: { shot: ResolvedShot; raw: RawImage }[]; logo: string | undefined },
): string {
  const [width, height] = config.hero.size;
  const dark = config.hero.theme === 'dark';
  const stack = STACKS[windows.length] ?? [];
  const windowWidth = width * 0.5;
  const markup = windows
    .map(({ shot, raw }, index) => {
      const place = stack[index]!;
      const scale = windowWidth / raw.cssWidth;
      return windowMarkup({
        frame: config.frame,
        image: { width: windowWidth, height: raw.cssHeight * scale },
        // Chrome a little larger than true scale reads better at banner size.
        scale: Math.max(scale, 0.6),
        imageSrc: `data:image/png;base64,${raw.data.toString('base64')}`,
        title: frameTitle(config, shot, config.hero.lang),
        extraStyle: `position:absolute;left:${String(place.left * width)}px;top:${String(place.top * height)}px;transform:rotate(${String(place.rotate)}deg);transform-origin:center`,
      });
    })
    .join('');
  const unit = height / 640;
  const text = `<div class="text">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <div class="name">${escapeHtml(config.name)}</div>
    ${config.hero.tagline ? `<div class="tagline">${escapeHtml(config.hero.tagline)}</div>` : ''}
  </div>`;
  const css = `
  .text {
    position: absolute; left: ${String(72 * unit)}px; top: 50%; transform: translateY(-50%);
    width: ${String(width * 0.36)}px; z-index: 2;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: ${dark ? '#ffffff' : '#0f172a'};
  }
  .logo { display: block; width: ${String(96 * unit)}px; height: ${String(96 * unit)}px; object-fit: contain; margin-bottom: ${String(24 * unit)}px; }
  .name { font-size: ${String(60 * unit)}px; font-weight: 800; line-height: 1.05; letter-spacing: -0.02em; }
  .tagline { margin-top: ${String(16 * unit)}px; font-size: ${String(22 * unit)}px; line-height: 1.4; color: ${dark ? 'rgba(255,255,255,0.78)' : 'rgba(15,23,42,0.72)'}; }`;
  return page({ width, height }, backgroundCss(config.hero.background), `${markup}${text}`, css);
}

/** Render the README hero banner to `hero.output` at exactly `hero.size` pixels. */
export async function hero(config: ResolvedConfig): Promise<{ path: string; width: number; height: number }> {
  const { hero: settings } = config;
  const format = formatOf(settings.output);
  const windows = [];
  for (const id of settings.shots) {
    const shot = config.shots.find(candidate => candidate.id === id);
    if (!shot) throw new ShowcaseError(`hero.shots: "${id}" is not a shot id`);
    windows.push({ shot, raw: await readRaw(config, settings.lang, shot) });
  }
  const logo = await logoSrc(config);
  const [width, height] = settings.size;

  const browser = await launchBrowser(config);
  let png: Buffer;
  try {
    // Rendered at 2x and scaled down: sharper text and edges on the tilted windows.
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const tab = await context.newPage();
    await tab.setContent(heroHtml(config, { windows, logo }), { waitUntil: 'load' });
    await tab.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    png = await tab.screenshot({ type: 'png', omitBackground: settings.background.type === 'transparent' });
    await context.close();
  } finally {
    await browser.close();
  }

  const path = resolve(config.root, fillTemplate(settings.output, { lang: settings.lang, slug: config.slug }));
  const size = await writeImage(png, path, { format, quality: settings.quality, resize: { width, height } });
  logWritten('hero', path, size);
  return { path, ...size };
}
