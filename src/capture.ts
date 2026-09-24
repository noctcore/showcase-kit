import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import sharp from 'sharp';
import { launchBrowser, loadPlaywright } from './browser.js';
import type { CdpTarget, ResolvedConfig, ResolvedShot, UrlTarget } from './config/types.js';
import { ShowcaseError } from './errors.js';
import { log } from './log.js';
import { outputPath, select } from './paths.js';
import { answers, startCommand, waitForUrl, type StartedProcess } from './process.js';

export interface CaptureOptions {
  /** Shot ids to capture. Default: all. */
  only?: string[];
  /** Languages to capture. Default: all in the config. */
  langs?: string[];
}

export interface CapturedFile {
  lang: string;
  id: string;
  path: string;
  width: number;
  height: number;
}

export interface CaptureResult {
  files: CapturedFile[];
  /** PID of the `start` command, if one was spawned (it is stopped before capture returns). */
  startedPid?: number;
}

// Transitions would still be running when the shutter fires after a click; the caret blinks.
const DETERMINISM_CSS = `*, *::before, *::after {
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
}`;

interface Session {
  config: ResolvedConfig;
  baseUrl: () => string;
  /** Write a PNG of the page's viewport at device pixels. */
  screenshot: (page: Page, path: string) => Promise<void>;
}

/** Playwright's own screenshot, which disables animations and hides the caret itself. */
async function playwrightScreenshot(page: Page, path: string): Promise<void> {
  await page.screenshot({ path, type: 'png', animations: 'disabled', caret: 'hide', scale: 'device' });
}

/** Capture raw screenshots of every selected shot in every selected language. */
export async function capture(config: ResolvedConfig, options: CaptureOptions = {}): Promise<CaptureResult> {
  const selection = select(config, options.only, options.langs);
  let started: StartedProcess | undefined;
  try {
    started = await startTarget(config);
    const files =
      config.target.mode === 'url'
        ? await captureUrl(config, config.target, selection.shots, selection.langs)
        : await captureCdp(config, config.target, selection.shots, selection.langs);
    return { files, startedPid: started?.pid };
  } finally {
    await started?.stop();
  }
}

async function startTarget(config: ResolvedConfig): Promise<StartedProcess | undefined> {
  const { target } = config;
  const probe = target.mode === 'url' ? target.url : cdpVersionUrl(target);
  if (!target.start) {
    if (probe && !(await answers(probe))) {
      throw new ShowcaseError(
        `${probe} is not answering. Start the app first, or set target.start to a command that starts it.`,
      );
    }
    return undefined;
  }
  if (target.mode === 'url' && target.reuseExisting !== false && (await answers(target.url))) {
    log.info(`${target.url} already answers, reusing it (set target.reuseExisting: false to always start).`);
    return undefined;
  }
  log.info(`Starting \`${target.start}\``);
  const started = startCommand(target.start, { cwd: target.cwd ?? config.root, env: target.env });
  if (probe) {
    try {
      await waitForUrl(probe, { timeoutMs: target.readyTimeoutMs, process: started });
    } catch (error) {
      await started.stop();
      throw error;
    }
  }
  return started;
}

/** The HTTP endpoint that tells whether a CDP server is up, or undefined for a bare ws:// URL. */
function cdpVersionUrl(target: CdpTarget): string | undefined {
  const url = target.cdpUrl ?? '';
  return /^https?:/.test(url) ? `${url.replace(/\/+$/, '')}/json/version` : undefined;
}

async function captureUrl(
  config: ResolvedConfig,
  target: UrlTarget,
  shots: ResolvedShot[],
  langs: string[],
): Promise<CapturedFile[]> {
  const browser: Browser = await launchBrowser(config);
  const files: CapturedFile[] = [];
  const failures: string[] = [];
  try {
    for (const lang of langs) {
      const context = await browser.newContext({
        viewport: config.viewport,
        deviceScaleFactor: config.deviceScaleFactor,
        colorScheme: config.colorScheme,
        reducedMotion: 'reduce',
        locale: lang,
      });
      try {
        const page = await context.newPage();
        await page.goto(target.url, { waitUntil: 'load', timeout: config.timeouts.readyMs });
        await runSetup(config, page, context, lang);
        const session: Session = { config, baseUrl: () => target.url, screenshot: playwrightScreenshot };
        await shootAll(session, page, shots, lang, files, failures);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  throwOnFailures(failures, files);
  return files;
}

async function captureCdp(
  config: ResolvedConfig,
  target: CdpTarget,
  shots: ResolvedShot[],
  langs: string[],
): Promise<CapturedFile[]> {
  const { chromium } = await loadPlaywright();
  const cdpUrl = target.cdpUrl ?? '';
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: config.timeouts.readyMs });
  const files: CapturedFile[] = [];
  const failures: string[] = [];
  try {
    const page = await pickPage(browser, target, config.timeouts.readyMs);
    log.info(`Attached to ${page.url()}`);
    const context = page.context();
    const cdp = await context.newCDPSession(page);
    // The app's window decides its own size; override it so every machine produces the same pixels.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: config.viewport.width,
      height: config.viewport.height,
      deviceScaleFactor: config.deviceScaleFactor,
      mobile: false,
    });
    await page.emulateMedia({ colorScheme: config.colorScheme, reducedMotion: 'reduce' });
    try {
      for (const lang of langs) {
        await runSetup(config, page, context, lang);
        const session: Session = {
          config,
          baseUrl: () => page.url(),
          // Playwright sizes screenshots of a connected page by its own idea of the device scale factor,
          // which ignores the override above; Chromium's own capture honours it.
          screenshot: async (target, path) => {
            await freezeAnimations(target);
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
            await writeFile(path, Buffer.from(data, 'base64'));
          },
        };
        await shootAll(session, page, shots, lang, files, failures);
      }
    } finally {
      // Leave the app as we found it: it is someone's running window, not ours.
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await page.emulateMedia({ colorScheme: null, reducedMotion: null }).catch(() => {});
      await cdp.detach().catch(() => {});
    }
  } finally {
    // For a CDP connection this disconnects; it does not close the app.
    await browser.close();
  }
  throwOnFailures(failures, files);
  return files;
}

async function pickPage(browser: Browser, target: CdpTarget, timeoutMs: number): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pages = browser.contexts().flatMap(context => context.pages());
    const candidates = pages.filter(page => !page.url().startsWith('devtools://'));
    const { pageMatch } = target;
    const match =
      pageMatch === undefined
        ? candidates[0]
        : candidates.find(page =>
            typeof pageMatch === 'string' ? page.url().includes(pageMatch) : pageMatch.test(page.url()),
          );
    if (match) return match;
    if (Date.now() > deadline) {
      throw new ShowcaseError(
        `No page on the CDP connection matches ${String(pageMatch ?? 'any non-devtools page')}. ` +
          `Open pages: ${pages.map(page => page.url()).join(', ') || 'none'}`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function waitReady(config: ResolvedConfig, page: Page): Promise<void> {
  if (!config.ready) return;
  try {
    await page.locator(config.ready).first().waitFor({ state: 'attached', timeout: config.timeouts.readyMs });
  } catch {
    throw new ShowcaseError(
      `The ready selector ${config.ready} did not appear within ${String(config.timeouts.readyMs)}ms on ${page.url()}.`,
    );
  }
}

async function runSetup(config: ResolvedConfig, page: Page, context: BrowserContext, lang: string): Promise<void> {
  await waitReady(config, page);
  if (!config.setup) return;
  await config.setup({ page, context, lang, mode: config.target.mode, config });
  // Setup often reloads (to apply a language or seeded state); wait for the app again.
  await page.waitForLoadState('load');
  await waitReady(config, page);
}

async function shootAll(
  session: Session,
  page: Page,
  shots: ResolvedShot[],
  lang: string,
  files: CapturedFile[],
  failures: string[],
): Promise<void> {
  const { config } = session;
  for (const shot of shots) {
    const path = outputPath(config, config.outputs.raw, lang, shot.id);
    try {
      await navigate(session, page, shot);
      await settle(config, page, shot);
      await mkdir(dirname(path), { recursive: true });
      await session.screenshot(page, path);
      const { width = 0, height = 0 } = await sharp(path).metadata();
      files.push({ lang, id: shot.id, path, width, height });
      const expected = expectedSize(config);
      const note = width === expected.width && height === expected.height ? '' : ` (expected ${sizeText(expected)})`;
      log.info(`  ok    ${lang}/${shot.id}  ${String(width)}x${String(height)}${note}  ${relative(process.cwd(), path)}`);
    } catch (error) {
      const message = (error as Error).message.split('\n')[0] ?? String(error);
      failures.push(`${lang}/${shot.id}: ${message}`);
      log.error(`  FAIL  ${lang}/${shot.id}: ${message}`);
    }
  }
}

function expectedSize(config: ResolvedConfig): { width: number; height: number } {
  return {
    width: Math.round(config.viewport.width * config.deviceScaleFactor),
    height: Math.round(config.viewport.height * config.deviceScaleFactor),
  };
}

function sizeText({ width, height }: { width: number; height: number }): string {
  return `${String(width)}x${String(height)}`;
}

async function navigate(session: Session, page: Page, shot: ResolvedShot): Promise<void> {
  const { config } = session;
  const { nav } = shot;
  const timeout = config.timeouts.shotMs;
  if (nav === undefined) return;
  if (typeof nav === 'function') {
    await nav(page);
    return;
  }
  let goto: string | undefined;
  let click: string | undefined;
  if (typeof nav === 'string') {
    if (/^https?:\/\//.test(nav) || (nav.startsWith('/') && !nav.startsWith('//'))) goto = nav;
    else click = nav;
  } else if ('goto' in nav) {
    goto = nav.goto;
  } else {
    click = nav.click;
  }
  if (goto !== undefined) {
    await page.goto(new URL(goto, session.baseUrl()).href, { waitUntil: 'load', timeout });
    await waitReady(config, page);
  } else if (click !== undefined) {
    await page.locator(click).first().click({ timeout });
  }
}

async function settle(config: ResolvedConfig, page: Page, shot: ResolvedShot): Promise<void> {
  const timeout = config.timeouts.shotMs;
  if (shot.waitFor) {
    await page.locator(shot.waitFor).first().waitFor({ state: 'visible', timeout });
  }
  // Dev servers with HMR or polling never go idle; this wait is best effort and bounded.
  if (config.timeouts.networkIdleMs > 0) {
    await page.waitForLoadState('networkidle', { timeout: config.timeouts.networkIdleMs }).catch(() => {
      log.debug(`  network did not go idle within ${String(config.timeouts.networkIdleMs)}ms, continuing`);
    });
  }
  await page.addStyleTag({ content: DETERMINISM_CSS + (config.css ? `\n${config.css}` : '') });
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Two frames: one for pending style changes to apply, one for them to paint.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (shot.delayMs > 0) await page.waitForTimeout(shot.delayMs);
}

/** What Playwright's `animations: 'disabled'` does: finish finite animations, reset infinite ones. */
async function freezeAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().iterations === Infinity) animation.cancel();
      else animation.finish();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

function throwOnFailures(failures: string[], files: CapturedFile[]): void {
  if (failures.length === 0) return;
  throw new ShowcaseError(
    `${String(failures.length)} shot(s) failed (${String(files.length)} captured):\n` +
      failures.map(failure => `  - ${failure}`).join('\n'),
  );
}
