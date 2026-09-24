import type { Page } from 'playwright';
import { ShowcaseError } from '../errors.js';
import { Attr, DEFAULT_COLOR, TRUECOLOR, type Grid, type GridCell, type GridColor } from './session.js';
import { BUNDLED_ADVANCE, checkTheme, FALLBACK_FAMILY, FONT_FAMILY, fontFaceCss, fontFaces } from './theme.js';
import type { RenderTtyScreen, ResolvedTerminalOptions, TerminalTheme, TtyScreen } from './types.js';

/** Whole CSS pixels per cell and per row, and the letter spacing that makes the font's advance match the cell. */
export interface CellMetrics {
  cellWidth: number;
  lineHeight: number;
  letterSpacing: number;
}

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const CUBE = [0, 95, 135, 175, 215, 255];

/** A palette index or truecolor value as `#rrggbb`: 0 to 15 from the theme, then the xterm cube and gray ramp. */
function paletteColor(color: GridColor, theme: TerminalTheme): string {
  if (color >= TRUECOLOR) {
    const rgb = color - TRUECOLOR;
    return hex((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
  }
  if (color < 16) return theme.ansi[color] ?? theme.foreground;
  if (color < 232) {
    const i = color - 16;
    return hex(CUBE[Math.floor(i / 36)] ?? 0, CUBE[Math.floor(i / 6) % 6] ?? 0, CUBE[i % 6] ?? 0);
  }
  const gray = 8 + (color - 232) * 10;
  return hex(gray, gray, gray);
}

function mix(a: string, b: string, amount: number): string {
  const channel = (c: string, i: number): number => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return hex(...([0, 1, 2].map(i => channel(a, i) * (1 - amount) + channel(b, i) * amount) as [number, number, number]));
}

/** Final text and background colors of a cell; `bg` undefined means the theme background shows through. */
export function cellColors(
  [, , fgColor, bgColor, attrs]: GridCell,
  theme: TerminalTheme,
  isCursor = false,
): { fg: string; bg: string | undefined } {
  // Bold with one of the 8 basic colors picks the bright variant, like most terminals.
  const brighten = attrs & Attr.bold && fgColor >= 0 && fgColor < 8 ? 8 : 0;
  let fg = fgColor === DEFAULT_COLOR ? theme.foreground : paletteColor(fgColor + brighten, theme);
  let bg = bgColor === DEFAULT_COLOR ? undefined : paletteColor(bgColor, theme);
  if (attrs & Attr.inverse) [fg, bg] = [bg ?? theme.background, fg];
  // Dim blends toward the background instead of using opacity, which would fade the cell background too.
  if (attrs & Attr.dim) fg = mix(fg, bg ?? theme.background, 0.5);
  // A block cursor: the glyph in the background color, so it stays visible whatever the cursor color is.
  if (isCursor) [fg, bg] = [bg ?? theme.background, theme.cursor ?? theme.foreground];
  return { fg, bg };
}

function cellStyle(cell: GridCell, theme: TerminalTheme, isCursor: boolean): string {
  const attrs = cell[4];
  const { fg, bg } = cellColors(cell, theme, isCursor);
  let style = `color:${fg};`;
  if (bg) style += `background:${bg};`;
  if (attrs & Attr.bold) style += 'font-weight:700;';
  if (attrs & Attr.italic) style += 'font-style:italic;';
  const lines = [
    attrs & Attr.underline && 'underline',
    attrs & Attr.strikethrough && 'line-through',
    attrs & Attr.overline && 'overline',
  ].filter(Boolean);
  if (lines.length) style += `text-decoration:${lines.join(' ')};`;
  return style;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, c => `&#${String(c.charCodeAt(0))};`);

/**
 * Printable ASCII is in every font the renderer can be given, so runs of it can share one span. Anything else may
 * come from a fallback font with another advance: it gets its own clipped cell and cannot shift the row.
 */
const IN_RUN = /^[\x20-\x7e]$/;

/**
 * The grid as absolutely positioned spans. Every position and width is a whole number of CSS pixels computed from
 * the column, so nothing accumulates along a row (inline runs drifted by a device pixel after about 36 runs).
 */
export function gridHtml(grid: Grid, look: ResolvedTerminalOptions, metrics: CellMetrics): string {
  const { theme } = look;
  const { cellWidth: cw, lineHeight: lh } = metrics;
  const showCursor = look.cursor === 'show' && grid.cursor.visible;
  let html = '';
  for (const [y, row] of grid.cells.entries()) {
    let run: { x: number; width: number; text: string; style: string } | undefined;
    const flush = (): void => {
      if (!run) return;
      // Trailing blanks without a background or a line draw nothing: leave them out.
      if (run.text.length === run.width && !/background|text-decoration/.test(run.style)) {
        const text = run.text.replace(/ +$/, '');
        run.width -= run.text.length - text.length;
        run.text = text;
      }
      if (run.width > 0) {
        const box = `left:${String(run.x * cw)}px;top:${String(y * lh)}px;width:${String(run.width * cw)}px;`;
        html += `<span style="${box}${run.style}">${escapeHtml(run.text)}</span>`;
      }
      run = undefined;
    };
    for (const [x, cell] of row) {
      const [chars, width, , , attrs] = cell;
      const isCursor = showCursor && grid.cursor.y === y && grid.cursor.x === x;
      const style = cellStyle(cell, theme, isCursor);
      const text = attrs & Attr.invisible ? ' ' : chars;
      if (width === 1 && IN_RUN.test(text)) {
        if (run?.style !== style || run.x + run.width !== x) {
          flush();
          run = { x, width: 0, text: '', style };
        }
        run.text += text;
        run.width += 1;
        continue;
      }
      flush();
      run = { x, width, text, style: `${style}text-align:center;` };
      flush();
    }
    flush();
  }
  return html;
}

/** Terminal area in CSS pixels: the grid plus padding on every side. */
export function terminalSize(grid: Pick<Grid, 'cols' | 'rows'>, look: ResolvedTerminalOptions, metrics: CellMetrics) {
  return {
    width: grid.cols * metrics.cellWidth + 2 * look.padding,
    height: grid.rows * metrics.lineHeight + 2 * look.padding,
  };
}

/** The page shell: fonts and styles only. Screens are swapped into `#grid` without reloading the fonts. */
export function shellHtml(look: ResolvedTerminalOptions): string {
  const { theme, font, padding } = look;
  const lineHeight = Math.round(font.size * look.lineHeight);
  const family = `'${FONT_FAMILY}'${font.fallbackFile ? `,'${FALLBACK_FAMILY}'` : ''},monospace`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaceCss(look)}
html,body{margin:0;padding:0;background:${theme.background};overflow:hidden;}
#term{position:relative;box-sizing:border-box;padding:${String(padding)}px;background:${theme.background};}
#grid{position:relative;}
#term,#probe{font-family:${family};font-size:${String(font.size)}px;color:${theme.foreground};font-kerning:none;font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0;font-synthesis:none;}
#grid span{position:absolute;display:block;height:${String(lineHeight)}px;line-height:${String(lineHeight)}px;white-space:pre;overflow:hidden;letter-spacing:var(--ls,0px);}
#probe{position:absolute;left:0;top:0;visibility:hidden;white-space:pre;}
</style></head><body><div id="term"><div id="grid"></div></div><span id="probe">${'M'.repeat(100)}</span></body></html>`;
}

/** Cell size from the font: the bundled font's advance is known, a custom font's is measured once in the page. */
export function cellMetrics(look: ResolvedTerminalOptions, measuredAdvance: number): CellMetrics {
  const advance = fontFaces(look).bundled ? BUNDLED_ADVANCE * look.font.size : measuredAdvance;
  const cellWidth = Math.max(1, Math.round(advance));
  return {
    cellWidth,
    lineHeight: Math.max(1, Math.round(look.font.size * look.lineHeight)),
    // From the advance this Chromium really uses (Linux snaps it to whole pixels, Windows does not).
    letterSpacing: cellWidth - measuredAdvance,
  };
}

interface Prepared {
  look: string;
  metrics: CellMetrics;
}

const prepared = new WeakMap<Page, Prepared>();

async function prepare(page: Page, look: ResolvedTerminalOptions): Promise<CellMetrics> {
  const key = JSON.stringify(look);
  const cached = prepared.get(page);
  if (cached?.look === key) return cached.metrics;
  await page.setContent(shellHtml(look), { waitUntil: 'load' });
  const measured = await page.evaluate(async () => {
    // Load every face now: `fonts.ready` only covers faces in use, and bold text may show up in a later frame.
    await Promise.all([...document.fonts].map(face => face.load()));
    await document.fonts.ready;
    const probe = document.getElementById('probe');
    const width = probe?.getBoundingClientRect().width ?? 0;
    probe?.remove();
    return width / 100;
  });
  if (!(measured > 0)) throw new ShowcaseError('Could not measure the terminal font in the browser.');
  const metrics = cellMetrics(look, measured);
  prepared.set(page, { look: key, metrics });
  return metrics;
}

/**
 * Render a screen to a PNG of the terminal area (grid plus padding) at `deviceScaleFactor`.
 *
 * The page's browser context must have been created with that `deviceScaleFactor`, because Playwright cannot
 * change it per page; a mismatch throws a `ShowcaseError`. The page is taken over: its content and viewport are
 * set here. Later renders with the same look only swap the grid, so rendering clip frames stays cheap. A theme with
 * other than 16 ansi colors or a color that is not `#rrggbb` throws a `ShowcaseError` before the page is touched.
 */
export const renderTtyScreen: RenderTtyScreen = async (page, screen: TtyScreen, look, deviceScaleFactor) => {
  // A public entry point: theme colors go into the page's CSS, so a hand-built look is checked like a resolved one.
  checkTheme(look.theme);
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  if (ratio !== deviceScaleFactor) {
    throw new ShowcaseError(
      `renderTtyScreen: the page has a device pixel ratio of ${String(ratio)}, expected ${String(deviceScaleFactor)}. ` +
        'Create its browser context with the same deviceScaleFactor.',
    );
  }
  const grid = screen.grid as Grid;
  const metrics = await prepare(page, look);
  const size = terminalSize(grid, look, metrics);
  const viewport = page.viewportSize();
  if (viewport?.width !== size.width || viewport.height !== size.height) await page.setViewportSize(size);
  await page.evaluate(
    async ({ html, width, height, letterSpacing }) => {
      const term = document.getElementById('term');
      const target = document.getElementById('grid');
      if (!term || !target) throw new Error('terminal page is missing its grid');
      term.style.width = `${String(width)}px`;
      term.style.height = `${String(height)}px`;
      term.style.setProperty('--ls', `${String(letterSpacing)}px`);
      target.innerHTML = html;
      await document.fonts.ready;
    },
    { html: gridHtml(grid, look, metrics), ...size, letterSpacing: metrics.letterSpacing },
  );
  return page.screenshot({
    type: 'png',
    scale: 'device',
    animations: 'disabled',
    caret: 'hide',
    clip: { x: 0, y: 0, ...size },
  });
};
