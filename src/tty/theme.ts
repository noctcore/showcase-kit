import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShowcaseError } from '../errors.js';
import type { ResolvedTerminalOptions, TerminalOptions, TerminalTheme } from './types.js';

/** Tokyo Night. */
export const DARK_THEME: TerminalTheme = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  ansi: [
    '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
    '#414868', '#ff899d', '#9fe044', '#faba4a', '#8db0ff', '#c7a9ff', '#a4daff', '#c0caf5',
  ],
};

/** Tokyo Night Day. */
export const LIGHT_THEME: TerminalTheme = {
  background: '#e1e2e7',
  foreground: '#3760bf',
  cursor: '#3760bf',
  ansi: [
    '#b4b5b9', '#f52a65', '#587539', '#8c6c3e', '#2e7de9', '#9854f1', '#007197', '#6172b0',
    '#a1a6c5', '#ff4774', '#5c8524', '#a27629', '#358aff', '#a463ff', '#007ea8', '#3760bf',
  ],
};

export const TERMINAL_DEFAULTS = { size: 15, lineHeight: 1.32, padding: 12, cursor: 'hide' } as const;

export const BUNDLED_FONTS = {
  file: 'JetBrainsMono-Regular.woff2',
  boldFile: 'JetBrainsMono-Bold.woff2',
  italicFile: 'JetBrainsMono-Italic.woff2',
  boldItalicFile: 'JetBrainsMono-BoldItalic.woff2',
} as const;
/**
 * The folder of the bundled JetBrains Mono (OFL 1.1, see `fonts/OFL.txt`). The build copies `src/tty/fonts` to
 * `dist/fonts`. This module sits next to it in source and in a root chunk of `dist`, or one level down when a
 * build puts the engine in a subfolder, so both places are tried.
 */
export function bundledFontDir(): string {
  const candidates = ['./fonts/', '../fonts/'].map(path => fileURLToPath(new URL(path, import.meta.url)));
  const found = candidates.find(dir => existsSync(resolve(dir, BUNDLED_FONTS.file)));
  if (!found) throw new ShowcaseError(`The bundled terminal font is missing; looked in ${candidates.join(' and ')}.`);
  return found;
}

/** JetBrains Mono's advance width as a fraction of the font size (600 of 1000 units). */
export const BUNDLED_ADVANCE = 0.6;

const HEX = /^#[0-9a-f]{6}$/i;

function checkTheme(theme: TerminalTheme): TerminalTheme {
  const bad = [theme.background, theme.foreground, ...(theme.cursor ? [theme.cursor] : []), ...theme.ansi].filter(
    c => !HEX.test(c),
  );
  if (theme.ansi.length !== 16) {
    throw new ShowcaseError(`terminal.theme.ansi needs exactly 16 colors, got ${String(theme.ansi.length)}.`);
  }
  if (bad.length) throw new ShowcaseError(`terminal.theme colors must be #rrggbb, got ${bad.join(', ')}.`);
  return { ...theme, ansi: [...theme.ansi] };
}

function positive(name: string, value: number, allowZero = false): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new ShowcaseError(`terminal.${name} must be a ${allowZero ? 'non-negative' : 'positive'} number, got ${String(value)}.`);
  }
  return value;
}

/**
 * Fill in every default and make font paths absolute (relative to `baseDir`, the config's folder). It checks what
 * the renderer relies on (16 ansi colors, #rrggbb colors, positive sizes, font files that exist) and throws a
 * `ShowcaseError` otherwise; the config layer still owns shape checks such as unknown keys.
 */
export function resolveTerminalOptions(opts: TerminalOptions | undefined, baseDir: string): ResolvedTerminalOptions {
  const theme = opts?.theme === 'light' ? LIGHT_THEME : opts?.theme === 'dark' || !opts?.theme ? DARK_THEME : opts.theme;
  const font: ResolvedTerminalOptions['font'] = {
    size: positive('font.size', opts?.font?.size ?? TERMINAL_DEFAULTS.size),
  };
  for (const key of ['file', 'boldFile', 'italicFile', 'boldItalicFile', 'fallbackFile'] as const) {
    const file = opts?.font?.[key];
    if (file === undefined) continue;
    const path = resolve(baseDir, file);
    if (!existsSync(path)) throw new ShowcaseError(`terminal.font.${key} does not exist: ${path}`);
    font[key] = path;
  }
  return {
    theme: checkTheme(theme),
    font,
    lineHeight: positive('lineHeight', opts?.lineHeight ?? TERMINAL_DEFAULTS.lineHeight),
    padding: positive('padding', opts?.padding ?? TERMINAL_DEFAULTS.padding, true),
    cursor: opts?.cursor ?? TERMINAL_DEFAULTS.cursor,
  };
}

/** The font files a look uses per face. A custom `file` never mixes with the bundled faces. */
export function fontFaces(look: ResolvedTerminalOptions): {
  regular: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
  fallback?: string;
  bundled: boolean;
} {
  const { font } = look;
  const bundled = (name: keyof typeof BUNDLED_FONTS): string | undefined =>
    font.file ? undefined : resolve(bundledFontDir(), BUNDLED_FONTS[name]);
  return {
    regular: font.file ?? resolve(bundledFontDir(), BUNDLED_FONTS.file),
    bold: font.boldFile ?? bundled('boldFile'),
    italic: font.italicFile ?? bundled('italicFile'),
    boldItalic: font.boldItalicFile ?? bundled('boldItalicFile'),
    fallback: font.fallbackFile,
    bundled: !font.file,
  };
}

const FORMATS: Record<string, string> = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };
const dataUrls = new Map<string, string>();

function fontUrl(path: string): string {
  let url = dataUrls.get(path);
  if (!url) {
    const format = FORMATS[extname(path).toLowerCase()];
    if (!format) throw new ShowcaseError(`Unsupported font file ${path}: use woff2, woff, ttf or otf.`);
    let data: Buffer;
    try {
      data = readFileSync(path);
    } catch (error) {
      throw new ShowcaseError(`Cannot read font file ${path}: ${(error as Error).message}`);
    }
    url = `url(data:font/${format === 'truetype' ? 'ttf' : format === 'opentype' ? 'otf' : format};base64,${data.toString('base64')}) format('${format}')`;
    dataUrls.set(path, url);
  }
  return url;
}

export const FONT_FAMILY = 'ShowcaseTerm';
export const FALLBACK_FAMILY = 'ShowcaseTermFallback';

/** `@font-face` rules with every font inlined as a data URL, so rendering never touches the network. */
export function fontFaceCss(look: ResolvedTerminalOptions): string {
  const faces = fontFaces(look);
  const rule = (family: string, weight: number, style: string, path: string | undefined): string =>
    path ? `@font-face{font-family:'${family}';font-weight:${String(weight)};font-style:${style};src:${fontUrl(path)};}` : '';
  return [
    rule(FONT_FAMILY, 400, 'normal', faces.regular),
    rule(FONT_FAMILY, 700, 'normal', faces.bold),
    rule(FONT_FAMILY, 400, 'italic', faces.italic),
    rule(FONT_FAMILY, 700, 'italic', faces.boldItalic),
    rule(FALLBACK_FAMILY, 400, 'normal', faces.fallback),
  ].join('');
}
