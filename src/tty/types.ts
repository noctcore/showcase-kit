import type { Page } from 'playwright';

/**
 * Contract between the terminal engine (`src/tty/*`), the capture wiring (`src/capture*`) and the clip recorder.
 * The engine implements it; everything else only depends on these types.
 */

/** Keys to send. Plain text is typed as is; names in braces are keys: `{Enter}`, `{Down}`, `{Tab}`, `{Esc}`, `{C-c}`. */
export type Keys = string | string[];

/** A 16 color ANSI palette plus the default colors. */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor?: string;
  /** Exactly 16 colors: the 8 normal ANSI colors, then the 8 bright ones. */
  ansi: string[];
}

/** How the terminal looks when rendered. Every field is optional in config. */
export interface TerminalOptions {
  theme?: 'dark' | 'light' | TerminalTheme;
  font?: {
    /** Font files (woff2, woff or ttf). Defaults to the bundled JetBrains Mono. */
    file?: string;
    boldFile?: string;
    italicFile?: string;
    boldItalicFile?: string;
    /** Extra font tried for glyphs the main font lacks, for example a symbols or Nerd Font. */
    fallbackFile?: string;
    /** CSS pixels. Default 15. */
    size?: number;
  };
  /** Line height as a multiple of the font size, rounded to whole pixels. Default 1.32. */
  lineHeight?: number;
  /** CSS pixels between the grid and the edge of the capture. Default 12. */
  padding?: number;
  /** Default 'hide'. A shown cursor never blinks. */
  cursor?: 'hide' | 'show';
}

/** `TerminalOptions` with every default filled in and every file path absolute. */
export interface ResolvedTerminalOptions {
  theme: TerminalTheme;
  font: {
    file?: string;
    boldFile?: string;
    italicFile?: string;
    boldItalicFile?: string;
    fallbackFile?: string;
    size: number;
  };
  lineHeight: number;
  padding: number;
  cursor: 'hide' | 'show';
}

/** How to start the app under a pseudo terminal. */
export interface TtySessionOptions {
  /** A string runs through the shell, like `target.start`; an array is spawned directly. */
  command: string | [file: string, ...args: string[]];
  /** Absolute working directory. */
  cwd: string;
  /** Extra environment, merged over the deterministic defaults (TERM, COLORTERM, FORCE_COLOR, TZ, LANG). */
  env: Record<string, string>;
  /**
   * Which variables of the kit's own environment the app inherits. `true` (default): all but CI and terminal hints.
   * `false` or `[]`: only the few the platform needs to start a program. An array of names: those as well.
   */
  inheritEnv?: boolean | string[];
  cols: number;
  rows: number;
}

/** An immutable copy of the visible screen, cheap to take and to compare. */
export interface TtyScreen {
  cols: number;
  rows: number;
  /** Plain text of the visible rows, joined with `\n`, trailing spaces trimmed per row. */
  text: string;
  /** Stable key: two screens with equal keys render to identical pixels. Used to merge identical clip frames. */
  key: string;
  /** Styled cells and cursor state. Engine-private: only `RenderTtyScreen` reads it. */
  readonly grid: unknown;
}

/** A running app in a pseudo terminal. */
export interface TtySession {
  readonly pid: number;
  press(keys: Keys): Promise<void>;
  type(text: string, opts?: { delayMs?: number }): Promise<void>;
  /** Resolves once the visible screen contains `pattern`; rejects with a `ShowcaseError` after `timeoutMs`. */
  waitForText(pattern: string | RegExp, opts?: { timeoutMs?: number }): Promise<void>;
  screenText(): string;
  screen(): TtyScreen;
  resize(cols: number, rows: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Send `quitKey` (unless false), wait briefly, then kill the whole process tree. Safe to call twice. */
  close(opts?: { quitKey?: string | false }): Promise<void>;
  /** Resolves with the exit code when the app exits on its own. */
  readonly exited: Promise<number | null>;
}

/** Starts a session. Implemented by the engine; lazily loads the PTY package with a friendly install error. */
export type OpenTtySession = (opts: TtySessionOptions) => Promise<TtySession>;

/**
 * Renders a screen to a PNG in an existing Chromium page (the kit's browser), at `deviceScaleFactor`.
 * The PNG is the terminal area: grid plus padding on the theme background, ready for `frame`, `portfolio` and `hero`.
 */
export type RenderTtyScreen = (
  page: Page,
  screen: TtyScreen,
  look: ResolvedTerminalOptions,
  deviceScaleFactor: number,
) => Promise<Buffer>;
