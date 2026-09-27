import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { launchBrowser } from './browser.js';
import type { HeroLayout, ResolvedConfig, ResolvedShot } from './config/types.js';
import { ShowcaseError } from './errors.js';
import {
  formatOf,
  frameAddress,
  frameBarColor,
  frameTitle,
  logWritten,
  readRaw,
  writeImage,
  type RawImage,
} from './frame/render.js';
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

type HeroWindow = { shot: ResolvedShot; raw: RawImage };

interface Composition {
  config: ResolvedConfig;
  windows: HeroWindow[];
  width: number;
  height: number;
  /** One banner pixel at the default 640 px height, so text and gaps scale with `size`. */
  unit: number;
  dark: boolean;
}

/** One framed window `width` CSS pixels wide. Chrome a little larger than true scale reads better at banner size. */
function heroWindow({ config }: Composition, { shot, raw }: HeroWindow, width: number, extraStyle: string): string {
  const scale = width / raw.cssWidth;
  return windowMarkup({
    frame: config.frame,
    image: { width, height: raw.cssHeight * scale },
    scale: Math.max(scale, 0.6),
    imageSrc: `data:image/png;base64,${raw.data.toString('base64')}`,
    title: frameTitle(config, shot, config.hero.lang),
    address: frameAddress(config, shot, config.hero.lang),
    barColor: frameBarColor(config),
    extraStyle,
  });
}

const n = (value: number): string => String(value);

/** Logo, name and tagline: left-aligned in a column, or centered across the banner. */
function textBlock({ config, width, unit, dark }: Composition, place: { left: number; column: number } | { top: number; centered: true }, logo: string | undefined): { markup: string; css: string } {
  const markup = `<div class="text">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <div class="name">${escapeHtml(config.name)}</div>
    ${config.hero.tagline ? `<div class="tagline">${escapeHtml(config.hero.tagline)}</div>` : ''}
  </div>`;
  const color = dark ? '#ffffff' : '#0f172a';
  const muted = dark ? 'rgba(255,255,255,0.78)' : 'rgba(15,23,42,0.72)';
  if ('centered' in place) {
    return {
      markup,
      css: `
  .text {
    position: absolute; left: ${n(72 * unit)}px; right: ${n(72 * unit)}px; top: ${n(place.top)}px; z-index: 2; text-align: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: ${color};
  }
  .logo { display: block; width: ${n(72 * unit)}px; height: ${n(72 * unit)}px; object-fit: contain; margin: 0 auto ${n(18 * unit)}px; }
  .name { font-size: ${n(54 * unit)}px; font-weight: 800; line-height: 1.05; letter-spacing: -0.02em; }
  .tagline { margin-top: ${n(12 * unit)}px; font-size: ${n(21 * unit)}px; line-height: 1.4; color: ${muted}; }`,
    };
  }
  return {
    markup,
    css: `
  .text {
    position: absolute; left: ${n(place.left)}px; top: 50%; transform: translateY(-50%);
    width: ${n(width * place.column)}px; z-index: 2;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: ${color};
  }
  .logo { display: block; width: ${n(96 * unit)}px; height: ${n(96 * unit)}px; object-fit: contain; margin-bottom: ${n(24 * unit)}px; }
  .name { font-size: ${n(60 * unit)}px; font-weight: 800; line-height: 1.05; letter-spacing: -0.02em; }
  .tagline { margin-top: ${n(16 * unit)}px; font-size: ${n(22 * unit)}px; line-height: 1.4; color: ${muted}; }`,
  };
}

/** The windows of each layout, as markup placed on the canvas. Text is added by `heroHtml`. */
const LAYOUTS: Record<HeroLayout, (c: Composition) => string> = {
  stack: c => {
    const stack = STACKS[c.windows.length] ?? [];
    return c.windows
      .map((window, index) => {
        const place = stack[index]!;
        return heroWindow(
          c,
          window,
          c.width * 0.5,
          `position:absolute;left:${String(place.left * c.width)}px;top:${String(place.top * c.height)}px;transform:rotate(${String(place.rotate)}deg);transform-origin:center`,
        );
      })
      .join('');
  },
  // One straight window, larger than the canvas has room for, running off the right and bottom edges.
  spotlight: c =>
    heroWindow(c, c.windows[0]!, c.width * 0.68, `position:absolute;left:${n(c.width * 0.43)}px;top:${n(c.height * 0.2)}px`),
  // One window turned towards the text, in a perspective that scales with the banner.
  split: c => {
    const window = c.windows[0]!;
    const width = c.width * 0.5;
    const height = (window.raw.cssHeight * width) / window.raw.cssWidth;
    return (
      `<div style="position:absolute;left:${n(c.width * 0.45)}px;top:${n(c.height / 2 - height / 2)}px;perspective:${n(1600 * c.unit)}px">` +
      heroWindow(c, window, width, 'transform:rotateY(22deg) rotateX(6deg);transform-origin:60% 50%') +
      '</div>'
    );
  },
  // One to four windows side by side, centered under the text; tall captures run off the bottom edge.
  row: c => {
    const count = c.windows.length;
    const gap = 28 * c.unit;
    const width = Math.min((c.width - 2 * 64 * c.unit - gap * (count - 1)) / count, c.width * 0.56);
    const left = (c.width - (width * count + gap * (count - 1))) / 2;
    return c.windows
      .map((window, index) =>
        heroWindow(c, window, width, `position:absolute;left:${n(left + index * (width + gap))}px;top:${n(c.height * 0.5)}px`),
      )
      .join('');
  },
  // A wall of windows, repeated to fill it, laid flat and turned; it fades out towards the text.
  mosaic: c => {
    const columns = 3;
    const rows = 4;
    const width = c.width * 0.3;
    const gap = 36 * c.unit;
    const tiles = [];
    for (let index = 0; index < columns * rows; index++) {
      const window = c.windows[index % c.windows.length]!;
      tiles.push(heroWindow(c, window, width, ''));
    }
    // Centered on a point right of the text, turned about its own center, whatever its height comes to.
    const wall =
      `<div style="position:absolute;left:${n(c.width * 0.72)}px;top:${n(c.height * 0.5)}px;display:grid;` +
      `grid-template-columns:repeat(${n(columns)},${n(width)}px);gap:${n(gap)}px;` +
      `transform:translate(-50%,-50%) rotateX(52deg) rotateZ(-38deg)">${tiles.join('')}</div>`;
    const mask = 'linear-gradient(90deg,transparent 30%,#000 52%)';
    return `<div style="position:absolute;inset:0;-webkit-mask-image:${mask};mask-image:${mask}">${wall}</div>`;
  },
  // One window rising from the bottom edge, leaning back, under centered text.
  centered: c => {
    const window = c.windows[0]!;
    const width = c.width * 0.62;
    return (
      `<div style="position:absolute;left:${n((c.width - width) / 2)}px;top:${n(c.height * 0.5)}px;perspective:${n(1400 * c.unit)}px">` +
      heroWindow(c, window, width, 'transform:rotateX(16deg);transform-origin:50% 0') +
      '</div>'
    );
  },
};

/** The hero page: text and framed shots, arranged by `hero.layout`. */
export function heroHtml(
  config: ResolvedConfig,
  { windows, logo }: { windows: HeroWindow[]; logo: string | undefined },
): string {
  const [width, height] = config.hero.size;
  const composition: Composition = { config, windows, width, height, unit: height / 640, dark: config.hero.theme === 'dark' };
  const { layout } = config.hero;
  const place =
    layout === 'row' || layout === 'centered'
      ? { top: height * (layout === 'row' ? 0.08 : 0.1), centered: true as const }
      : { left: 72 * composition.unit, column: layout === 'spotlight' || layout === 'mosaic' ? 0.34 : 0.36 };
  const text = textBlock(composition, place, logo);
  return page({ width, height }, backgroundCss(config.hero.background), `${LAYOUTS[layout](composition)}${text.markup}`, text.css);
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
