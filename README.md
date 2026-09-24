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
| `showcase record` | Record the terminal `clips` into `outputs.clips` (WebP and GIF, MP4 opt-in). |
| `showcase all` | `capture`, then `frame`, then `portfolio` when it is configured, then `record` when there are `clips`. |
| `showcase hero` | Render the README banner to `hero.output`. |
| `showcase icons --source <png> --preset <web\|electron\|tauri> [--out <dir>]` | Generate an icon set. Needs no config. |
| `showcase init` | Write a starter config, filled in from `package.json`. `--tty` starts from a terminal app config. |

Options:

| Option | Applies to | Meaning |
| --- | --- | --- |
| `-c, --config <file>` | all | Config file. By default the kit looks for `showcase.config.{ts,mts,mjs,js}` in the current directory, then in each parent up to the project root: the first directory with a `package.json` or `.git`. In a monorepo, run from the package that has the config or pass `--config`. |
| `--only <ids>` | capture, frame, portfolio, readme, record, all | Comma-separated shot ids, or clip ids for `record`. `readme` and `all` take both. |
| `--langs <codes>` | capture, frame, record, all | Comma-separated languages. |
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
  `http(s)://`). In url mode a path resolves like a relative link from the app's base directory: the target url's
  path, with or without a trailing slash, except that a last segment with a dot (`index.html`, `app.php`) is a file
  and is dropped. With `url: 'https://x.io/app/'` (or `'https://x.io/app'`), `'/docs/'` visits
  `https://x.io/app/docs/` and `'/'` visits the url itself; with `url: 'http://localhost:5173/index.html'`, `'/about'`
  visits `http://localhost:5173/about`. A trailing slash always means a directory, so a dotted one such as `/v1.2/`
  needs it. The url's query and hash are not carried over. In cdp mode a path resolves against the origin of the
  page being captured;
- explicit: `{ click: 'text=Library' }` or `{ goto: '/settings' }`. `goto` also takes what a link would: `'#/settings'`
  and `'?tab=2'` keep the target url's file (`http://h/app/index.html#/settings`), and `'docs/'` or `'../x'` resolve
  from the url as written. Only a leading `/` gets the base directory rule. A protocol-relative `'//host/x'` gets it
  too, so it stays on the target origin instead of visiting another host;
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
| `clips` | `assets/showcase/{lang}/{id}.{ext}` | Terminal clips (tty mode). Also takes `{ext}`, and must end in `.{ext}`. |

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
| `inheritEnv` | `true` | Which of your environment variables the app gets: `true` all of them (see below), `false` or `[]` only the few needed to start a program, an array of names those as well: `['HOME', 'XDG_CONFIG_HOME']`. |
| `cols`, `rows` | `120`, `32` | Terminal size. Never taken from your own terminal. |
| `quitKey` | `'q'` | Sent to quit at the end, before the process tree is killed. `false` just kills. |
| `inputDelayMs` | `300` | Grace after `ready` before the first key (from `setup` or a shot). Keys sent before an app switches its terminal to raw mode are lost. |
| `readyTimeoutMs` | `30000` | How long to wait for the `ready` text (without `ready`, for the app to draw anything). |

The app gets `TERM=xterm-256color`, `COLORTERM=truecolor`, `FORCE_COLOR=3`, `TZ=UTC` and (on macOS and Linux)
`LANG=LC_ALL=en_US.UTF-8`, and does not inherit `NO_COLOR`, `CI`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`,
`WT_SESSION`, `COLUMNS` or `LINES`. `env` overrides any of them.

By default the app also inherits the rest of your environment, tokens and home paths included, and whatever it
prints ends up in a committed image. If it can show its environment, config paths or credentials (a status line
with the user name, an error that dumps a token), set `inheritEnv: false` and pass what it needs through `env`, or
list the names to keep. With `inheritEnv` off the app still gets what a program needs to start: `PATH` on macOS and
Linux, and on Windows `PATH`, `PATHEXT` (to find `.cmd` shims), `SystemRoot` (Node aborts at startup without it)
and `ComSpec` (to run command strings and shims). They are not secrets, but they may reveal paths such as your
user folder. Nothing else is needed for Node or Bun apps: without `HOME` or `USERPROFILE` they still find the home
folder, and without `TEMP`, `TMP` or `TMPDIR` they use the system temp folder (`/tmp`, `C:\Windows\Temp`). A
command string that uses `~`, or a tool that reads `$HOME` for its config (git, XDG apps), needs
`inheritEnv: ['HOME']`. Names match case-insensitively on Windows only, and the CI and terminal hints above stay
out even when listed: set them in `env`.

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

- **Windows:** works through ConPTY. `LANG` has no effect there, so pin the locale in the app. An array `command`
  whose program is a `.cmd` or `.bat` shim (`pnpm`, `npm`) runs through cmd.exe, which cannot pass an argument
  with `"` or `%`: the kit refuses those, so run the program the shim starts directly or use a command string.
- **macOS:** `@lydell/node-pty` ships its spawn helper executable. With the official `node-pty` 1.1.0 a spawn can
  fail with `posix_spawnp failed` (node-pty issue #919) until its `spawn-helper` binary is made executable; prefer
  `@lydell/node-pty`. Fonts rasterize differently from Windows and Linux (the cell grid stays the same).
- **Linux:** `@lydell/node-pty` has prebuilds for x64 and arm64 glibc; Alpine (musl) is untested.
- **Bun:** run the CLI with Node (above). Your app itself can be a Bun app: `command: ['bun', 'run', 'src/index.tsx']`.

### Clips

`clips` records short animated clips of a terminal app, next to the still shots. `showcase record` writes them, and
`showcase all` records them too once `clips` exist:

```js
export default defineConfig({
  name: 'Rumi',
  target: { mode: 'tty', command: ['bun', 'run', 'src/index.tsx'], env: { RUMI_MOCK: '1' } },
  ready: /resources \(\d+\)/,
  frame: { background: '#1e1b4b' },
  shots: [{ id: 'resources', title: 'Resources' }],
  clips: [
    {
      id: 'tour',
      title: 'Tour',
      caption: 'Moving through the resources, then the logs.',
      steps: [{ sleep: 1000 }, { keys: 'jjj' }, { sleep: 800 }, { keys: '{Tab}' }, { waitFor: 'logs' }, { type: 'api', delayMs: 120 }],
    },
  ],
});
```

Each clip starts a fresh app, so it is the same from a clean start every time: the kit waits for `ready`, the
`inputDelayMs` grace and `setup`, runs the steps while it records, then closes the app with `quitKey` (also on a
failure and on Ctrl+C). A failed clip fails alone, like a failed shot.

| Key | Default | Meaning |
| --- | --- | --- |
| `id` | required | File name stem and `{id}` token. Must not repeat a shot id (they share output folders). |
| `title` | `id` | Frame title (`{title}` in `frame.title`) and the README caption. |
| `caption`, `alt` | `title`, `<name>: <title>` | Like a shot's. |
| `steps` | required | The timeline, see below. |
| `fps` | `10` | Frames per second, 1 to 50. |
| `durationMs` | `60000` | Upper bound on the length. |
| `maxFrames` | `300` | Upper bound on the frames, counted after unchanged frames merge. At the limit the kit warns, stops recording and writes what it has. |
| `tailMs` | `1500` | How long to keep recording after the last step. |
| `formats` | `['webp', 'gif']` | Any of `'webp'`, `'gif'`, `'mp4'`. MP4 needs `ffmpeg` on PATH. |

Steps:

| Step | Does |
| --- | --- |
| `{ keys }` | Presses keys, like a shot's `keys`: `'jjj'`, `'{Tab}'`, `['{Down}', '{Enter}']`. |
| `{ type, delayMs? }` | Types text as is (no `{Key}` names): all at once, or one character every `delayMs`. |
| `{ waitFor }` | Waits until the text (a substring or a RegExp) is on screen, for up to `timeouts.shotMs`. |
| `{ sleep }` | Pauses, in milliseconds. |

The clip ends `tailMs` after the last step, at `durationMs` or at `maxFrames`, whichever comes first. The app may exit
during the tail (a CLI that prints and exits, or a last step that quits it): the clip then ends on its last screen.
Exiting before the steps are done fails the clip. Leave the quit key out of the steps, though: most TUIs clear the
screen when they quit, so the clip would end on an empty terminal, and the kit quits the app with `quitKey` after the
tail anyway. Clips go to `outputs.clips`
(default `assets/showcase/{lang}/{id}.{ext}`), framed like the README images: the frame is rendered once per clip
and every frame of the terminal is put into it, so a clip matches the stills next to it. `frame.maxWidth` applies to
clips too.

**How the recording works.** The kit samples the screen on its own clock, once per frame, and runs the steps in
step with that clock, right after a sample. So a key's effect shows from the next frame on, as long as the app
redraws within one frame (100 ms at 10 fps), a `keys` or `type` step takes at least one frame, sleeps are rounded
to whole frames, and `waitFor` looks at the recorded frames. Frames that did not change are merged into one longer
frame, and each distinct screen is rendered once. That makes two things true:

- **Idle time is cheap.** A tail or a pause on an unchanged screen is a single frame, whatever its length or `fps`.
- **Recordings repeat.** On one OS, two recordings of the same clip of an app with a frozen screen give
  byte-identical files. Timing noise in the app can only move a change to a neighbouring frame; it never changes
  the clip's length.

**Formats.** WebP (lossless) and GIF are written by default. GitHub READMEs show both with `<img>`, and
`showcase readme` lists clips after the shots that way (the WebP when there is one). MP4 is opt-in: GitHub is not known to
play a video from the repository inline, so `readme` links to it, and a portfolio site can use `<video>`.

| Format | Encoder | Notes |
| --- | --- | --- |
| WebP | sharp, lossless | Sharp text, full color, alpha. Small when the frame background is a solid color. |
| GIF | sharp, 256 colors per frame | Plays everywhere. Delays are rounded to hundredths of a second on a running total, so the length holds. |
| MP4 | `ffmpeg` from PATH, H.264 CRF 23, 30 fps | Smallest for busy clips. No alpha: a transparent frame background turns black. Odd sides are padded by a pixel. |

Sizes for a 10 s clip of the kit's test TUI (120x32, 9 distinct screens, one key a second), framed, DPR 2
(2496x1696), on Windows:

| Frame | WebP | GIF | MP4 |
| --- | --- | --- | --- |
| default gradient background | 375 KB | 361 KB | 262 KB |
| solid `#1e1b4b` background | 91 KB | 219 KB | 208 KB |
| `style: 'none'`, transparent, no padding or shadow | 80 KB | 148 KB | 184 KB |
| default gradient, `maxWidth: 1200` | 245 KB | 159 KB | 102 KB |

An app whose screen changes on every frame is the other end: the same 10 s with 100 distinct screens was 2.5 MB of
WebP, 11.8 MB of GIF and 7.7 MB of MP4, and took about two minutes to render and encode.

**Keeping clips small and repeatable:**

- Freeze the app (see [What a TUI should offer](#what-a-tui-should-offer)): a spinner or a clock makes every frame
  distinct, which multiplies the size and the time.
- Use a solid `frame.background`: a gradient does not compress losslessly and is most of a quiet clip's WebP.
- Keep `fps` at 10 unless the app animates on purpose; a higher rate only adds frames when the screen changes that
  often. Above 50 fps GIF delays would drop under 20 ms, which browsers play as 100 ms.
- Keep clips short, with a `tailMs` just long enough to read the last screen, and set `durationMs` as a guard.
- For GIF, `deviceScaleFactor: 1` or a `frame.maxWidth` keeps files and encode times down.
- Record on one OS if committed clips must not churn, as with the stills.

**ffmpeg.** Needed only for `'mp4'`, and found on PATH without a shell (`ffmpeg.exe` on Windows). Install it with
`winget install ffmpeg`, `brew install ffmpeg` or `apt install ffmpeg`. When a clip asks for MP4 and there is no
ffmpeg, `record` stops before starting anything and says so. Relative PATH entries (such as `.`) are skipped, so the
binary never depends on the working directory. Ctrl+C while ffmpeg runs stops it and removes its temporary folder, and
an encode that takes over 5 minutes is stopped with an error.

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

`record(config, { only, langs })` records clips, and `encodeAnimation(frames, { format, loop, quality, fps })` is
the encoder behind it: frames of one size as `{ png, delayMs }` in, an animated WebP (lossless, or lossy with
`quality`), a GIF, or an MP4 through `ffmpeg` out. A delay longer than one WebP or GIF frame can hold (65535 ms in
sharp) is split into repeats of the same image, and input it cannot encode is refused with a `ShowcaseError`.

## License

MIT
