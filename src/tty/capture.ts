import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { Page } from 'playwright';
import sharp from 'sharp';
import { launchBrowser } from '../browser.js';
import type { CapturedFile } from '../capture.js';
import type { ResolvedTtyConfig, ResolvedTtyShot } from '../config/types.js';
import { ShowcaseError } from '../errors.js';
import { log } from '../log.js';
import { outputPath } from '../paths.js';
import { killTreeSync } from '../process.js';
import { assertNodeRuntime, openTtySession, renderTtyScreen } from './index.js';
import type { OpenTtySession, RenderTtyScreen, TtySession } from './types.js';

/** The engine calls capture needs. A parameter so tests can drive the flow without a PTY. */
export interface TtyEngine {
  openTtySession: OpenTtySession;
  renderTtyScreen: RenderTtyScreen;
}

export interface TtyCaptureResult {
  files: CapturedFile[];
  /** `<lang>/<id>: <message>` for every shot that failed; the others are still written. */
  failures: string[];
}

/** Without `waitFor`, how long to wait for keys or `nav` to change the screen before taking it anyway. */
const CHANGE_WAIT_MS = 1_000;
/** How long a signal waits for open sessions to quit before exiting anyway. */
const SIGNAL_CLOSE_MS = 5_000;

/** Sessions that are open and whose app has not exited, with their quit key, for the signal and exit handlers. */
const open = new Map<TtySession, string | false>();
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
let closingOnSignal = false;

function killOpenSync(): void {
  // Only apps that have not exited are in the set, so these PIDs are still ours. A PID of 0 (a Windows app ConPTY
  // has not connected yet) must never reach a kill: on POSIX it would signal the kit's own process group. Closing
  // such a session kills its terminal synchronously instead.
  for (const session of open.keys()) {
    if (session.pid > 0) killTreeSync(session.pid);
    else session.close({ quitKey: false }).catch(() => {});
  }
  open.clear();
}

const signalHandlers = new Map(
  SIGNALS.map(signal => [
    signal,
    (): void => {
      const code = signal === 'SIGINT' ? 130 : 143;
      if (closingOnSignal) {
        // A second Ctrl+C: stop waiting.
        killOpenSync();
        process.exit(code);
      }
      closingOnSignal = true;
      log.warn(`\nReceived ${signal}, closing the terminal app.`);
      const closing = Promise.allSettled([...open].map(([session, quitKey]) => session.close({ quitKey })));
      const timeout = new Promise(resolve => setTimeout(resolve, SIGNAL_CLOSE_MS));
      void Promise.race([closing, timeout]).finally(() => {
        killOpenSync();
        process.exit(code);
      });
    },
  ]),
);

/** Handlers exist only while a session is open, like the ones for `start` commands in `process.ts`. */
function track(session: TtySession, quitKey: string | false): void {
  if (open.size === 0) {
    process.on('exit', killOpenSync);
    for (const [signal, handler] of signalHandlers) process.on(signal, handler);
  }
  open.set(session, quitKey);
  void session.exited.then(() => untrack(session));
}

function untrack(session: TtySession): void {
  if (!open.delete(session) || open.size > 0) return;
  closingOnSignal = false;
  process.off('exit', killOpenSync);
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
}

function envFor(config: ResolvedTtyConfig, lang: string): Record<string, string> {
  const { env } = config.target;
  if (typeof env !== 'function') return env ?? {};
  const result: unknown = env({ lang });
  if (
    typeof result !== 'object' ||
    result === null ||
    Array.isArray(result) ||
    Object.values(result).some(value => typeof value !== 'string')
  ) {
    throw new ShowcaseError(`target.env({ lang: '${lang}' }) must return an object of string values.`);
  }
  return result as Record<string, string>;
}

export function describePattern(pattern: string | RegExp): string {
  return typeof pattern === 'string' ? JSON.stringify(pattern) : String(pattern);
}

function lastScreen(session: TtySession): string {
  const text = session.screenText().replace(/\n+$/, '');
  return text ? `Last screen:\n${text.replace(/^/gm, '  | ')}` : 'The screen was empty.';
}

/**
 * Wait for text on screen; fail with what the screen showed instead, or with the exit code if the app quit.
 * `what` names the wait in errors, for example `the ready text "x"`.
 */
export async function waitForText(
  session: TtySession,
  pattern: string | RegExp,
  timeoutMs: number,
  what: string,
): Promise<void> {
  let exitCode: number | null | undefined;
  const exited = session.exited.then(code => {
    exitCode = code;
  });
  const found = session.waitForText(pattern, { timeoutMs });
  // If the app exits first, the wait may still reject later; that rejection is expected and already handled.
  found.catch(() => {});
  try {
    await Promise.race([found, exited]);
  } catch (error) {
    throw new ShowcaseError(
      `${what.charAt(0).toUpperCase()}${what.slice(1)} did not appear within ${String(timeoutMs)}ms ` +
        `(${(error as Error).message.split('\n')[0] ?? ''}).\n${lastScreen(session)}`,
    );
  }
  // `exited` can settle before the app's last output is parsed into the grid. A wait with no time left flushes and
  // checks the screen once more, so a CLI that prints and exits at once is still capturable. No output arrives after
  // the exit event: node-pty only reports the exit once the output pipe has closed (on Windows 1 s after the app's
  // last output, after it has exited), so everything the app printed has been delivered by then.
  if (exitCode !== undefined && !(await session.waitForText(pattern, { timeoutMs: 0 }).then(() => true, () => false))) {
    throw new ShowcaseError(
      `The app exited (code ${String(exitCode)}) before ${what} appeared.\n` +
        lastScreen(session),
    );
  }
}

/** Best effort: give the app up to `timeoutMs` to redraw after input. Returns early once the screen changes. */
async function waitForChange(session: TtySession, before: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && session.screen().key === before) await session.sleep(25);
}

export async function startSession(
  config: ResolvedTtyConfig,
  lang: string,
  engine: TtyEngine,
): Promise<TtySession> {
  const { target } = config;
  const label = typeof target.command === 'string' ? target.command : target.command.join(' ');
  log.info(`Starting \`${label}\` (${String(target.cols)}x${String(target.rows)}, ${lang})`);
  const session = await engine.openTtySession({
    command: target.command,
    cwd: target.cwd,
    env: envFor(config, lang),
    inheritEnv: target.inheritEnv,
    cols: target.cols,
    rows: target.rows,
  });
  track(session, target.quitKey);
  try {
    if (config.ready !== undefined) {
      await waitForText(session, config.ready, target.readyTimeoutMs, `the ready text ${describePattern(config.ready)}`);
    } else {
      // Without `ready`, at least wait for the first drawing: a capture of a blank screen would fail silently.
      await waitForText(session, /\S/, target.readyTimeoutMs, 'any text (no ready is set)');
    }
    // Keys sent before the app switches to raw mode are lost (the terminal is still in line mode).
    await session.sleep(target.inputDelayMs);
    await config.setup?.({ tty: session, lang, mode: 'tty', config });
    return session;
  } catch (error) {
    await closeSession(config, session);
    throw error;
  }
}

export async function closeSession(config: ResolvedTtyConfig, session: TtySession): Promise<void> {
  try {
    await session.close({ quitKey: config.target.quitKey });
  } finally {
    untrack(session);
  }
}

async function shoot(
  config: ResolvedTtyConfig,
  session: TtySession,
  page: Page,
  shot: ResolvedTtyShot,
  lang: string,
  engine: TtyEngine,
): Promise<CapturedFile> {
  const before = session.screen().key;
  if (shot.keys !== undefined) await session.press(shot.keys);
  else if (shot.nav) await shot.nav(session);
  if (shot.waitFor !== undefined) {
    await waitForText(
      session,
      shot.waitFor,
      config.timeouts.shotMs,
      `the waitFor text ${describePattern(shot.waitFor)}`,
    );
  } else if (shot.keys !== undefined || shot.nav) {
    await waitForChange(session, before, CHANGE_WAIT_MS);
  }
  if (shot.delayMs > 0) await session.sleep(shot.delayMs);

  const png = await engine.renderTtyScreen(page, session.screen(), config.terminal, config.deviceScaleFactor);
  const path = outputPath(config, config.outputs.raw, lang, shot.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png);
  const { width = 0, height = 0 } = await sharp(png).metadata();
  log.info(`  ok    ${lang}/${shot.id}  ${String(width)}x${String(height)}  ${relative(process.cwd(), path)}`);
  return { lang, id: shot.id, path, width, height };
}

/**
 * Capture tty shots: one app process per language (plus one per `restart`), shots in order, each screen rendered
 * to a raw PNG in the kit's Chromium. Every session is closed on success, on failure and on Ctrl+C.
 */
export async function captureTty(
  config: ResolvedTtyConfig,
  shots: ResolvedTtyShot[],
  langs: string[],
  engine: TtyEngine = { openTtySession, renderTtyScreen },
): Promise<TtyCaptureResult> {
  // Fail before a browser starts: under the Bun runtime the PTY package kills the app at once.
  assertNodeRuntime();
  const files: CapturedFile[] = [];
  const failures: string[] = [];
  const browser = await launchBrowser(config);
  try {
    // The renderer sizes the page itself but cannot change the device scale factor of a context.
    const context = await browser.newContext({ deviceScaleFactor: config.deviceScaleFactor });
    const page = await context.newPage();
    for (const lang of langs) {
      let session: TtySession | undefined;
      try {
        for (const shot of shots) {
          if (session && shot.restart) {
            await closeSession(config, session);
            session = undefined;
          }
          session ??= await startSession(config, lang, engine);
          try {
            files.push(await shoot(config, session, page, shot, lang, engine));
          } catch (error) {
            const message = (error as Error).message;
            failures.push(`${lang}/${shot.id}: ${message}`);
            log.error(`  FAIL  ${lang}/${shot.id}: ${message}`);
          }
        }
      } finally {
        if (session) await closeSession(config, session);
      }
    }
  } finally {
    await browser.close();
  }
  return { files, failures };
}
