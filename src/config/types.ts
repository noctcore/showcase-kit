import type { BrowserContext, Page } from 'playwright';

/** Navigate to a shot: click a selector, visit a path or URL, or run your own steps. */
export type NavFn = (page: Page) => Promise<void> | void;

/**
 * How to reach a shot.
 *
 * - A string starting with `/` (but not `//`) or `http(s)://` is visited as a URL, relative to the target URL.
 * - Any other string is a selector to click.
 * - `{ click }` and `{ goto }` say which one explicitly.
 * - A function receives the page and does whatever it needs.
 */
export type Nav = string | { click: string } | { goto: string } | NavFn;

export interface Shot {
  /** File name stem and `{id}` token. Letters, digits, `-` and `_`. */
  id: string;
  /** Human name, used in frame titles and gallery alt text. Defaults to `id`. */
  title?: string;
  /** Caption under the image in the README table and the portfolio gallery. */
  caption?: string;
  /** Alt text. Defaults to `<name>: <title>`. */
  alt?: string;
  nav?: Nav;
  /** Selector to wait for after navigating. */
  waitFor?: string;
  /** Extra settle time after navigating, in milliseconds. */
  delayMs?: number;
}

export interface UrlTarget {
  mode: 'url';
  /** The app's URL. Path `nav` values resolve against it. */
  url: string;
  /** Shell command that starts the app (for example `pnpm dev:web`). Omit if it is already running. */
  start?: string;
  /** Working directory for `start`. Defaults to the config root. */
  cwd?: string;
  env?: Record<string, string>;
  /** How long to wait for `url` to answer after `start`. Default 60000. */
  readyTimeoutMs?: number;
  /** Use an app that already answers on `url` instead of starting a second copy. Default true. */
  reuseExisting?: boolean;
}

export interface CdpTarget {
  mode: 'cdp';
  /** The app's remote debugging endpoint. Default `http://127.0.0.1:9222`. */
  cdpUrl?: string;
  /** Picks the page to capture: a substring of its URL, or a RegExp. Default: the first non-devtools page. */
  pageMatch?: string | RegExp;
  /** Shell command that launches the app with remote debugging on. Omit if it is already running. */
  start?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** How long to wait for the CDP endpoint to answer after `start`. Default 60000. */
  readyTimeoutMs?: number;
}

export type Target = UrlTarget | CdpTarget;

export interface SetupContext {
  page: Page;
  context: BrowserContext;
  lang: string;
  mode: Target['mode'];
  config: ResolvedConfig;
}

export type Background =
  | string
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle?: number }
  | { type: 'transparent' };

export type FrameStyle = 'window' | 'minimal' | 'none';

export interface FrameOptions {
  /** `window`: title bar with traffic lights. `minimal`: thin bar. `none`: just the rounded screenshot. */
  style?: FrameStyle;
  theme?: 'light' | 'dark';
  /** Title bar text. Tokens: `{name}`, `{title}`, `{id}`, `{lang}`. `false` hides it. Default `{name}`. */
  title?: string | false;
  background?: Background;
  /** Space around the window, in CSS pixels. */
  padding?: number;
  /** Window corner radius, in CSS pixels. */
  radius?: number;
  shadow?: boolean;
  /** WebP quality, 1 to 100. */
  quality?: number;
  /** Downscale README images wider than this many pixels. */
  maxWidth?: number;
}

export interface PortfolioOutput {
  /** Output directory. Token: `{slug}`. */
  dir: string;
  /** Exact output size in pixels. Default `[1920, 1080]`. */
  size?: [number, number];
  format?: 'webp' | 'png';
  quality?: number;
  /** Shot id copied to `thumbnail.<format>`. Default: the first shot. */
  thumbnail?: string;
  /** Which language to export. Default: the first of `langs`. */
  lang?: string;
  /** URL prefix used for `src` in `showcase.gallery.json`. Token: `{slug}`. Default `/projects/{slug}`. */
  publicPath?: string;
  /** Minimum space around the window, in output pixels. Default 96. */
  padding?: number;
}

export interface Outputs {
  /** Raw capture path (PNG). Tokens: `{lang}`, `{id}`, `{slug}`. */
  raw?: string;
  /** Framed README image path (`.webp` or `.png`). Tokens: `{lang}`, `{id}`, `{slug}`. */
  readme?: string;
  portfolio?: PortfolioOutput;
}

export interface HeroOptions {
  /** Line under the name. */
  tagline?: string;
  /** Logo image (PNG, SVG, WebP or JPEG), relative to the config root. */
  logo?: string;
  /** One to three shot ids to stack, back to front. Default: the first three shots. */
  shots?: string[];
  /** Which language's captures to use. Default: the first of `langs`. */
  lang?: string;
  /** Output path (`.webp` or `.png`). Tokens: `{lang}`, `{slug}`. Default `assets/showcase/hero.webp`. */
  output?: string;
  /** Exact output size in pixels. Default `[1280, 640]`, the GitHub social preview size. */
  size?: [number, number];
  /** Default: `frame.background`. */
  background?: Background;
  /** Text color scheme. Default: `frame.theme`. */
  theme?: 'light' | 'dark';
  quality?: number;
}

export interface BrowserOptions {
  /** A Playwright channel such as `chrome` or `msedge`, to use an installed browser instead of a downloaded one. */
  channel?: string;
  executablePath?: string;
  /** Default true. */
  headless?: boolean;
  args?: string[];
}

export interface Timeouts {
  /** Wait for the `ready` selector. Default 30000. */
  readyMs?: number;
  /** Navigation and `waitFor` per shot. Default 15000. */
  shotMs?: number;
  /** Best-effort network idle wait; a busy dev server only costs this much. Default 3000. */
  networkIdleMs?: number;
}

export interface ShowcaseConfig {
  /** App name, used in frame titles and alt text. */
  name: string;
  /** Used for the `{slug}` token. Default: `name` lowercased with dashes. */
  slug?: string;
  /** Base directory for relative paths. Default: the config file's directory. */
  root?: string;
  target: Target;
  /** Selector that exists once the app has booted. */
  ready?: string;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  colorScheme?: 'light' | 'dark' | 'no-preference';
  langs?: string[];
  /** Extra CSS injected before each shot, for example to hide dev overlays. */
  css?: string;
  /** Runs once per language after the app is ready: seed fixtures, switch locale, dismiss dialogs. */
  setup?: (ctx: SetupContext) => Promise<void> | void;
  shots: Shot[];
  frame?: FrameOptions;
  outputs?: Outputs;
  /** Banner image for the top of a README: logo, name, tagline and a stack of framed shots. */
  hero?: HeroOptions;
  browser?: BrowserOptions;
  timeouts?: Timeouts;
}

export interface ResolvedShot extends Shot {
  title: string;
  alt: string;
  delayMs: number;
}

export type ResolvedBackground =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }
  | { type: 'transparent' };

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

export interface ResolvedPortfolio {
  dir: string;
  size: [number, number];
  format: 'webp' | 'png';
  quality: number;
  thumbnail: string;
  lang: string;
  publicPath: string;
  padding: number;
}

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

export interface ResolvedConfig {
  name: string;
  slug: string;
  root: string;
  target: Target & { readyTimeoutMs: number };
  ready: string | undefined;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  colorScheme: 'light' | 'dark' | 'no-preference';
  langs: string[];
  css: string | undefined;
  setup: ShowcaseConfig['setup'];
  shots: ResolvedShot[];
  frame: ResolvedFrame;
  outputs: { raw: string; readme: string; portfolio: ResolvedPortfolio | undefined };
  hero: ResolvedHero;
  browser: BrowserOptions;
  timeouts: Required<Timeouts>;
}
