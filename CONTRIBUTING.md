# Contributing

Thanks for looking. This file covers what is not obvious from the code: the toolchain, the order
the commands run in, how a config key travels from the types to the docs, and the rules that keep
the tests deterministic on three operating systems. Everything here was read from the tree and
every command was run. If this file and the tree ever disagree, the tree is right and this file has
a bug.

If you only want to report something, skip to [Reporting](#reporting): the issue forms ask for
exactly what is needed to act.

## Setup

Requirements:

- [Bun](https://bun.sh) **1.4.2**, the `packageManager` in `package.json` and the version CI pins.
  Use that version: another Bun can resolve differently and rewrite `bun.lock`. If an install
  changed `bun.lock` although you did not add or bump a dependency, run `git checkout -- bun.lock`,
  check `bun --version`, and install again with `bun install --frozen-lockfile`.
- **Both lockfiles stay at `lockfileVersion: 1` on purpose.** Bun 1.4 writes version 2 for a new
  lockfile, but Dependabot's bun updater still bundles Bun 1.3, which reads only version 1 and fails
  every update run on a version 2 file
  ([dependabot-core#16026](https://github.com/dependabot/dependabot-core/issues/16026)). Versions 1
  and 2 hold the same content, and Bun 1.4 keeps the version a lockfile was loaded with, so
  installs, `bun add` and `bun update` leave them at 1. Never delete a `bun.lock` to regenerate it:
  that writes version 2, and `test/lockfile-version.test.ts` fails. Version 1 skips two checks
  version 2 makes while parsing (an npm tarball outside the default registry must carry an
  integrity hash, a git dependency's resolved tag must be a safe path), so review lockfile diffs
  for tarball URLs and git dependencies. Once Dependabot runs a Bun that reads version 2
  ([dependabot-core#16071](https://github.com/dependabot/dependabot-core/pull/16071)), set the field
  to 2 in both lockfiles and update that test, this paragraph and `.github/dependabot.yml`.
- **Node 22 or newer** (`engines`). The tests run on Node, not on the Bun runtime (see below).
- **Playwright's Chromium.** `playwright` is a devDependency pinned to an exact version; download
  the browser that version expects once:

  ```sh
  bunx playwright install chromium
  ```

  On Linux, CI adds `--with-deps` to install the system libraries Chromium needs.
- **The pseudo terminal package** for terminal app capture. For users it is an optional peer
  (`@lydell/node-pty`, or `node-pty`); here it is a devDependency pinned to `1.2.0-beta.15`, so
  `bun install` brings it. It has no install scripts: the binary for your platform comes as an
  optional dependency (darwin, linux and win32, x64 and arm64).
- **ffmpeg** (optional). The MP4 tests run only when `ffmpeg` is on `PATH`
  (`it.runIf(findExecutable('ffmpeg') !== undefined)`); without it they are skipped, not failed.

`bunfig.toml` sets `minimumReleaseAge` to 7 days: Bun will not resolve a version published less
than a week ago. If you add or bump a dependency and Bun refuses the version you asked for, check
its publish date before anything else.

**Why Node and not Bun runs terminal captures.** Under the Bun runtime the PTY package kills its
child at once, so `assertNodeRuntime` in `src/tty/pty.ts` refuses to start a terminal session
there. `bun run test` is fine: it runs the `vitest` binary, which is a Node script, so the tests run
on Node. Do not add `--bun` (`bunx --bun vitest`); the terminal tests would stop with "run with
node". One test (`tty-session.test.ts`) runs a script under Bun on purpose to check that refusal,
so `bun` has to be on `PATH`.

## Commands

```sh
bun install --frozen-lockfile
bun run build       # tsup: dist/index.js, dist/cli.js, dist/index.d.ts, and the terminal fonts
bun run typecheck   # tsc --noEmit over src/, test/ and the two config files
bun run test        # bun run build, then vitest run: every test file, one at a time
```

CI (`.github/workflows/ci.yml`, on `ubuntu-24.04`, `windows-latest` and `macos-latest`) runs the
same steps: `bun install --frozen-lockfile`, `bunx playwright install --with-deps chromium`,
`bun run typecheck` and `bun run test`, which does the build.

The docs site under `site/` is its own package with its own `bun.lock`, not a workspace (a root
`workspaces` field would make changesets stop versioning the published package). It reads the built
`dist/`, so run it after the root install and build:

```sh
bun install --frozen-lockfile --cwd site
bun run --cwd site test        # link checker, changelog parser, reference drift tests
bun run --cwd site typecheck
bun run docs:build             # generate the changelog and reference, build, check every link and anchor
bun run docs:dev               # the site on a local dev server
```

`.github/workflows/docs.yml` runs the same on pull requests that touch `site/`, `src/`, `CHANGELOG.md`,
`.changeset/` or the package files, and deploys `main` to GitHub Pages.

- **`build`** writes `dist/` with tsup and copies `src/tty/fonts` to `dist/fonts`, where the
  terminal renderer looks for JetBrains Mono. Most of its time is the declaration build.
- **`typecheck`** does not need `dist/`: the tests import from `../src`.
- **`test`** builds first because two test files run the built package: `test/cli.test.ts` spawns
  `dist/cli.js`, and one test in `test/capture-tty.test.ts` imports `dist/index.js` and runs
  `dist/cli.js all`. Without a build, `cli.test.ts` stops with
  `dist/cli.js is missing: run \`bun run build\` first`.

The full suite takes a few minutes. On an Apple Silicon Mac, `bun run test` took 137 s: 13 s of
build and 119 s of Vitest, for 20 files and 233 tests (231 passed, 2 skipped: they run only on
Windows). Most of that time is the end-to-end files, which launch Chromium, run the fixture TUI in a
real pseudo terminal, or both. `vitest.config.ts` runs one file at a time (`fileParallelism: false`,
so Chromium instances do not fight over the CPU) and gives each test and hook 120 s.

For a tighter loop, run one file, or one test by name:

```sh
bunx vitest run test/config.test.ts                      # the config resolver, well under a second
bunx vitest run test/config-tty.test.ts -t inheritEnv    # the tests whose name matches
bunx vitest run test/tty-session.test.ts                 # a real pty and the fixture TUI, a few seconds
```

Run `bun run build` first when the file is `cli.test.ts` or `capture-tty.test.ts`, or when you
changed `src/` since the last build.

There is no linter or formatter configured for this repository. Match the file you are in:
two-space indent, single quotes, semicolons, trailing commas, arrow functions without parentheses
around a single parameter (`item => item.trim()`), code and comments wrapped near 120 columns. The
TypeScript settings are strict (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), and
imports inside `src/` use the `.js` extension.

## Repository layout

One published package, `@noctcore/showcase-kit`: an ESM library (`src/index.ts`) and the `showcase`
CLI (`src/cli.ts`), both built by tsup into `dist/`.

| Path | What it holds |
| --- | --- |
| `src/cli.ts` | The `showcase` command: argument parsing, the command table, `all` |
| `src/init.ts` | `showcase init`: the starter config, with `--tty` for a terminal app |
| `src/config/types.ts` | Every config type users write (`WebConfig`, `TtyConfig`, `Shot`, `Clip`...) and its resolved form, with JSDoc |
| `src/config/validate.ts` | Small validators (`str`, `num`, `bool`, `oneOf`, `color`, `pathTemplate`...) that report into `Issues` |
| `src/config/resolve.ts` | `resolveConfig`: validates a config, fills every default; url and cdp mode and the shared keys |
| `src/config/tty.ts`, `src/config/clips.ts` | The tty mode keys and terminal look; terminal clips |
| `src/config/load.ts`, `src/config/define.ts` | Finding and importing `showcase.config.*`; `defineConfig` |
| `src/capture.ts`, `src/browser.ts` | url and cdp capture with Playwright; launching Chromium |
| `src/process.ts` | `target.start`: spawning the command and killing its whole process tree |
| `src/paths.ts`, `src/template.ts` | Output paths from `{lang}`, `{id}`, `{slug}` templates; `--only` and `--langs`; `nav` URL resolution |
| `src/tty/` | The terminal engine: key parsing, the PTY, the headless xterm session, themes, the screen renderer, tty capture, and the bundled JetBrains Mono (`fonts/`, with its OFL license) |
| `src/record.ts`, `src/encode.ts` | `showcase record`: terminal clips on a frame clock; animated WebP and GIF with sharp, MP4 with ffmpeg |
| `src/frame/` | Framing raw captures into README images (window, minimal, none) |
| `src/portfolio.ts`, `src/hero.ts`, `src/readme.ts`, `src/icons.ts` | Portfolio export and gallery JSON, the hero banner, the README image table, icon sets |
| `src/errors.ts`, `src/log.ts` | `ShowcaseError` (printed without a stack) and `ConfigError`; the logger behind `--verbose` and `--quiet` |
| `test/*.test.ts` | Vitest suites, one or more per module |
| `test/helpers.ts` | Temp dirs, free ports, the in-process fixture server, the fixture config |
| `test/fixtures/` | The fixture web app (`app/index.html`, served by `static-server.mjs`, or by `serve.mjs` as a `target.start` command), the fixture TUI (`tui.mjs`), a busy counter for clips (`counter.mjs`), and a CLI that prints and exits (`print-exit.mjs`) |
| `site/` | The docs site (Astro and Starlight) at https://noctcore.github.io/showcase-kit/: hand-written guides in `site/src/content/docs/guides/`, the config, CLI and API reference generated from `src/` on every build (`site/scripts/reference/`), the changelog page and Atom feed generated from `CHANGELOG.md` (`site/scripts/changelog/`), and the gallery of real outputs (`site/gallery/`, regenerated with `bun run docs:gallery`) |

## Adding or changing a config key

A key touches six places. Take `target.inheritEnv` (commit `91bf1f5`) as the model: it went through
all of them in one commit, and its changeset followed.

1. **The type, with JSDoc.** Add the key to the user-facing interface in `src/config/types.ts`
   (`TtyTarget` for `inheritEnv`) with a JSDoc comment that says what it does, and its default as an
   `@default` tag. That comment is the text users read (see step 5). Add it to the resolved type
   (`ResolvedTtyTarget`), where it is no longer optional. If the terminal engine takes it too, add it
   to `src/tty/types.ts`.
2. **Validation and the key lists.** Resolve it in the function for its section: `resolve.ts` for
   url and cdp mode and the shared keys, `tty.ts` for tty mode, `clips.ts` for clips. Use the helpers
   in `validate.ts`, or write a small function in the same style (`inheritEnv` in `tty.ts`): report a
   problem with `issues.add(path, message)` and return a fallback, so one run lists every problem
   instead of stopping at the first. Then add the key to the list its section passes to `checkKeys`,
   or it is reported as an unknown key. If the key belongs to one mode only, also add it to the map of
   keys the other mode names (`TTY_TARGET_KEYS`, `WEB_TARGET_KEYS`, `TTY_SHOT_KEYS`, `WEB_ONLY_KEYS`,
   `TTY_ONLY_KEYS`, `TTY_TIMEOUT_KEYS` in `tty.ts`), so a url config that sets it says "only used in
   tty mode" instead of "unknown key".
3. **Use it** where it acts (`src/tty/pty.ts` and `src/tty/capture.ts` for `inheritEnv`).
4. **Tests.** In `test/config.test.ts` or `test/config-tty.test.ts`: the default in the resolved
   config, each accepted form, and each rejected form with the exact message. Some tests there compare
   whole resolved objects or count every issue a bad config produces, so they change with a new key.
   Then a test of the behaviour itself, next to the other tests of that module (`inheritEnv` added one
   to `tty-session.test.ts` that runs a real child and checks a variable does not reach it).
5. **Docs.** The config reference on the docs site is generated from the JSDoc in step 1 on every
   build, so there is no table to edit by hand. The site's tests (`bun run --cwd site test`) fail when a
   key the validator accepts is missing from the reference, or when a literal `@default` differs from
   what `resolveConfig` fills in. If the key changes how something works, also update the guide that
   explains it under `site/src/content/docs/guides/`.
6. **A changeset** (see [Changesets](#changesets)).

If every new project should see the key, `src/init.ts` writes the starter configs; most keys do not
belong there.

## Determinism

The kit exists to give the same pixels for the same config on every run on a machine. The tests
hold themselves to the same rule, on Linux, Windows and macOS:

- **Nothing leaves the machine.** Web tests serve `test/fixtures/app` from `127.0.0.1` on a free
  port (`serveFixture` and `freePort` in `test/helpers.ts`). No test may depend on the network.
- **Nothing is written into the repository.** Every test that writes files does it in a fresh
  directory from `tempDir()`, under the OS temp directory.
- **Fixtures have no clock and no randomness.** The fixture app and TUI draw fixed content; the TUI
  changes behaviour only through environment variables (`TUI_GRANDCHILD`, `TUI_IGNORE_QUIT`,
  `TUI_APP_CURSOR`, `TUI_SPLIT_MS`, `TUI_REDRAW_MS`). A new fixture follows the same rule. The kit
  itself gives terminal apps `TZ=UTC`, a fixed `TERM`, `COLORTERM`, `FORCE_COLOR`, `LANG` and
  `LC_ALL`, and strips `CI`, `NO_COLOR` and other terminal hints (`ttyEnv` in `src/tty/pty.ts`).
- **No golden images.** Fonts rasterize differently on macOS than on Windows and Linux, so tests
  check image sizes computed from the layout (the comment next to each expected size shows the
  arithmetic), the colour of chosen pixels with a tolerance, file lists and screen text. They never
  compare a whole image with a stored one.
- **Time bounds are generous.** A test that asserts something happened quickly bounds it loosely,
  because CI runners on Windows are slow: the test that a session opens before Windows reports a PID
  only requires it to beat the old 10 s wait by half (`toBeLessThan(5_000)`, widened in `2b638d5`).
  A tight bound is a flaky test.
- **No process is left behind.** Tests that start processes check the whole tree is gone afterwards
  (`isAlive` in `test/helpers.ts`), including a grandchild the fixture starts on purpose.
- **Flow tests use a fake.** Where the order of events matters more than a real terminal
  (restarts, closing, Ctrl+C), the tests drive a scripted stand-in for the engine (`FakeSession` in
  `test/capture-tty.test.ts`, the fake PTY in `test/tty-session.test.ts`) instead of timing a real
  app.
- **A test is not coverage until it has failed.** Break the code it guards once and watch it go
  red before you trust it. Commits such as `614845d` (make the esc and after-exit session tests
  discriminate) exist only because a passing test did not.

## Platform notes

CI runs on Linux, Windows and macOS.

- **Paths.** Build paths with `node:path` (`join`, `resolve`), never with `/` in a string, and turn
  a path into an import URL with `pathToFileURL`. On Windows `\tools` is absolute but relative to the
  current drive; `resolve` pins it (see `findExecutable` in `src/encode.ts` and its drive-relative
  test).
- **Environment names.** Windows variable names are case-insensitive: `Path` and `PATH` are one
  variable. Code that reads or filters the environment folds the case on Windows (`ttyEnv`,
  `findExecutable`).
- **`.cmd` and `.bat` shims.** `pnpm`, `npm` and friends are shims on Windows and cannot be spawned
  directly. `target.start` and a string `command` go through the shell on every platform; an array
  `command` whose program is a shim goes through `cmd.exe` with each argument quoted by `cmdQuote` in
  `src/tty/pty.ts`, which refuses `"`, `%` and line breaks (cmd.exe cannot pass them) and leaves
  simple arguments (including `~` paths) unquoted. Any change there needs the tests in
  `tty-session.test.ts`, one of which runs a real shim and only runs on Windows.
- **Killing process trees.** POSIX kills the process group (the child is spawned detached);
  Windows runs `taskkill /PID <pid> /T /F`, by PID, never by image name. Once a child has exited its
  PID can be reused, so code never kills a PID it has seen exit.
- **Windows-only and POSIX-only tests** use `it.runIf(process.platform === 'win32')` and its
  opposite, so each runs where it means something and is reported as skipped elsewhere.

## Changesets

Every change to the published package needs a changeset in `.changeset/`. `bun run changeset`
asks for the bump (patch is the default) and a summary, or write the file by hand:

```md
---
"@noctcore/showcase-kit": patch
---

Terminal apps: `target.inheritEnv` controls which of your environment variables the app gets (...)
```

The body becomes the `CHANGELOG.md` entry, through `@changesets/changelog-github`, which adds the
commit link and the author. Write it for someone reading the changelog before they upgrade: what
changed in the words of the config, the new default, and what they have to do, if anything. Do not
describe the diff.

What each bump has meant here (`CHANGELOG.md` and `git log -- .changeset`):

- **minor**: a new feature (terminal apps, terminal clips), a new config option
  (`outputs.readme: false`, `outputs.portfolio.gallery`), and a change of behaviour a config can
  notice: in 0.2.0 a `nav` path that starts with `/` resolves under the target url's path instead of
  its origin, and its changelog entry tells affected configs what to change. Type changes that make
  consumer code narrow (`ShowcaseConfig` becoming `WebConfig | TtyConfig`) went out in a minor too.
- **patch**: a fix that changes nothing a working config relies on (the faster POSIX stop in 0.1.1),
  and a new option whose default keeps the old behaviour (`target.inheritEnv`, which defaults to
  `true`).
- **major**: never used. The package is `0.x`, where a minor is allowed to break and has done so
  with a loud changelog entry. Ask before you are the first to write a major.

Releases are two-phase and automatic (`.github/workflows/release.yml`): changesets merged to `main`
open a "Version Packages" pull request, and merging that publishes to npm with provenance through
trusted publishing. You never bump the version yourself, and you never rewrite an entry in
`CHANGELOG.md`. The one edit it takes by hand is an alert block that calls out a change needing action
from users; `.changeset/README.md` says when and where.

## Commits and pull requests

Branch from `main`. Commits follow conventional commits, always with a scope, in lowercase:
`type(scope): summary`. The scope is the module the change is about, as the history uses them:
`tty`, `record`, `encode`, `capture`, `config`, `process`, `frame`, `portfolio`, `hero`, `readme`,
`icons`, `init`, `cli`, `api`; plus `changeset` for a changeset on its own and `deps` or `package`
for dependencies and packaging. For example `fix(tty): pass shim arguments with a tilde unquoted,
like 8.3 short paths`. One logical change per commit.

The pull request template asks for a changeset, the gates you actually ran, docs and JSDoc for a
new or changed config key, and deterministic tests. CI runs `typecheck` and `test` on Linux,
Windows and macOS on every pull request.

## Reporting

Use the issue forms; each asks for what that kind of report needs:

- **Capture problem**: a web app, Electron or Tauri capture that fails, times out or shows the wrong
  view. The config, the command, and the versions of the kit, Playwright, Node and the OS.
- **Terminal app problem**: tty mode or clips. The app, the PTY package and its version, the
  terminal size, the keys.
- **Wrong or broken output**: a file was written but is wrong (frame, portfolio, hero, README table,
  clip, icons).
- **Crash or install problem**: an exception with a stack trace, or the package fails to install or
  load.
- **Feature request**: something the kit does not do yet.

Security problems do not go in an issue: see [SECURITY.md](SECURITY.md).
