# @noctcore/showcase-kit

## 0.1.1

### Patch Changes

- [`f39d6b3`](https://github.com/noctcore/showcase-kit/commit/f39d6b37cb0a6123d3166f3918f3c296c8cfab03) Thanks [@Shironex](https://github.com/Shironex)! - Stopping a started command on Linux and macOS no longer waits the full two second grace period and then sends a needless SIGKILL: it now returns as soon as the process tree has exited on SIGTERM. When the host exits without calling `stop()`, the process group is killed with SIGKILL right away instead of blocking the exit for two seconds.

## 0.1.0

### Minor Changes

- First release: the `showcase` CLI and a typed config API that capture an app's views (url mode in headless Chromium, or cdp mode for Electron and WebView2), frame them into README images, export exact-size 16:9 portfolio images with a gallery JSON, print a README image table, render a hero banner, and generate web, Electron and Tauri icon sets.
