import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Terminal } from '@xterm/headless';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShowcaseError } from '../src/errors.js';
import { cellColors, cellMetrics, gridHtml, renderTtyScreen, shellHtml } from '../src/tty/render.js';
import { openTtySession, snapshot, TRUECOLOR, type Grid, type GridCell } from '../src/tty/session.js';
import { BUNDLED_FONTS, bundledFontDir, DARK_THEME, LIGHT_THEME, resolveTerminalOptions } from '../src/tty/theme.js';
import type { ResolvedTerminalOptions, TtyScreen } from '../src/tty/types.js';
import { FIXTURES, tempDir } from './helpers.js';

async function screenOf(cols: number, rows: number, data: string, cursorVisible = false): Promise<TtyScreen> {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  await new Promise<void>(done => term.write(data, done));
  const screen = snapshot(term, cursorVisible);
  term.dispose();
  return screen;
}

const look = (overrides: Parameters<typeof resolveTerminalOptions>[0] = {}): ResolvedTerminalOptions =>
  resolveTerminalOptions(overrides, process.cwd());

/** Spans of the generated HTML as numbers, in document order. */
function spans(html: string): Array<{ left: number; top: number; width: number; text: string }> {
  return [...html.matchAll(/<span style="left:(\d+)px;top:(\d+)px;width:(\d+)px;[^"]*">([^<]*)<\/span>/g)].map(m => ({
    left: Number(m[1]),
    top: Number(m[2]),
    width: Number(m[3]),
    text: m[4] ?? '',
  }));
}

describe('cellColors', () => {
  const theme = DARK_THEME;
  const cell = (fg: number, bg: number, attrs = 0): GridCell => ['x', 1, fg, bg, attrs];

  it('resolves default, 16, 256 and truecolor colors', () => {
    expect(cellColors(cell(-1, -1), theme)).toEqual({ fg: theme.foreground, bg: undefined });
    expect(cellColors(cell(1, 4), theme)).toEqual({ fg: theme.ansi[1], bg: theme.ansi[4] });
    expect(cellColors(cell(196, 21), theme)).toEqual({ fg: '#ff0000', bg: '#0000ff' });
    expect(cellColors(cell(232, 255), theme)).toEqual({ fg: '#080808', bg: '#eeeeee' });
    expect(cellColors(cell(TRUECOLOR + 0x12ab34, TRUECOLOR), theme)).toEqual({ fg: '#12ab34', bg: '#000000' });
  });

  it('brightens bold basic colors only', () => {
    expect(cellColors(cell(2, -1, 1), theme).fg).toBe(theme.ansi[10]);
    expect(cellColors(cell(10, -1, 1), theme).fg).toBe(theme.ansi[10]);
    expect(cellColors(cell(100, -1, 1), theme).fg).toBe(cellColors(cell(100, -1), theme).fg);
  });

  it('swaps colors for inverse, dims toward the background, and draws the cursor as a block', () => {
    expect(cellColors(cell(-1, -1, 16), theme)).toEqual({ fg: theme.background, bg: theme.foreground });
    expect(cellColors(cell(TRUECOLOR + 0xffffff, TRUECOLOR, 4), theme).fg).toBe('#808080');
    expect(cellColors(cell(-1, 3), theme, true)).toEqual({ fg: theme.ansi[3], bg: theme.cursor });
  });
});

describe('gridHtml', () => {
  const metrics = { cellWidth: 8, lineHeight: 18, letterSpacing: -0.4 };

  it('places every span at whole pixels from its column, however many runs a row has', async () => {
    // 36 runs of two cells in alternating colors, then a border.
    const runs = Array.from({ length: 36 }, (_, i) => `\x1b[3${String(1 + (i % 2))}mab`).join('');
    const screen = await screenOf(80, 2, `${runs}\x1b[0m|\r\n${'a'.repeat(72)}|`);
    const out = spans(gridHtml(screen.grid as Grid, look(), metrics));
    const row0 = out.filter(s => s.top === 0);
    expect(row0).toHaveLength(37);
    row0.forEach((span, i) => {
      expect(span.left).toBe(i * 16);
      expect(span.width).toBe(i < 36 ? 16 : 8);
    });
    expect(out.find(s => s.top === 18 && s.text.endsWith('|'))).toMatchObject({ left: 0, width: 73 * 8 });
  });

  it('gives glyphs outside printable ASCII their own clipped cell, and wide chars two', async () => {
    const screen = await screenOf(20, 1, '✔ab日x─');
    const out = spans(gridHtml(screen.grid as Grid, look(), metrics));
    expect(out).toEqual([
      { left: 0, top: 0, width: 8, text: '✔' },
      { left: 8, top: 0, width: 16, text: 'ab' },
      { left: 24, top: 0, width: 16, text: '日' },
      { left: 40, top: 0, width: 8, text: 'x' },
      { left: 48, top: 0, width: 8, text: '─' },
    ]);
    expect(gridHtml(screen.grid as Grid, look(), metrics)).toMatch(/text-align:center;">✔/);
  });

  it('hides invisible text, escapes HTML and draws styles', async () => {
    const screen = await screenOf(30, 1, '\x1b[8msecret\x1b[0m<&>\x1b[1;3;4;9mS');
    const html = gridHtml(screen.grid as Grid, look(), metrics);
    expect(html).not.toContain('secret');
    expect(html).toContain('&#60;&#38;&#62;');
    expect(html).toMatch(/font-weight:700;font-style:italic;text-decoration:underline line-through;">S/);
  });

  it('draws the cursor only when the look shows it and the app has not hidden it', async () => {
    const visible = (await screenOf(10, 1, 'ab', true)).grid as Grid;
    const hidden = (await screenOf(10, 1, 'ab', false)).grid as Grid;
    const cursorCell = `background:${String(DARK_THEME.cursor)}`;
    expect(gridHtml(visible, look({ cursor: 'show' }), metrics)).toContain(cursorCell);
    expect(gridHtml(visible, look(), metrics)).not.toContain(cursorCell);
    expect(gridHtml(hidden, look({ cursor: 'show' }), metrics)).not.toContain(cursorCell);
  });
});

describe('resolveTerminalOptions', () => {
  it('fills in the defaults', () => {
    expect(resolveTerminalOptions(undefined, '/base')).toEqual({
      theme: DARK_THEME,
      font: { size: 15 },
      lineHeight: 1.32,
      padding: 12,
      cursor: 'hide',
    });
    expect(resolveTerminalOptions({ theme: 'light', padding: 0 }, '/base')).toMatchObject({ theme: LIGHT_THEME, padding: 0 });
  });

  it('resolves font files against the base folder and rejects missing ones', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'mono.ttf'), '');
    expect(resolveTerminalOptions({ font: { file: 'mono.ttf', size: 14 } }, dir).font).toEqual({
      file: join(dir, 'mono.ttf'),
      size: 14,
    });
    expect(() => resolveTerminalOptions({ font: { boldFile: 'nope.ttf' } }, dir)).toThrow(/font.boldFile does not exist/);
  });

  it('rejects themes and sizes the renderer cannot draw', () => {
    const theme = { ...DARK_THEME, ansi: DARK_THEME.ansi.slice(1) };
    expect(() => resolveTerminalOptions({ theme }, '/')).toThrow(/exactly 16 colors, got 15/);
    expect(() => resolveTerminalOptions({ theme: { ...DARK_THEME, background: 'red' } }, '/')).toThrow(/#rrggbb, got red/);
    expect(() => resolveTerminalOptions({ font: { size: 0 } }, '/')).toThrow(ShowcaseError);
    expect(() => resolveTerminalOptions({ lineHeight: -1 }, '/')).toThrow(ShowcaseError);
    expect(() => resolveTerminalOptions({ padding: -1 }, '/')).toThrow(ShowcaseError);
  });
});

describe('fonts', () => {
  it('bundles JetBrains Mono with its license', () => {
    for (const file of [...Object.values(BUNDLED_FONTS), 'OFL.txt']) expect(existsSync(join(bundledFontDir(), file))).toBe(true);
  });

  it('ships them in dist next to the chunks', () => {
    for (const file of [...Object.values(BUNDLED_FONTS), 'OFL.txt']) {
      expect(existsSync(join(process.cwd(), 'dist', 'fonts', file))).toBe(true);
    }
  });

  it('inlines every face as a data URL', () => {
    const html = shellHtml(look());
    expect(html.match(/src:url\(data:font\/woff2;base64,/g)).toHaveLength(4);
    expect(html).not.toMatch(/https?:/);
  });

  it('uses the bundled advance for the cell width and corrects the letter spacing from the measured one', () => {
    const size14 = cellMetrics(look({ font: { size: 14 } }), 8.4);
    expect(size14).toMatchObject({ cellWidth: 8, lineHeight: 18 });
    expect(size14.letterSpacing).toBeCloseTo(-0.4, 9);
    expect(cellMetrics(look({ font: { size: 14 } }), 8)).toMatchObject({ cellWidth: 8, letterSpacing: 0 });
    expect(cellMetrics(look({ font: { size: 15 } }), 9)).toEqual({ cellWidth: 9, lineHeight: 20, letterSpacing: 0 });
  });
});

describe('renderTtyScreen', () => {
  let browser: Browser;
  const pages = new Map<number, Page>();

  async function page(dpr: number): Promise<Page> {
    let found = pages.get(dpr);
    if (!found) {
      const context = await browser.newContext({ deviceScaleFactor: dpr });
      found = await context.newPage();
      pages.set(dpr, found);
    }
    return found;
  }

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  const size = async (png: Buffer) => {
    const { width, height } = await sharp(png).metadata();
    return { width, height };
  };

  /** The raw pixels of one cell. */
  const cellPixels = (png: Buffer, x: number, y: number, m: { cw: number; lh: number; pad: number; dpr: number }) =>
    sharp(png)
      .extract({ left: (m.pad + x * m.cw) * m.dpr, top: (m.pad + y * m.lh) * m.dpr, width: m.cw * m.dpr, height: m.lh * m.dpr })
      .raw()
      .toBuffer();

  it('sizes the PNG from cols, rows, font size, line height, padding and DPR', async () => {
    const screen = await screenOf(120, 32, 'hello');
    expect(await size(await renderTtyScreen(await page(2), screen, look(), 2))).toEqual({
      width: (120 * 9 + 24) * 2,
      height: (32 * 20 + 24) * 2,
    });
    const small = await screenOf(40, 10, 'hello');
    const custom = look({ font: { size: 14 }, lineHeight: 1.5, padding: 0 });
    expect(await size(await renderTtyScreen(await page(1), small, custom, 1))).toEqual({ width: 40 * 8, height: 10 * 21 });
    // Wider than the default viewport: the page is sized to the terminal.
    const wide = await screenOf(220, 60, 'wide');
    expect(await size(await renderTtyScreen(await page(1), wide, look(), 1))).toEqual({ width: 220 * 9 + 24, height: 60 * 20 + 24 });
  });

  it('renders the same screen to the same bytes, on a fresh page and after other screens', async () => {
    const a = await screenOf(60, 8, '\x1b[1;31mbold red\x1b[0m ┌──┐ 日本 ✔ \x1b[38;5;208m256\x1b[38;2;1;2;3m rgb');
    const b = await screenOf(60, 8, 'another screen');
    const first = await renderTtyScreen(await page(2), a, look({ theme: 'light' }), 2);
    const again = await renderTtyScreen(await page(2), a, look({ theme: 'light' }), 2);
    await renderTtyScreen(await page(2), b, look({ theme: 'light' }), 2);
    const afterOther = await renderTtyScreen(await page(2), a, look({ theme: 'light' }), 2);
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const fresh = await renderTtyScreen(await context.newPage(), a, look({ theme: 'light' }), 2);
    await context.close();
    expect(again.equals(first)).toBe(true);
    expect(afterOther.equals(first)).toBe(true);
    expect(fresh.equals(first)).toBe(true);
    expect((await renderTtyScreen(await page(2), b, look({ theme: 'light' }), 2)).equals(first)).toBe(false);
  });

  it('keeps a border in place after many style runs (no sub-pixel drift)', async () => {
    // Size 14: JetBrains Mono advances 8.4px, the cell is 8px wide.
    const m = { cw: 8, lh: 18, pad: 12, dpr: 2 };
    const runs = Array.from({ length: 36 }, (_, i) => `\x1b[3${String(1 + (i % 2))}mab`).join('');
    const screen = await screenOf(80, 2, `${runs}\x1b[0m|\r\n${'a'.repeat(72)}|`);
    const png = await renderTtyScreen(await page(2), screen, look({ font: { size: 14 } }), 2);
    expect((await cellPixels(png, 72, 0, m)).equals(await cellPixels(png, 72, 1, m))).toBe(true);
  });

  it('keeps the row in place after a glyph the font lacks (no fallback shift)', async () => {
    const m = { cw: 9, lh: 20, pad: 12, dpr: 2 };
    const screen = await screenOf(40, 2, `${'✔'.repeat(10)}|\r\n${'x'.repeat(10)}|`);
    const png = await renderTtyScreen(await page(2), screen, look(), 2);
    expect((await cellPixels(png, 10, 0, m)).equals(await cellPixels(png, 10, 1, m))).toBe(true);
  });

  it('draws the cursor block in the cursor color when shown', async () => {
    const m = { cw: 9, lh: 20, pad: 12, dpr: 1 };
    const screen = await screenOf(10, 2, 'ab', true);
    const shown = await renderTtyScreen(await page(1), screen, look({ cursor: 'show' }), 1);
    const hidden = await renderTtyScreen(await page(1), screen, look(), 1);
    const corner = async (png: Buffer) => [...(await cellPixels(png, 2, 0, m)).subarray(0, 3)];
    expect(await corner(shown)).toEqual([0xc0, 0xca, 0xf5]);
    expect(await corner(hidden)).toEqual([0x1a, 0x1b, 0x26]);
  });

  it('never touches the network', async () => {
    const target = await page(1);
    const requests: string[] = [];
    await target.route('**/*', route => {
      requests.push(route.request().url());
      return route.abort();
    });
    await renderTtyScreen(target, await screenOf(20, 2, 'offline'), look({ theme: 'light', padding: 4 }), 1);
    await target.unrouteAll();
    expect(requests).toEqual([]);
  });

  it('refuses a page whose device pixel ratio differs', async () => {
    const error = await renderTtyScreen(await page(1), await screenOf(10, 2, 'x'), look(), 2).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(/device pixel ratio of 1, expected 2/);
  });

  it('renders a live session', async () => {
    const tty = await openTtySession({ command: [process.execPath, join(FIXTURES, 'tui.mjs')], cwd: FIXTURES, env: {}, cols: 100, rows: 30 });
    try {
      await tty.waitForText('fixture-tui · services');
      const png = await renderTtyScreen(await page(2), tty.screen(), look(), 2);
      expect(await size(png)).toEqual({ width: (100 * 9 + 24) * 2, height: (30 * 20 + 24) * 2 });
      expect((await sharp(png).stats()).isOpaque).toBe(true);
    } finally {
      await tty.close();
    }
  });
});
