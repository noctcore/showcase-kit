# Security

This file says what a vulnerability in showcase-kit can be, what is not one, and where to send a
report.

## The trust model

showcase-kit runs on a developer's machine or in CI, with that user's privileges, against the
user's own app. Two things it takes are **trusted by design**, because they are code:

- **The config file.** `showcase.config.{ts,mts,mjs,js}` is imported as a JavaScript module
  (`src/config/load.ts`). It can do anything a script can, and its `setup` and `nav` functions run
  with the page or the terminal session in hand.
- **The commands it starts.** `target.start` (url and cdp mode) and a string `target.command` (tty
  mode) run through the shell, as the user would type them. An array `command` is spawned directly.

So "a config can run a command" is not a finding. The kit's job is to do exactly what the config
says and nothing else. What it must not do is let **data** act like code: the screen of the app it
captures, the text a terminal app prints, the arguments of an array command, the ids and languages
that fill a path template.

## What counts

- **App output that escapes into the renderer.** A terminal app's screen text is untrusted: the app
  may print data from anywhere. It is rendered into an HTML page in the kit's own Chromium
  (`src/tty/render.ts`, which escapes it). Screen text that becomes markup, runs script, loads a URL
  or reads a file is a vulnerability. The same holds for the frame, hero and README table templates
  (`escapeHtml` in `src/frame/template.ts`) and for config colours, which are checked to contain only
  colour syntax so a colour cannot become `url()` (`color` in `src/config/validate.ts`).
- **Arguments that turn into commands.** An array `command` whose program is a Windows `.cmd` or
  `.bat` shim runs through `cmd.exe` with each argument quoted (`cmdQuote` in `src/tty/pty.ts`);
  arguments with `"`, `%` or a line break are refused and `!` is kept literal with `/v:off`. An
  argument that gets past this and runs a second command, expands a variable or changes the
  arguments the program receives is a vulnerability.
- **Environment that leaks into a committed image.** With `target.inheritEnv: false` or a list of
  names, a terminal app gets only those variables plus what the platform needs to start a program
  (`PATH`; on Windows also `PATHEXT`, `SystemRoot` and `ComSpec`), then the kit's fixed ones
  (`ttyEnv` in `src/tty/pty.ts`). The screen becomes an image people commit, so a variable that
  reaches the app despite that setting is a vulnerability. The default, `true`, passes the whole
  environment on purpose and says so in its documentation.
- **Files written outside the path templates.** Output paths come from templates in the config
  (`outputs.*`, `hero.output`) filled with `{lang}`, `{id}`, `{slug}` and `{ext}`. The template is the
  author's and may point anywhere, a sibling portfolio repository for example. The values are
  checked to be letters, digits, `-` and `_` (`ID` in `src/config/validate.ts`), and `--only` and
  `--langs` accept only ids and languages the config declares. A value that puts a separator or `..`
  into a path, or any other way to make the kit write where no template points, is a vulnerability.
  So is a temporary folder (the MP4 encoder's, from `mkdtemp`) that another local user can read or
  replace.
- **An `ffmpeg` that is not the one on PATH.** For MP4 the kit looks `ffmpeg` up in absolute `PATH`
  entries only, spawns it without a shell, and on Windows accepts only `ffmpeg.exe`
  (`findExecutable` in `src/encode.ts`). A lookup that can run a file from the working directory or
  from a relative `PATH` entry is a vulnerability. Someone who controls your `PATH` already controls
  your shell; that is not.
- **The published package.** Releases publish from `.github/workflows/release.yml` through npm
  trusted publishing with provenance, and every action in the workflows is pinned to a commit SHA. A
  tarball on npm that does not match the tagged source, or a way to make the release workflow
  publish something else, is a vulnerability.

## What does not count

- **Anything the config or a start command does.** They are your code (see the trust model).
- **Secrets your app shows on screen.** The kit captures what the app draws. Keeping tokens out of
  the demo data is the config author's job; `inheritEnv` is there to help with the environment, and
  a web app's `target.start` gets your environment merged with `target.env`, like any dev server you
  start by hand.
- **An open DevTools port.** In cdp mode the kit connects to the endpoint in `target.cdpUrl`
  (default `http://127.0.0.1:9222`); it never opens one. While your app runs with
  `--remote-debugging-port`, any local process can control it, with or without the kit. Bind it to
  `127.0.0.1` and close the app when the capture is done.
- **Bugs in Chromium, Playwright, node-pty or ffmpeg.** Report those upstream. If the kit's
  dependency or peer range forces a vulnerable version on you, that is a normal issue or a pull
  request: the advisory is already public.
- **Advisories in the dev toolchain** (`tsup`, `vitest`, the changesets CLI, `typescript`). None of
  it ships in `dist/`. Send them as a normal issue or a pull request that bumps the lockfile.

## Reporting

Use GitHub's private vulnerability reporting for this repository:
<https://github.com/noctcore/showcase-kit/security/advisories/new>. It opens a draft advisory that
only the maintainer can see.

If that page says reporting is not enabled, the setting has not been switched on yet. Open a regular
issue whose entire body is "security report, need a private channel", with no details, and the
maintainer will reply with one. Do not put the finding in a public issue.

Include the version, your platform, the config or input that triggers it, and what it does. There
is no bounty. You will get a reply from the maintainer, a fix as a `patch` release with a changelog
entry that credits you unless you ask otherwise, and the details published once the fix is on npm.

## Supported versions

Only the latest release. The package is `0.x`; fixes ship forward, never as a backport.
