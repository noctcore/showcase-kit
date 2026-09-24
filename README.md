# @noctcore/showcase-kit

Capture, frame and export showcase images of desktop and web apps for READMEs and portfolios.

One config file describes your app and the views worth showing. From it, `showcase` produces:

- **raw captures**: pixel-exact PNGs at a fixed viewport and device scale factor, in every UI language;
- **framed README images**: each capture inside a window frame (title bar, rounded corners, soft shadow) on a
  solid or gradient background, as WebP or PNG;
- **portfolio images**: exact-size 16:9 WebP images with the framed window contained (never cropped), a
  `thumbnail.webp`, and a `showcase.gallery.json` ready for a portfolio site;
- **a README table**: an HTML snippet of the framed images with captions, to paste into a README;
- **a hero banner**: logo, name, tagline and a stack of tilted framed shots, 1280x640 by default;
- **app icons**: web, Electron or Tauri icon sets (PNG, `.ico`, `.icns`) from one square image.

It drives the app with [Playwright](https://playwright.dev): web apps in headless Chromium, and Electron (or
Tauri on Windows) over the Chrome DevTools Protocol. Terminal apps (TUIs and CLIs) run in a pseudo terminal, and
their screen is rendered with a bundled monospace font into the same pipeline: see [Terminal apps](#terminal-apps).

## Install

```sh
pnpm add -D @noctcore/showcase-kit playwright
npx playwright install chromium
```

(`npm i -D` and `bun add -d` work the same.) Playwright is a peer dependency, so the kit uses the same Playwright
(and the same downloaded browser) as your end to end tests, if you have them. If you would rather not download
Chromium, point the kit at an installed browser with `browser: { channel: 'chrome' }` (or `'msedge'`).

Requirements: Node 22 or newer (22.18 or newer for a `showcase.config.ts`), Playwright 1.50 or newer. The CLI runs
under `node`, `npx`, `pnpm exec` and `bunx`. Terminal apps also need `@lydell/node-pty` (see
[Terminal apps](#terminal-apps)).

## Quick start

```sh
npx showcase init         # writes showcase.config.mjs (--ts for showcase.config.ts, --tty for a terminal app)
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
| `showcase hero` | Render the README banner to `hero.output`. |
| `showcase icons --source <png> --preset <web\|electron\|tauri> [--out <dir>]` | Generate an icon set. Needs no config. |
| `showcase init` | Write a starter config, filled in from `package.json`. `--tty` starts from a terminal app config. |

Options:

| Option | Applies to | Meaning |
| --- | --- | --- |
| `-c, --config <file>` | all | Config file. By default the kit looks for `showcase.config.{ts,mts,mjs,js}` in the current directory, then in each parent up to the project root: the first directory with a `package.json` or `.git`. In a monorepo, run from the package that has the config or pass `--config`. |
| `--only <ids>` | capture, frame, portfolio, readme, all | Comma-separated shot ids. |
| `--langs <codes>` | capture, frame, all | Comma-separated languages. |
| `--lang <code>` | readme | Language of the images in the table (default: the first of `langs`). |
| `--cols <n>` | readme | Images per row (default 2). |
| `--base <dir>` | readme | Directory the README is in, for relative image paths (default: the config's directory). |
| `--source`, `--preset`, `--out` | icons | Source image, preset, output directory (default `icons`). |
| `--ts`, `--tty`, `--force` | init | Write TypeScript; start from a terminal app config; overwrite an existing config. |
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
| `ready` | none | Selector that exists once the app has booted. Waited for after load, after `setup`, and after `nav` visits a URL. In tty mode: text on screen. |
| `viewport` | `{ width: 1440, height: 900 }` | CSS pixel size of every capture. Not in tty mode. |
| `deviceScaleFactor` | `2` | Captures are `viewport * deviceScaleFactor` pixels. |
| `colorScheme` | `'dark'` | `'light'`, `'dark'` or `'no-preference'`. Not in tty mode (see `terminal.theme`). |
| `langs` | `['en']` | Languages to capture. Each gets its own `setup` run; in url mode each also gets a fresh browser context with that locale. |
| `css` | none | Extra CSS injected before each shot, for example to hide a dev overlay. Not in tty mode. |
| `terminal` | see [Terminal apps](#terminal-apps) | Theme, font and padding of terminal captures. Only in tty mode. |
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
| `url` | required | The app's URL. Path `nav` values resolve under its path (see `shots`). |
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

**tty mode** runs a terminal app in a pseudo terminal: see [Terminal apps](#terminal-apps).

In cdp mode the kit sets the page to the configured viewport and device scale factor with
`Emulation.setDeviceMetricsOverride`, so captures are the same size on every machine whatever the window size is.
It clears the override, removes the styles it injected and disconnects afterwards; it never closes the app. One
thing it cannot undo: animations it finished or reset for the shutter stay that way, so reload the app window
(Ctrl+R in Electron dev builds) if a spinner or looping animation looks stuck after a capture.

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
  `http(s)://`). In url mode a path resolves under the target url's path, which counts as the app's base directory
  with or without a trailing slash: with `url: 'https://x.io/app/'`, `'/docs/'` visits `https://x.io/app/docs/` and
  `'/'` visits the url itself. The url's query and hash are not carried over. In cdp mode a path resolves against
  the origin of the page being captured;
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
| `readme` | `assets/showcase/{lang}/{id}.webp` | Framed images. `.webp` or `.png`. `false` skips them (portfolio-only configs). |
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
| `gallery` | `<dir>/showcase.gallery.json` | Gallery JSON path relative to the config root (token `{slug}`, must end in `.json`), or `false` to skip it. |

The window is scaled to fit inside `size` minus `padding` with its aspect ratio kept, and the background fills the
rest, so nothing is ever cropped and a 16:9 `object-cover` tile shows the whole window.

The portfolio images and the hero render from the raw captures, not from the README images, so a config that only
feeds a portfolio can set `outputs: { readme: false, portfolio: { ... } }`: `frame` then does nothing, `all` skips
it, and `readme` explains that there is nothing to list.

### `hero`

`showcase hero` composes a banner from the raw captures: your logo, name and tagline on the left, one to three
framed shots stacked and tilted on the right. It is rendered at 2x and scaled to the exact size.

| Key | Default | Meaning |
| --- | --- | --- |
| `tagline` | none | Line under the name. |
| `logo` | none | PNG, SVG, WebP or JPEG, relative to the config root. |
| `shots` | the first three shots | One to three shot ids, back to front. |
| `lang` | the first of `langs` | Which language's captures to use. |
| `output` | `assets/showcase/hero.webp` | `.webp` or `.png`. Tokens: `{lang}`, `{slug}`. |
| `size` | `[1280, 640]` | Exact size in pixels (the GitHub social preview size). |
| `background` | `frame.background` | Same forms as `frame.background`. |
| `theme` | `frame.theme` | Text colors: `'dark'` (light text) or `'light'`. |
| `quality` | `90` | WebP quality. |

## Terminal apps

`target.mode: 'tty'` captures TUIs and other terminal apps. The kit starts the app in a pseudo terminal of a fixed
size, keeps the screen in a headless terminal emulator ([xterm.js](https://xtermjs.org)), and renders the screen
(not the byte stream) with a bundled [JetBrains Mono](https://www.jetbrains.com/lp/mono/) into a PNG in its own
Chromium. That raw PNG is the terminal area, so `frame`, `portfolio`, `hero` and `readme` work exactly as for web
apps, and the `window` frame reads as a terminal window.

### Install

```sh
pnpm add -D @noctcore/showcase-kit playwright @lydell/node-pty
npx playwright install chromium
```

`@lydell/node-pty` is an optional peer dependency: prebuilt for Windows, macOS and Linux (x64 and arm64), no install
scripts. The official `node-pty` works too when it is installed instead. Web-only projects never load either.

Run the CLI with Node: `npx showcase`, `pnpm exec showcase`, or `bunx showcase` (which uses Node). Under the Bun
runtime itself (`bun --bun` or `bunx --bun`) tty mode stops with "run with node", because the PTY package kills the
app at once there.

### Example

```js
// showcase.config.mjs
import { defineConfig } from '@noctcore/showcase-kit';

export default defineConfig({
  name: 'Rumi',
  target: {
    mode: 'tty',
    command: ['bun', 'run', 'src/index.tsx'],
    // Fixture data and a frozen clock, so every run shows the same screen.
    env: { RUMI_MOCK: '1', RUMI_SHOWCASE: '1' },
    cols: 120,
    rows: 32,
  },
  ready: /resources \(\d+\)/,
  deviceScaleFactor: 2,
  terminal: { theme: 'dark', font: { size: 15 } },
  shots: [
    { id: 'resources', title: 'Resources', caption: 'Every resource on one screen.' },
    { id: 'servers', title: 'Servers', keys: '{Tab}', waitFor: /servers \(\d+\)/ },
    { id: 'logs', title: 'Logs', keys: ['{Tab}', 'l'], waitFor: 'logs', delayMs: 200 },
    {
      id: 'deploy',
      title: 'Deploy',
      nav: async tty => {
        await tty.press('L');
        await tty.waitForText('Deploying');
      },
    },
  ],
  frame: { style: 'window', theme: 'dark', title: '{name}' },
});
```

`npx showcase init --tty` writes a starter like this, with the command taken from your package's `bin` or its
`start` script.

### `target` in tty mode

| Key | Default | Meaning |
| --- | --- | --- |
| `mode: 'tty'` | | |
| `command` | required | A string runs through the shell, like `start` in the other modes. An array `['node', 'dist/cli.js']` is spawned directly. |
| `cwd` | config dir | Working directory. |
| `env` | none | Extra environment, or a function `({ lang }) => ({ ... })` for apps that take their language from an env var. |
| `cols`, `rows` | `120`, `32` | Terminal size. Never taken from your own terminal. |
| `quitKey` | `'q'` | Sent to quit at the end, before the process tree is killed. `false` just kills. |
| `inputDelayMs` | `300` | Grace after `ready` before the first key (from `setup` or a shot). Keys sent before an app switches its terminal to raw mode are lost. |
| `readyTimeoutMs` | `30000` | How long to wait for the `ready` text (without `ready`, for the app to draw anything). |

The app gets `TERM=xterm-256color`, `COLORTERM=truecolor`, `FORCE_COLOR=3`, `TZ=UTC` and (on macOS and Linux)
`LANG=LC_ALL=en_US.UTF-8`, and does not inherit `NO_COLOR`, `CI`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`,
`WT_SESSION`, `COLUMNS` or `LINES`. `env` overrides any of them.

In tty mode `viewport`, `colorScheme` and `css` are errors (the image size comes from `cols`, `rows`, the font size
and the padding), and so are `timeouts.readyMs` (use `target.readyTimeoutMs`) and `timeouts.networkIdleMs`.
`timeouts.shotMs` (15000) bounds each `waitFor`.

### Shots in tty mode

| Key | Default | Meaning |
| --- | --- | --- |
| `id`, `title`, `caption`, `alt`, `delayMs` | | As for web shots. |
| `keys` | none | Keys to press. Plain text is typed; names in braces are keys: `{Enter}`, `{Tab}`, `{S-Tab}`, `{Esc}`, `{Space}`, `{Backspace}`, `{Insert}`, `{Delete}`, `{Up}`, `{Down}`, `{Left}`, `{Right}`, `{Home}`, `{End}`, `{PageUp}`, `{PageDown}`, `{F1}` to `{F12}`, `{C-x}` (Ctrl), `{A-x}` (Alt), and `{{` for a literal `{`. A string or an array. |
| `nav` | none | Or your own steps: `async tty => { ... }` with `press`, `type`, `waitForText`, `screenText`, `sleep` and `resize`. Use `keys` or `nav`, not both. |
| `waitFor` | none | Text on screen to wait for after the keys: a substring or a RegExp. |
| `restart` | `false` | Start a fresh app process (and run `setup` again) before this shot. |

One app process runs per language, and the shots run in order in it, so each shot starts where the last one left
off. Per shot the kit presses the keys (or runs `nav`), waits for `waitFor`, waits `delayMs`, and renders the
screen. Without `waitFor` it gives the app up to one second to redraw after the keys; set `waitFor` for anything
slower. `setup` runs in each new process once `ready` has shown and receives `{ tty, lang, mode: 'tty', config }`. Without
`ready` the kit only waits for the app to draw anything, then the `inputDelayMs` grace, which may catch an app
halfway through its first screen: set `ready` to text the finished screen shows.
A failed shot fails alone, and its error shows the screen the app was on.

When the run ends or fails, the kit sends `quitKey` (parsed like `keys`, so `'{C-c}'` works), waits up to 1.5 s
for the app to quit, and then kills the app's whole process tree by PID. On Ctrl+C the process tree is always
killed, but the quit key is best effort: the browser's own Ctrl+C handling can end the run before it is sent.

### `terminal`

| Key | Default | Meaning |
| --- | --- | --- |
| `theme` | `'dark'` | `'dark'`, `'light'`, or `{ background, foreground, cursor?, ansi }` in `#rrggbb` colors, with exactly 16 `ansi` colors (8 normal, then 8 bright). |
| `font.file` | bundled JetBrains Mono | A `.woff2`, `.woff`, `.ttf` or `.otf` file, relative to the config. `boldFile`, `italicFile` and `boldItalicFile` set the other faces. |
| `font.fallbackFile` | none | A second font for glyphs the main one lacks, for example a symbols or Nerd Font for icons. |
| `font.size` | `15` | CSS pixels. |
| `lineHeight` | `1.32` | Multiple of the font size, rounded to whole pixels. |
| `padding` | `12` | CSS pixels between the grid and the edge of the capture. |
| `cursor` | `'hide'` | `'show'` draws it (never blinking). |

The raw capture is `cols` cells wide and `rows` cells high plus `padding` on each side, times `deviceScaleFactor`:
with the defaults a cell is 9 x 20 CSS pixels, so 120 x 32 at DPR 2 is 2208 x 1328. Cells are whole pixels wide,
and ligatures and kerning are off, so columns line up exactly. Rendering never touches the network: the fonts are
inlined into the page.

The bundled font is JetBrains Mono 2.304 under the SIL Open Font License 1.1; the license ships with the package
(`dist/fonts/OFL.txt`).

### Determinism checklist

What the kit does for you:

1. A fixed `cols` and `rows`, never read from a window.
2. A pinned environment (above): colors on, `TZ=UTC`, no CI or terminal program hints.
3. It settles on screen content, not on output silence: `ready` and `waitFor` text, then a fixed grace. Waiting for
   the app to go quiet would never end for an app with a clock or a spinner.
4. A grace period after `ready` before the first key.
5. A bundled font, a whole pixel cell width, a fixed line height, a fixed theme and a hidden cursor.
6. Glyphs the font lacks get their own clipped cell, so they cannot shift the row. They still come from a system
   font, so they differ between operating systems: add `font.fallbackFile` for icons.
7. It renders the screen grid, not the bytes. Windows' ConPTY rewrites an app's output, but the grid and the PNG
   come out the same.

Same OS, same pixels: two runs produce identical PNGs. Across operating systems expect small anti-aliasing
differences, so run captures on one OS if committed images must not churn.

### What a TUI should offer

The kit can only freeze what the app lets it freeze. The terminal equivalent of a web app's `?showcase=1`:

- **A fixture mode** behind an env var (`MYAPP_MOCK=1`): stable sample data, no network.
- **A frozen mode** (`MYAPP_SHOWCASE=1`, or the same flag): spinners and progress bars stopped on one frame, "now"
  pinned to a constant (clocks in headers, "3 minutes ago" labels), no first-run splash or update check.
- **A pinned locale** for dates and numbers inside the app. `LANG` only reaches apps on macOS and Linux; Windows
  ignores it.
- **A language switch** through an env var, so `env: ({ lang }) => ({ MYAPP_LANG: lang })` can capture every
  language.
- **A layout that holds** at the configured `cols` and `rows`.

### Platform notes

- **Windows:** works through ConPTY. `LANG` has no effect there, so pin the locale in the app.
- **macOS:** `@lydell/node-pty` ships its spawn helper executable. With the official `node-pty` 1.1.0 a spawn can
  fail with `posix_spawnp failed` (node-pty issue #919) until its `spawn-helper` binary is made executable; prefer
  `@lydell/node-pty`. Fonts rasterize differently from Windows and Linux (the cell grid stays the same).
- **Linux:** `@lydell/node-pty` has prebuilds for x64 and arm64 glibc; Alpine (musl) is untested.
- **Bun:** run the CLI with Node (above). Your app itself can be a Bun app: `command: ['bun', 'run', 'src/index.tsx']`.

## Icons

```sh
npx showcase icons --source assets/mascot.png --preset electron --out apps/desktop/resources
```

The source should be a square PNG, 1024x1024 or larger, ideally on a transparent background. Every size is
`contain`-fitted on transparency.

| Preset | Files |
| --- | --- |
| `web` | `favicon.ico` (16, 32, 48), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` |
| `electron` | `icon.png` (1024), `icon-16.png`, `icon-32.png`, `icon.ico` (16, 32, 48, 256) |
| `tauri` | `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png` (1024), `icon.ico` (16 to 256), `icon.icns` (16 to 512@2x) |

For Tauri, `pnpm tauri icon` produces the full platform set (including the Windows Store tiles); the `tauri` preset
covers what `bundle.icon` usually lists.

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

When `dir` is a web root such as Next's `public/`, the JSON would be served too: point `gallery` somewhere else
(`gallery: '../portfolio/src/data/{slug}.gallery.json'`) or turn it off with `gallery: false`.

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
import { capture, exportPortfolio, frame, generateIcons, hero, loadConfig, readmeSnippet } from '@noctcore/showcase-kit';

const config = await loadConfig(); // or loadConfig('path/to/showcase.config.mjs')
await capture(config, { only: ['library'], langs: ['en'] });
await frame(config);
await exportPortfolio(config);
console.log(readmeSnippet(config, { lang: 'en', cols: 2 }));
await hero(config);
await generateIcons('mascot.png', 'web', 'public');
```

`resolveConfig(object, rootDir)` validates a config object without a file, and `defineConfig` only exists for
types and editor completion: it reads `target.mode`, so tty `setup` and `nav` functions get the terminal session
instead of a page. A resolved config is a web or a tty config; `isTtyConfig(config)` tells them apart.

The terminal engine is exported too, for scripts of your own: `openTtySession({ command, cwd, env, cols, rows })`
returns a session with `press`, `type`, `waitForText`, `screen` and `close`, and
`renderTtyScreen(page, session.screen(), resolveTerminalOptions(undefined, cwd), 2)` renders a screen to a PNG in a
Playwright page whose context has the same device scale factor. `parseKeys`, `DARK_THEME`, `LIGHT_THEME` and
`TERMINAL_DEFAULTS` come with them.

## License

MIT
