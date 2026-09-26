# @noctcore/showcase-kit

Capture, frame and export showcase images of desktop and web apps for READMEs and portfolios.

One config file describes your app and the views worth showing. The `showcase` CLI drives the app with
[Playwright](https://playwright.dev) (a web app in headless Chromium, an Electron app over the Chrome DevTools
Protocol, or a terminal app in a pseudo terminal) and captures the same pixels on every run.

**Documentation: [noctcore.github.io/showcase-kit](https://noctcore.github.io/showcase-kit/)**

From one config it produces:

- **raw captures**: pixel-exact PNGs at a fixed viewport and device scale factor, in every UI language;
- **framed README images**: each capture in a window frame on a solid or gradient background, as WebP or PNG;
- **portfolio images**: exact-size 16:9 images with the framed window contained, a thumbnail and a gallery JSON;
- **a README table**: an HTML table of the framed images with captions;
- **a hero banner**: logo, name, tagline and a stack of tilted framed shots;
- **terminal clips**: animated WebP and GIF recordings of a terminal app (MP4 opt-in);
- **app icons**: web, Electron or Tauri icon sets from one square image.

## Install

```sh
pnpm add -D @noctcore/showcase-kit playwright
npx playwright install chromium
```

(`npm i -D` and `bun add -d` work the same.) Requires Node 22 or newer and Playwright 1.50 or newer. Terminal
apps also need `@lydell/node-pty`.

## Quick start

```sh
npx showcase init     # writes showcase.config.mjs (--ts for TypeScript, --tty for a terminal app)
# edit the target and the shots
npx showcase all      # capture, frame, and export the portfolio images
npx showcase readme   # print the README table
```

A minimal config for a web app:

```js
// showcase.config.mjs
import { defineConfig } from '@noctcore/showcase-kit';

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

## Documentation

| Page | What it covers |
| --- | --- |
| [Getting started](https://noctcore.github.io/showcase-kit/getting-started/) | Prerequisites, install, `init`, your first images, where the files land |
| [Gallery](https://noctcore.github.io/showcase-kit/gallery/) | Real outputs the kit produced from a fixture app |
| [Web apps](https://noctcore.github.io/showcase-kit/guides/web-apps/) | url mode: start commands, `ready`, shots and `nav`, languages, deterministic captures |
| [Electron](https://noctcore.github.io/showcase-kit/guides/electron/) | cdp mode: attaching to a running Electron app |
| [Tauri](https://noctcore.github.io/showcase-kit/guides/tauri/) | The web build on any OS, or WebView2 over CDP on Windows |
| [Terminal apps](https://noctcore.github.io/showcase-kit/guides/terminal-apps/) | tty mode: TUIs and CLIs in a pseudo terminal |
| [Terminal determinism](https://noctcore.github.io/showcase-kit/guides/terminal-determinism/) | What the kit pins down, and what a TUI should offer |
| [Clips](https://noctcore.github.io/showcase-kit/guides/clips/) | Animated recordings of a terminal app |
| [Frames](https://noctcore.github.io/showcase-kit/guides/frames/) | Window styles, backgrounds, formats and sizes |
| [README table](https://noctcore.github.io/showcase-kit/guides/readme-table/) | `showcase readme` and its options |
| [Portfolio](https://noctcore.github.io/showcase-kit/guides/portfolio/) | Exact-size images, the thumbnail and the gallery JSON |
| [Hero banner](https://noctcore.github.io/showcase-kit/guides/hero/) | The README banner and social preview |
| [Icons](https://noctcore.github.io/showcase-kit/guides/icons/) | Web, Electron and Tauri icon sets |
| [Config reference](https://noctcore.github.io/showcase-kit/reference/config/) | Every config key, its type and default |
| [CLI reference](https://noctcore.github.io/showcase-kit/reference/cli/) | Every command and option |
| [Programmatic API](https://noctcore.github.io/showcase-kit/reference/api/) | Everything the package exports |

## Changelog

Release notes for every version are in [CHANGELOG.md](https://github.com/noctcore/showcase-kit/blob/main/CHANGELOG.md) and on the
[changelog page](https://noctcore.github.io/showcase-kit/changelog/).

## License

MIT
