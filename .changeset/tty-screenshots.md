---
"@noctcore/showcase-kit": minor
---

Terminal apps: `target.mode: 'tty'` runs a TUI or CLI in a pseudo terminal and captures its screen into the same raw, framed, portfolio, hero and README outputs as web apps. Shots press `keys` (or run a `nav` function with the terminal session), wait for `waitFor` text and can `restart` the app; `ready` is text on screen; a new `terminal` block sets the theme, font, line height, padding and cursor, with JetBrains Mono bundled. Web-only keys (`viewport`, `colorScheme`, `css`) are rejected in tty mode and tty-only keys in url and cdp mode. `showcase init --tty` writes a starter config. Needs `@lydell/node-pty` (or `node-pty`) as an optional peer and Node, not the Bun runtime.

Types: `ShowcaseConfig` is now `WebConfig` or `TtyConfig` (`defineConfig` picks one from `target.mode`), and `ResolvedConfig` is `ResolvedWebConfig | ResolvedTtyConfig`; narrow with `isTtyConfig(config)` before reading web-only fields such as `viewport`.
