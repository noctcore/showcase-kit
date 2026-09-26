import type { BrowserContext, Page } from 'playwright';
import type { Keys, ResolvedTerminalOptions, TerminalOptions, TtySession } from '../tty/types.js';

/** Navigate to a shot: click a selector, visit a path or URL, or run your own steps. */
export type NavFn = (page: Page) => Promise<void> | void;

/**
 * How to reach a shot.
 *
 * - A string starting with `/` (but not `//`) or `http(s)://` is visited as a URL. In url mode a path resolves under
 *   the target URL's path (`/docs/` with `https://x.io/app/` visits `https://x.io/app/docs/`); in cdp mode it
 *   resolves against the captured page's origin.
 * - Any other string is a selector to click.
 * - `{ click }` and `{ goto }` say which one explicitly.
 * - A function receives the page and does whatever it needs.
 */
export type Nav =
  /** A selector to click, or a path or URL to visit, told apart as above. */
  | string
  /** A selector to click. */
  | { click: string }
  /** A path or URL to visit. */
  | { goto: string }
  /** Your own steps with the page. */
  | NavFn;

/** A view to capture in url or cdp mode. */
export interface Shot {
  /** File name stem and `{id}` token. Letters, digits, `-` and `_`. */
  id: string;
  /**
   * Human name, used in frame titles and gallery alt text.
   * @default the shot's `id`
   */
  title?: string;
  /**
   * Caption under the image in the README table and the portfolio gallery.
   * @default the shot's `title`
   */
  caption?: string;
  /**
   * Alt text.
   * @default the app name and the title, as `<name>: <title>`
   */
  alt?: string;
  /** How to reach the view: a selector to click, a path or URL to visit, `{ click }`, `{ goto }` or your own steps. */
  nav?: Nav;
  /** Selector to wait for, until it is visible, after navigating. */
  waitFor?: string;
  /**
   * Extra settle time after navigating, in milliseconds.
   * @default `0`
   */
  delayMs?: number;
}

/** Your own steps in tty mode: press keys, type, wait for text. */
export type TtyNavFn = (tty: TtySession) => Promise<void> | void;

/** A shot in tty mode. Shots run in order in one app process per language, so each starts where the last ended. */
export interface TtyShot {
  /** File name stem and `{id}` token. Letters, digits, `-` and `_`. */
  id: string;
  /**
   * Human name, used in frame titles and gallery alt text.
   * @default the shot's `id`
   */
  title?: string;
  /**
   * Caption under the image in the README table and the portfolio gallery.
   * @default the shot's `title`
   */
  caption?: string;
  /**
   * Alt text.
   * @default the app name and the title, as `<name>: <title>`
   */
  alt?: string;
  /** Keys to press: plain text is typed, names in braces are keys (`{Tab}`, `{Down}`, `{Enter}`, `{C-c}`). */
  keys?: Keys;
  /** Or your own steps with the session. Use `keys` or `nav`, not both. */
  nav?: TtyNavFn;
  /** Text on screen to wait for after the keys: a substring or a RegExp. */
  waitFor?: string | RegExp;
  /**
   * Extra settle time after `waitFor`, in milliseconds.
   * @default `0`
   */
  delayMs?: number;
  /**
   * Start a fresh app process (and run `setup` again) before this shot.
   * @default `false`
   */
  restart?: boolean;
}

/** One step of a clip's timeline. Steps run on the clip's frame clock, so a key's effect shows from the next frame. */
export type ClipStep =
  /** Keys to press, like a shot's `keys`. */
  | { keys: Keys }
  /** Text typed literally (no `{Key}` names), all at once or one character every `delayMs`. */
  | { type: string; delayMs?: number }
  /** Wait until this text is on screen (a substring or a RegExp), bounded by `timeouts.shotMs`. */
  | { waitFor: string | RegExp }
  /** Pause, in milliseconds, rounded to whole frames. */
  | { sleep: number };

/** A clip file format. */
export type ClipFormat = 'webp' | 'gif' | 'mp4';

/** A short animated recording of a terminal app, written by `showcase record`. Each clip starts a fresh app. */
export interface Clip {
  /** File name stem and `{id}` token. Letters, digits, `-` and `_`; must not repeat a shot id. */
  id: string;
  /**
   * Human name, used in the frame title.
   * @default the clip's `id`
   */
  title?: string;
  /**
   * Caption under the clip in the README table.
   * @default the clip's `title`
   */
  caption?: string;
  /**
   * Alt text.
   * @default the app name and the title, as `<name>: <title>`
   */
  alt?: string;
  /** The timeline, run once the app is ready and `setup` has run. */
  steps: ClipStep[];
  /**
   * Frames per second, 1 to 50.
   * @default `10`
   */
  fps?: number;
  /**
   * Upper bound on the clip length in milliseconds.
   * @default `60000`
   */
  durationMs?: number;
  /**
   * Upper bound on the frames, counted after unchanged frames merge (like `RecordedClip.frames`). Each distinct frame
   * stays in memory until the clip is encoded. When a recording reaches it, the kit warns, stops recording and
   * writes the frames so far.
   * @default `300`
   */
  maxFrames?: number;
  /**
   * How long to keep recording after the last step, in milliseconds.
   * @default `1500`
   */
  tailMs?: number;
  /**
   * Formats to write. `'mp4'` needs `ffmpeg` on PATH.
   * @default `['webp', 'gif']`
   */
  formats?: ClipFormat[];
}

/** A web app the kit opens in its own headless Chromium, starting it first if needed. */
export interface UrlTarget {
  /** Capture the app in the kit's own headless Chromium. */
  mode: 'url';
  /** The app's URL. `nav` paths that start with `/` resolve under its path: it is the app's base directory. */
  url: string;
  /** Shell command that starts the app (for example `pnpm dev:web`). Omit if it is already running. */
  start?: string;
  /**
   * Working directory for `start`, relative to the config root.
   * @default the config root
   */
  cwd?: string;
  /** Extra environment for `start`. */
  env?: Record<string, string>;
  /**
   * How long to wait for `url` to answer after `start`, in milliseconds.
   * @default `60000`
   */
  readyTimeoutMs?: number;
  /**
   * Use an app that already answers on `url` instead of starting a second copy.
   * @default `true`
   */
  reuseExisting?: boolean;
}

/** A running Chromium based app the kit attaches to over the DevTools Protocol. */
export interface CdpTarget {
  /** Attach to a running Chromium based app (Electron, or WebView2 on Windows) over the DevTools Protocol. */
  mode: 'cdp';
  /**
   * The app's remote debugging endpoint.
   * @default `'http://127.0.0.1:9222'`
   */
  cdpUrl?: string;
  /**
   * Picks the page to capture: a substring of its URL, or a RegExp.
   * @default the first page that is not a devtools page
   */
  pageMatch?: string | RegExp;
  /** Shell command that launches the app with remote debugging on. Omit if it is already running. */
  start?: string;
  /**
   * Working directory for `start`, relative to the config root.
   * @default the config root
   */
  cwd?: string;
  /** Extra environment for `start`. */
  env?: Record<string, string>;
  /**
   * How long to wait for the CDP endpoint to answer after `start`, in milliseconds.
   * @default `60000`
   */
  readyTimeoutMs?: number;
}

/** Runs a terminal app in a pseudo terminal and captures its screen. Needs `@lydell/node-pty` (or `node-pty`). */
export interface TtyTarget {
  /** Run a terminal app in a pseudo terminal. */
  mode: 'tty';
  /** Command to run: a string goes through the shell like `start`; an array `[file, ...args]` is spawned directly. */
  command: string | [file: string, ...args: string[]];
  /**
   * Working directory, relative to the config root.
   * @default the config root
   */
  cwd?: string;
  /** Extra environment. A function gets the language, for apps that take their locale from an env var. */
  env?: Record<string, string> | ((ctx: { lang: string }) => Record<string, string>);
  /**
   * Which of your environment variables the app inherits. `true`: all but CI and terminal hints. `false` or `[]`:
   * only what the platform needs to start a program (PATH; on Windows also PATHEXT, SystemRoot, ComSpec). An array
   * of names: those as well.
   * @default `true`
   */
  inheritEnv?: boolean | string[];
  /**
   * Terminal width in columns, 10 to 500.
   * @default `120`
   */
  cols?: number;
  /**
   * Terminal height in rows, 5 to 200.
   * @default `32`
   */
  rows?: number;
  /**
   * Key sent to quit before the process tree is killed, parsed like `keys`. `false` just kills.
   * @default `'q'`
   */
  quitKey?: string | false;
  /**
   * Grace after `ready` and `setup` before the first key, for apps that enter raw mode after drawing, in
   * milliseconds.
   * @default `300`
   */
  inputDelayMs?: number;
  /**
   * How long to wait for the `ready` text, in milliseconds.
   * @default `30000`
   */
  readyTimeoutMs?: number;
}

/** How to reach the app, told apart by `mode`. */
export type Target = UrlTarget | CdpTarget | TtyTarget;
/** The targets captured in a browser page. */
export type WebTarget = UrlTarget | CdpTarget;
/** The target modes: `'url'`, `'cdp'` or `'tty'`. */
export type Mode = Target['mode'];

/** What `setup` receives in url and cdp mode. */
export interface SetupContext {
  page: Page;
  context: BrowserContext;
  lang: string;
  mode: WebTarget['mode'];
  config: ResolvedWebConfig;
}

/** What `setup` receives in tty mode. */
export interface TtySetupContext {
  tty: TtySession;
  lang: string;
  mode: 'tty';
  config: ResolvedTtyConfig;
}

/** What a frame or the hero sits on. */
export type Background =
  /** A CSS color, the same as `{ type: 'solid', color }`. */
  | string
  /** One CSS color. */
  | { type: 'solid'; color: string }
  /** A linear gradient between two CSS colors. */
  | {
      type: 'gradient';
      from: string;
      to: string;
      /**
       * Angle in degrees, -360 to 360.
       * @default `135`
       */
      angle?: number;
    }
  /** No background: the space around the window stays transparent. */
  | { type: 'transparent' };

/** The window chrome around a capture. */
export type FrameStyle = 'window' | 'minimal' | 'none';

/** How a capture is framed for the README, the portfolio, the hero and clips. */
export interface FrameOptions {
  /**
   * `window`: title bar with traffic lights. `minimal`: thin bar. `none`: just the rounded screenshot.
   * @default `'window'`
   */
  style?: FrameStyle;
  /**
   * Title bar colors.
   * @default `'dark'`
   */
  theme?: 'light' | 'dark';
  /**
   * Title bar text. Tokens: `{name}`, `{title}`, `{id}`, `{lang}`. `false` hides it.
   * @default `'{name}'`
   */
  title?: string | false;
  /**
   * What the window sits on.
   * @default `{ type: 'gradient', from: '#0f766e', to: '#1e1b4b', angle: 135 }`
   */
  background?: Background;
  /**
   * Space around the window, in CSS pixels.
   * @default `72`
   */
  padding?: number;
  /**
   * Window corner radius, in CSS pixels.
   * @default `14`
   */
  radius?: number;
  /**
   * Soft drop shadow under the window.
   * @default `true`
   */
  shadow?: boolean;
  /**
   * WebP quality, 1 to 100.
   * @default `90`
   */
  quality?: number;
  /** Downscale README images wider than this many pixels. */
  maxWidth?: number;
}

/** Fixed-size images for a portfolio site, a thumbnail and a gallery JSON. */
export interface PortfolioOutput {
  /** Output directory. Token: `{slug}`. */
  dir: string;
  /**
   * Exact output size in pixels, 16 to 8192 a side.
   * @default `[1920, 1080]`
   */
  size?: [number, number];
  /**
   * Image format.
   * @default `'webp'`
   */
  format?: 'webp' | 'png';
  /**
   * WebP quality, 1 to 100.
   * @default `90`
   */
  quality?: number;
  /**
   * Shot id copied to `thumbnail.<format>`.
   * @default the first shot
   */
  thumbnail?: string;
  /**
   * Which language to export.
   * @default the first of `langs`
   */
  lang?: string;
  /**
   * URL prefix used for `src` in `showcase.gallery.json`. Token: `{slug}`.
   * @default `'/projects/{slug}'`
   */
  publicPath?: string;
  /**
   * Minimum space around the window, in output pixels.
   * @default `96`
   */
  padding?: number;
  /**
   * Where to write the gallery JSON, relative to the config root (token `{slug}`, must end in `.json`), or `false`
   * to skip it.
   * @default `showcase.gallery.json` in `dir`
   */
  gallery?: string | false;
}

/** Where each kind of file is written, relative to the config root. */
export interface Outputs {
  /**
   * Raw capture path (PNG). Tokens: `{lang}`, `{id}`, `{slug}`.
   * @default `'showcase-out/raw/{lang}/{id}.png'`
   */
  raw?: string;
  /**
   * Framed README image path (`.webp` or `.png`). Tokens: `{lang}`, `{id}`, `{slug}`. `false` skips the README
   * images, for configs that only export a portfolio (which renders from the raw captures).
   * @default `'assets/showcase/{lang}/{id}.webp'`
   */
  readme?: string | false;
  /** Portfolio export: fixed-size images, a thumbnail and a gallery JSON. Off unless set. */
  portfolio?: PortfolioOutput;
  /**
   * Clip path, ending in `.{ext}`. Tokens: `{lang}`, `{id}`, `{slug}`, `{ext}`.
   * @default `'assets/showcase/{lang}/{id}.{ext}'`
   */
  clips?: string;
}

/** The README banner that `showcase hero` renders. */
export interface HeroOptions {
  /** Line under the name. */
  tagline?: string;
  /** Logo image (PNG, SVG, WebP or JPEG), relative to the config root. */
  logo?: string;
  /**
   * One to three shot ids to stack, back to front.
   * @default the first three shots
   */
  shots?: string[];
  /**
   * Which language's captures to use.
   * @default the first of `langs`
   */
  lang?: string;
  /**
   * Output path (`.webp` or `.png`). Tokens: `{lang}`, `{slug}`.
   * @default `'assets/showcase/hero.webp'`
   */
  output?: string;
  /**
   * Exact output size in pixels, 320 to 8192 a side. The default is the GitHub social preview size.
   * @default `[1280, 640]`
   */
  size?: [number, number];
  /**
   * What the banner sits on, in the same forms as `frame.background`.
   * @default the frame's `background`
   */
  background?: Background;
  /**
   * Text color scheme: `'dark'` draws light text, `'light'` dark text.
   * @default the frame's `theme`
   */
  theme?: 'light' | 'dark';
  /**
   * WebP quality, 1 to 100.
   * @default `90`
   */
  quality?: number;
}

/** Which Chromium the kit launches, and how. */
export interface BrowserOptions {
  /** A Playwright channel such as `chrome` or `msedge`, to use an installed browser instead of a downloaded one. */
  channel?: string;
  /** Path to a Chromium based browser to launch instead of the downloaded Chromium. */
  executablePath?: string;
  /**
   * Run the browser without a window.
   * @default `true`
   */
  headless?: boolean;
  /** Extra command line arguments for the browser. */
  args?: string[];
}

/** How long to wait, in milliseconds. */
export interface Timeouts {
  /**
   * Wait for the `ready` selector, in milliseconds. Not used in tty mode (see `target.readyTimeoutMs`).
   * @default `30000`
   */
  readyMs?: number;
  /**
   * Navigation and `waitFor` per shot, in milliseconds. In tty mode it bounds each `waitFor` and clip `waitFor` step.
   * @default `15000`
   */
  shotMs?: number;
  /**
   * Best-effort network idle wait, in milliseconds; a busy dev server only costs this much. Not used in tty mode.
   * @default `3000`
   */
  networkIdleMs?: number;
}

/** Settings shared by every mode. */
export interface CommonConfig {
  /** App name, used in frame titles and alt text. */
  name: string;
  /**
   * Used for the `{slug}` token. Letters, digits, `-` and `_`.
   * @default the `name`, lowercased, with dashes for everything else
   */
  slug?: string;
  /**
   * Base directory for relative paths, itself relative to the config file's directory.
   * @default the config file's directory
   */
  root?: string;
  /**
   * Device pixels per CSS pixel, 0.25 to 4: every image is this many times its CSS pixel size.
   * @default `2`
   */
  deviceScaleFactor?: number;
  /**
   * Languages to capture, in order. Each gets its own `setup` run.
   * @default `['en']`
   */
  langs?: string[];
  /** The window frame around the README images. Portfolio images, the hero and clips use the same look. */
  frame?: FrameOptions;
  /** Where the files go. */
  outputs?: Outputs;
  /** Banner image for the top of a README: logo, name, tagline and a stack of framed shots. */
  hero?: HeroOptions;
  /** The Chromium that captures web apps, renders terminal screens and draws frames. */
  browser?: BrowserOptions;
  /** How long to wait for the app and for each shot. */
  timeouts?: Timeouts;
}

/** A web app captured in a browser page: `mode: 'url'` or `mode: 'cdp'`. */
export interface WebConfig extends CommonConfig {
  /** How to reach the app: `mode: 'url'` or `mode: 'cdp'`. */
  target: WebTarget;
  /** Selector that exists once the app has booted. */
  ready?: string;
  /**
   * CSS pixel size of every capture.
   * @default `{ width: 1440, height: 900 }`
   */
  viewport?: {
    /** Width in CSS pixels, 16 to 8192. */
    width: number;
    /** Height in CSS pixels, 16 to 8192. */
    height: number;
  };
  /**
   * The `prefers-color-scheme` the page sees.
   * @default `'dark'`
   */
  colorScheme?: 'light' | 'dark' | 'no-preference';
  /** Extra CSS injected before each shot, for example to hide dev overlays. */
  css?: string;
  /** Runs once per language after the app is ready: seed fixtures, switch locale, dismiss dialogs. */
  setup?: (ctx: SetupContext) => Promise<void> | void;
  /** The views to capture, in order. */
  shots: Shot[];
}

/** A terminal app captured from a pseudo terminal: `mode: 'tty'`. */
export interface TtyConfig extends CommonConfig {
  /** How to run the app: `mode: 'tty'`. */
  target: TtyTarget;
  /** Text on screen once the app has drawn: a substring or a RegExp. */
  ready?: string | RegExp;
  /** How the terminal looks: theme, font, line height, padding, cursor. */
  terminal?: TerminalOptions;
  /** Runs in each new app process once it is ready, before its first shot or clip. */
  setup?: (ctx: TtySetupContext) => Promise<void> | void;
  /** The screens to capture, in order, in one app process per language. */
  shots: TtyShot[];
  /** Animated recordings, written by `showcase record` (and `showcase all`). */
  clips?: Clip[];
}

/**
 * The config a `showcase.config.*` file exports. Without a type argument it is the web config, as before tty mode;
 * `defineConfig` picks the right one from `target.mode`.
 */
export type ShowcaseConfig<M extends Mode = WebTarget['mode']> = M extends 'tty' ? TtyConfig : WebConfig;

/** A web shot with its defaults filled in. */
export interface ResolvedWebShot extends Shot {
  title: string;
  alt: string;
  delayMs: number;
}

/** A tty shot with its defaults filled in. */
export interface ResolvedTtyShot extends TtyShot {
  title: string;
  alt: string;
  delayMs: number;
  restart: boolean;
}

/** A clip with its defaults filled in. */
export interface ResolvedClip {
  id: string;
  title: string;
  caption: string | undefined;
  alt: string;
  steps: ClipStep[];
  fps: number;
  /** `undefined` means the default, `DEFAULT_CLIP_DURATION_MS`. */
  durationMs: number | undefined;
  /** `undefined` means the default, `DEFAULT_MAX_FRAMES` (300). */
  maxFrames?: number;
  tailMs: number;
  formats: ClipFormat[];
}

/** A shot of either kind. Frames, the portfolio, the hero and the README only read `id`, `title`, `alt`, `caption`. */
export type ResolvedShot = ResolvedWebShot | ResolvedTtyShot;

/** A background in its object form, with `angle` filled in. */
export type ResolvedBackground =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }
  | { type: 'transparent' };

/** `frame` with every default filled in. */
export interface ResolvedFrame {
  style: FrameStyle;
  theme: 'light' | 'dark';
  title: string | false;
  background: ResolvedBackground;
  padding: number;
  radius: number;
  shadow: boolean;
  quality: number;
  maxWidth: number | undefined;
}

/** `outputs.portfolio` with every default filled in. */
export interface ResolvedPortfolio {
  dir: string;
  size: [number, number];
  format: 'webp' | 'png';
  quality: number;
  thumbnail: string;
  lang: string;
  publicPath: string;
  padding: number;
  /** Gallery JSON path template relative to the root, or false to skip it. */
  gallery: string | false;
}

/** `hero` with every default filled in. */
export interface ResolvedHero {
  tagline: string | undefined;
  logo: string | undefined;
  shots: string[];
  lang: string;
  output: string;
  size: [number, number];
  background: ResolvedBackground;
  theme: 'light' | 'dark';
  quality: number;
}

/** A tty target with every default filled in and `cwd` absolute. */
export interface ResolvedTtyTarget {
  mode: 'tty';
  command: string | [file: string, ...args: string[]];
  /** Absolute. */
  cwd: string;
  env: TtyTarget['env'];
  inheritEnv: boolean | string[];
  cols: number;
  rows: number;
  quitKey: string | false;
  inputDelayMs: number;
  readyTimeoutMs: number;
}

interface ResolvedCommon {
  name: string;
  slug: string;
  root: string;
  deviceScaleFactor: number;
  langs: string[];
  frame: ResolvedFrame;
  outputs: { raw: string; readme: string | false; portfolio: ResolvedPortfolio | undefined; clips: string };
  hero: ResolvedHero;
  browser: BrowserOptions;
  timeouts: Required<Timeouts>;
}

/** A url or cdp mode config with every default filled in. */
export interface ResolvedWebConfig extends ResolvedCommon {
  target: WebTarget & { readyTimeoutMs: number };
  ready: string | undefined;
  viewport: { width: number; height: number };
  colorScheme: 'light' | 'dark' | 'no-preference';
  css: string | undefined;
  setup: WebConfig['setup'];
  shots: ResolvedWebShot[];
}

/** A tty mode config with every default filled in. */
export interface ResolvedTtyConfig extends ResolvedCommon {
  target: ResolvedTtyTarget;
  ready: string | RegExp | undefined;
  terminal: ResolvedTerminalOptions;
  setup: TtyConfig['setup'];
  shots: ResolvedTtyShot[];
  clips: ResolvedClip[];
}

/** A validated config with every default filled in: the web or the tty kind, told apart by `target.mode`. */
export type ResolvedConfig = ResolvedWebConfig | ResolvedTtyConfig;
