# @noctcore/showcase-kit

Capture, frame and export showcase images of desktop and web apps for READMEs and portfolios.

One config file describes your app and the views worth showing. From it, `showcase` produces:

- **raw captures**: pixel-exact PNGs at a fixed viewport and device scale factor, in every UI language;
- **framed README images**: each capture inside a window frame (title bar, rounded corners, soft shadow) on a
  solid or gradient background, as WebP or PNG;
- **portfolio images**: exact-size 16:9 WebP images with the framed window contained (never cropped), a
  `thumbnail.webp`, and a `showcase.gallery.json` ready for a portfolio site;
- **a README table**: an HTML snippet of the framed images with captions, to paste into a README.

It drives the app with [Playwright](https://playwright.dev): web apps in headless Chromium, and Electron (or
Tauri on Windows) over the Chrome DevTools Protocol.

## Install

```sh
pnpm add -D @noctcore/showcase-kit playwright
npx playwright install chromium
```

(`npm i -D` and `bun add -d` work the same.) Playwright is a peer dependency, so the kit uses the same Playwright
(and the same downloaded browser) as your end to end tests, if you have them. If you would rather not download
Chromium, point the kit at an installed browser with `browser: { channel: 'chrome' }` (or `'msedge'`).

Requirements: Node 22 or newer (22.18 or newer for a `showcase.config.ts`), Playwright 1.50 or newer. The CLI runs
under `node`, `npx`, `pnpm exec` and `bunx`.

## Quick start

```sh
npx showcase init         # writes showcase.config.mjs (or --ts for showcase.config.ts)
# edit the target and the shots
npx showcase all          # capture, frame, and export the portfolio images
npx showcase readme       # print the README table
```

## Commands

| Command | What it does |
| --- | --- |
| `showcase capture` | Screenshot every shot in every language into `outputs.raw` (PNG). |
| `showcase frame` | Frame the raw captures into `outputs.readme` (`.webp` or `.png`). |
| `showcase portfolio` | Export `outputs.portfolio`: one image per shot, `thumbnail.<format>`, `showcase.gallery.json`. |
| `showcase readme` | Print an HTML table of the framed images with `<sub>` captions. |
| `showcase all` | `capture`, then `frame`, then `portfolio` when it is configured. |
| `showcase init` | Write a starter config, filled in from `package.json`. |

Options:

| Option | Applies to | Meaning |
| --- | --- | --- |
| `-c, --config <file>` | all | Config file. By default the kit looks for `showcase.config.{ts,mts,mjs,js}` in the current directory, then in each parent. |
| `--only <ids>` | capture, frame, portfolio, readme, all | Comma-separated shot ids. |
| `--langs <codes>` | capture, frame, all | Comma-separated languages. |
| `--lang <code>` | readme | Language of the images in the table (default: the first of `langs`). |
| `--cols <n>` | readme | Images per row (default 2). |
| `--base <dir>` | readme | Directory the README is in, for relative image paths (default: the config's directory). |
| `--ts`, `--force` | init | Write TypeScript; overwrite an existing config. |
| `--verbose`, `--quiet` | all | Show the start command's output; print only warnings and errors. |

Every command exits with code 1 on failure. A failed shot does not stop the others: the rest are still written,
then the run fails with a list of what went wrong.

## Config

```js
// showcase.config.mjs
import { defineConfig } from '@noctcore/showcase-kit';

export default defineConfig({
  name: 'Shiranami',
  slug: 'shiranami',
  target: { mode: 'url', url: 'http://localhost:15175', start: 'pnpm dev:web', readyTimeoutMs: 60000 },
  ready: '[data-testid="app-ready"]',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  langs: ['en', 'pl'],
  setup: async ({ page, lang }) => {
    await page.evaluate(value => localStorage.setItem('app.language', value), lang);
    await page.reload();
  },
  shots: [
    { id: 'library', title: 'Library', caption: 'Browse and play from your own folders.', nav: '[data-view="library"]' },
    { id: 'settings', title: 'Settings', nav: '[data-view="settings"]', delayMs: 600 },
  ],
  frame: {
    style: 'window',
    theme: 'dark',
    background: { type: 'gradient', from: '#0f766e', to: '#1e1b4b' },
    padding: 72,
    radius: 14,
    shadow: true,
  },
  outputs: {
    raw: 'showcase-out/raw/{lang}/{id}.png',
    readme: 'assets/showcase/{lang}/{id}.webp',
    portfolio: { dir: '../portfolio/public/projects/{slug}', size: [1920, 1080], format: 'webp', thumbnail: 'library' },
  },
});
```

The config is validated before anything runs. Every problem is reported at once, with its path, including unknown
keys (so a typo such as `viewPort` does not get silently ignored). Relative paths resolve against the config
file's directory, or `root` if you set one.

### Top level

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | required | App name. Used in the frame title and default alt text. |
| `slug` | `name`, lowercased, dashed | The `{slug}` token. |
| `root` | the config's directory | Base for relative paths. |
| `target` | required | How to reach the app: see below. |
| `ready` | none | Selector that exists once the app has booted. Waited for after load, after `setup`, and after `nav` visits a URL. |
| `viewport` | `{ width: 1440, height: 900 }` | CSS pixel size of every capture. |
| `deviceScaleFactor` | `2` | Captures are `viewport * deviceScaleFactor` pixels. |
| `colorScheme` | `'dark'` | `'light'`, `'dark'` or `'no-preference'`. |
| `langs` | `['en']` | Languages to capture. Each gets its own `setup` run; in url mode each also gets a fresh browser context with that locale. |
| `css` | none | Extra CSS injected before each shot, for example to hide a dev overlay. |
| `setup` | none | `async ({ page, context, lang, mode, config }) => {}`. Runs once per language after `ready`: seed fixtures, switch the language, dismiss dialogs. |
| `shots` | required | The views to capture, in order. |
| `frame` | see below | README frame look. Portfolio images use the same look. |
| `outputs` | see below | Where files go. |
| `browser` | `{}` | `channel` (`'chrome'`, `'msedge'`), `executablePath`, `headless` (default true) and `args` for the Chromium the kit launches. |
| `timeouts` | see below | `readyMs` (30000): the `ready` selector. `shotMs` (15000): each navigation and `waitFor`. `networkIdleMs` (3000): a best-effort wait for the network to go quiet, which dev servers with HMR never do. |

### `target`

**url mode** captures the app in the kit's own headless Chromium:

| Key | Default | Meaning |
| --- | --- | --- |
| `mode: 'url'` | | |
| `url` | required | The app's URL. Path `nav` values resolve against it. |
| `start` | none | Shell command that starts the app, such as `pnpm dev:web`. Omit it if the app is already running. |
| `cwd`, `env` | config dir, none | Working directory and extra environment for `start`. |
| `readyTimeoutMs` | `60000` | How long to wait for `url` to answer after `start`. |
| `reuseExisting` | `true` | If `url` already answers, use it instead of starting a second copy. |

**cdp mode** attaches to a running Chromium based app (Electron, or WebView2 on Windows) over the DevTools
Protocol:

| Key | Default | Meaning |
| --- | --- | --- |
| `mode: 'cdp'` | | |
| `cdpUrl` | `http://127.0.0.1:9222` | The app's remote debugging endpoint. |
| `pageMatch` | first non-devtools page | Substring of the page URL, or a RegExp, that picks the window to capture. |
| `start`, `cwd`, `env`, `readyTimeoutMs` | | As in url mode; the kit waits for `<cdpUrl>/json/version` to answer. |

In cdp mode the kit sets the page to the configured viewport and device scale factor with
`Emulation.setDeviceMetricsOverride`, so captures are the same size on every machine whatever the window size is.
It clears the override and disconnects afterwards; it never closes the app.

A `start` command runs through the shell (so `pnpm`, `bun` and `npm` work on Windows, where they are `.cmd`
shims) in its own process tree. When the run ends, fails, or you press Ctrl+C, the kit kills that whole tree by PID
(`taskkill /T` on Windows, the process group on macOS and Linux), so no dev server is left behind.

### `shots`

| Key | Default | Meaning |
| --- | --- | --- |
| `id` | required | File name and `{id}` token. Letters, digits, `-`, `_`. |
| `title` | `id` | Human name, used in the frame title (with a `{title}` template) and default alt text. |
| `caption` | `title` | Caption in the README table and the gallery JSON. |
| `alt` | `<name>: <title>` | Alt text. |
| `nav` | none | How to get to the view: see below. |
| `waitFor` | none | Selector to wait for (visible) after navigating. |
| `delayMs` | `0` | Extra settle time after navigating. |

`nav` can be:

- a selector to click: `'[data-view="library"]'`;
- a path or URL to visit: `'/settings'` or `'https://...'` (a string starting with `/` but not `//`, or with
  `http(s)://`);
- explicit: `{ click: 'text=Library' }` or `{ goto: '/settings' }`;
- a function: `async page => { await page.getByRole('button', { name: 'Open' }).click(); }`.

Before each shutter the kit waits for `waitFor`, a bounded network idle, `document.fonts.ready` and two animation
frames. Captures are deterministic: reduced motion is requested, CSS transitions are zeroed, finite animations are
finished and infinite ones reset, and the text caret is hidden. Two runs of the same app state produce the same
pixels.

### `frame`

| Key | Default | Meaning |
| --- | --- | --- |
| `style` | `'window'` | `'window'` (title bar with traffic lights), `'minimal'` (thin bar), `'none'` (just the rounded screenshot). |
| `theme` | `'dark'` | Title bar colors: `'light'` or `'dark'`. |
| `title` | `'{name}'` | Title bar text. Tokens: `{name}`, `{title}`, `{id}`, `{lang}`. `false` hides it. |
| `background` | teal to indigo gradient | A color string, `{ type: 'solid', color }`, `{ type: 'gradient', from, to, angle? }` or `{ type: 'transparent' }`. |
| `padding` | `72` | Space around the window, in CSS pixels. |
| `radius` | `14` | Window corner radius. |
| `shadow` | `true` | Soft drop shadow. |
| `quality` | `90` | WebP quality. |
| `maxWidth` | none | Downscale README images wider than this. |

Frames render at the capture's device scale factor: a 1440x900 capture at DPR 2 becomes a
`(1440 + 2 * 72) x (900 + 40 + 2 * 72)` CSS pixel image, 3168x2168 pixels. Set `maxWidth` (for example 1800) to
keep README images lighter.

### `outputs`

| Key | Default | Meaning |
| --- | --- | --- |
| `raw` | `showcase-out/raw/{lang}/{id}.png` | Raw captures. Must be `.png`. |
| `readme` | `assets/showcase/{lang}/{id}.webp` | Framed images. `.webp` or `.png`. |
| `portfolio` | none | Portfolio export, see below. |

Path tokens are `{lang}`, `{id}` and `{slug}`. `{id}` is required, and so is `{lang}` once there is more than
one language, so files never overwrite each other. Add `showcase-out/` to `.gitignore`; commit the framed images.

`outputs.portfolio`:

| Key | Default | Meaning |
| --- | --- | --- |
| `dir` | required | Output directory. Token: `{slug}`. |
| `size` | `[1920, 1080]` | Exact output size in pixels. |
| `format` | `'webp'` | `'webp'` or `'png'`. |
| `quality` | `90` | WebP quality. |
| `thumbnail` | the first shot | Shot copied to `thumbnail.<format>`. |
| `lang` | the first of `langs` | Language to export. |
| `publicPath` | `/projects/{slug}` | URL prefix for `src` in the gallery JSON. |
| `padding` | `96` | Minimum space around the window, in output pixels. |

The window is scaled to fit inside `size` minus `padding` with its aspect ratio kept, and the background fills the
rest, so nothing is ever cropped and a 16:9 `object-cover` tile shows the whole window.

## Recipes

### Web app

```js
export default defineConfig({
  name: 'My App',
  target: { mode: 'url', url: 'http://localhost:5173', start: 'pnpm dev' },
  ready: '#root > *',
  shots: [
    { id: 'dashboard', title: 'Dashboard', nav: '/' },
    { id: 'reports', title: 'Reports', nav: '/reports', waitFor: '[data-testid="chart"]' },
  ],
});
```

If the app needs a backend you do not want to run for screenshots, give it a fixture mode (for example
`?showcase=1`, or a `localStorage` flag seeded in `setup`) that serves stable demo data. Stable data is what makes
two runs produce the same images.

### Electron over CDP

Start Electron with remote debugging on, either yourself:

```sh
pnpm dev:web                                        # terminal 1: the renderer dev server
pnpm exec electron . --remote-debugging-port=9222   # terminal 2
```

or through `target.start`:

```js
export default defineConfig({
  name: 'ShiroAni',
  target: {
    mode: 'cdp',
    cdpUrl: 'http://127.0.0.1:9222',
    pageMatch: 'localhost:15174', // the renderer, not a devtools or splash window
    start: 'pnpm --filter desktop exec electron . --remote-debugging-port=9222',
    readyTimeoutMs: 120000,
  },
  ready: '[data-testid="app-ready"]',
  langs: ['en', 'pl'],
  setup: async ({ page, lang }) => {
    await page.evaluate(value => localStorage.setItem('shiroani.language', value), lang);
    await page.reload();
  },
  shots: [{ id: 'library', title: 'Library', nav: '[data-view="library"]' }],
});
```

In cdp mode there is one page and one profile, so `setup` is where each language gets switched. The app keeps any
state it persists (the language, a collapsed sidebar), so restore it yourself afterwards if that matters.

### Tauri

macOS runs Tauri in WKWebView, which has no DevTools Protocol, so the portable route is to capture the app's web
build in url mode. That works on both macOS and Windows:

```js
export default defineConfig({
  name: 'Shiranami',
  target: { mode: 'url', url: 'http://localhost:15175', start: 'pnpm dev:web' },
  ready: '[data-view="library"]',
  setup: async ({ page }) => {
    // Skip the first-run wizard in a fresh browser profile.
    await page.evaluate(() =>
      localStorage.setItem('shiranami.onboarding', JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 1 })),
    );
    await page.reload();
  },
  shots: [{ id: 'library', title: 'Library', nav: '[data-view="library"]' }],
});
```

This needs the web build to run without the Tauri backend (a mock or fixture mode).

On Windows only, Tauri's WebView2 is Chromium and can expose CDP. Pass
`--remote-debugging-port=9222 --remote-allow-origins=*` to it through the window's `additionalBrowserArgs` in
`tauri.conf.json` (a `--config` overlay for dev runs keeps it out of release builds). Note that
`additionalBrowserArgs` replaces wry's default `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`, so
include that flag again. Then use cdp mode with `pageMatch: 'localhost:15175'` (dev) or `'tauri.localhost'`
(a packaged build).

### Exporting into a portfolio

With the portfolio repo next to the app:

```js
outputs: {
  portfolio: { dir: '../portfolio/public/projects/{slug}', size: [1920, 1080], thumbnail: 'library' },
},
```

`showcase portfolio` (or `all`) writes `<id>.webp` for every shot, `thumbnail.webp`, and `showcase.gallery.json`:

```json
[
  { "src": "/projects/shiranami/library.webp", "alt": "Shiranami: Library", "caption": "Browse and play from your own folders." }
]
```

Its entries have the `{ src, alt, caption }` shape of a gallery item, so the portfolio can import it directly:

```ts
import gallery from '../../../public/projects/shiranami/showcase.gallery.json';

export const shiranami: Project = {
  // ...
  image: '/projects/shiranami/thumbnail.webp',
  gallery,
};
```

## Programmatic API

Everything the CLI does is exported:

```ts
import { capture, exportPortfolio, frame, loadConfig, readmeSnippet } from '@noctcore/showcase-kit';

const config = await loadConfig(); // or loadConfig('path/to/showcase.config.mjs')
await capture(config, { only: ['library'], langs: ['en'] });
await frame(config);
await exportPortfolio(config);
console.log(readmeSnippet(config, { lang: 'en', cols: 2 }));
```

`resolveConfig(object, rootDir)` validates a config object without a file, and `defineConfig` only exists for
types and editor completion.

## License

MIT
