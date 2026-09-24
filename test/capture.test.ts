import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture } from '../src/capture.js';
import { ShowcaseError } from '../src/errors.js';
import { FIXTURES, fixtureConfig, freePort, isAlive, serveFixture, tempDir, type FixtureServer } from './helpers.js';

async function dims(path: string): Promise<[number | undefined, number | undefined, string | undefined]> {
  const meta = await sharp(path).metadata();
  return [meta.width, meta.height, meta.format];
}

function readPids(file: string): { server: number; grandchild: number } {
  return JSON.parse(readFileSync(file, 'utf8')) as { server: number; grandchild: number };
}

describe('capture, url mode', () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await serveFixture();
  });
  afterAll(async () => {
    await server.close();
  });

  it('captures every shot at viewport x DPR, in every language', async () => {
    const root = tempDir();
    const config = fixtureConfig(root, {
      target: { mode: 'url', url: server.url },
      langs: ['en', 'pl'],
      setup: async ({ page, lang }) => {
        await page.evaluate(value => localStorage.setItem('fixture.lang', value), lang);
        await page.reload();
      },
    });
    const { files } = await capture(config);

    expect(files.map(file => `${file.lang}/${file.id}`)).toEqual([
      'en/home',
      'en/settings',
      'en/about',
      'pl/home',
      'pl/settings',
      'pl/about',
    ]);
    for (const file of files) {
      expect(file.path).toBe(join(root, 'showcase-out', 'raw', file.lang, `${file.id}.png`));
      expect(await dims(file.path)).toEqual([1280, 800, 'png']);
    }
    // Navigation really happened: each view looks different, and so does each language.
    const bytes = files.map(file => readFileSync(file.path).toString('base64'));
    expect(new Set(bytes).size).toBe(files.length);
  });

  it('is deterministic: animations and the caret do not change the pixels', async () => {
    const config = fixtureConfig(tempDir(), { target: { mode: 'url', url: server.url }, shots: [{ id: 'home' }] });
    const first = readFileSync((await capture(config)).files[0]!.path);
    await new Promise(resolve => setTimeout(resolve, 450));
    const second = readFileSync((await capture(config)).files[0]!.path);
    expect(second.equals(first)).toBe(true);
  });

  it('honours --only and a different DPR', async () => {
    const config = fixtureConfig(tempDir(), { target: { mode: 'url', url: server.url }, deviceScaleFactor: 1 });
    const { files } = await capture(config, { only: ['settings'] });
    expect(files.map(file => file.id)).toEqual(['settings']);
    expect(await dims(files[0]!.path)).toEqual([640, 400, 'png']);
  });

  it('fails loudly when the ready selector never appears', async () => {
    const config = fixtureConfig(tempDir(), {
      target: { mode: 'url', url: server.url },
      ready: '#never-there',
      timeouts: { readyMs: 1_500 },
    });
    await expect(capture(config)).rejects.toThrow(/ready selector #never-there did not appear/);
  });

  it('reports failed shots and still writes the others', async () => {
    const config = fixtureConfig(tempDir(), {
      target: { mode: 'url', url: server.url },
      shots: [{ id: 'home' }, { id: 'broken', nav: '[data-view="missing"]' }],
      timeouts: { shotMs: 1_000 },
    });
    const error = await capture(config).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(/^1 shot\(s\) failed \(1 captured\):\n {2}- en\/broken: /);
  });
});

describe('capture, url mode with a start command', () => {
  it('starts the app, waits for it, and kills the whole process tree afterwards', async () => {
    const root = tempDir();
    const port = await freePort();
    const pidFile = join(root, 'pids.json');
    const serve = join(FIXTURES, 'serve.mjs');
    const config = fixtureConfig(root, {
      target: {
        mode: 'url',
        url: `http://127.0.0.1:${String(port)}/`,
        start: `node "${serve}" --port ${String(port)} --pid-file "${pidFile}" --delay-ms 800`,
        readyTimeoutMs: 20_000,
      },
      shots: [{ id: 'home' }, { id: 'settings', nav: '[data-view="settings"]' }],
    });
    const result = await capture(config);
    expect(result.files).toHaveLength(2);
    expect(result.startedPid).toBeTypeOf('number');

    const pids = readPids(pidFile);
    for (const pid of [result.startedPid!, pids.server, pids.grandchild]) {
      expect(isAlive(pid), `pid ${String(pid)} should be gone`).toBe(false);
    }
  });

  it('kills the tree when the capture fails too', async () => {
    const root = tempDir();
    const port = await freePort();
    const pidFile = join(root, 'pids.json');
    const config = fixtureConfig(root, {
      target: {
        mode: 'url',
        url: `http://127.0.0.1:${String(port)}/`,
        start: `node "${join(FIXTURES, 'serve.mjs')}" --port ${String(port)} --pid-file "${pidFile}"`,
      },
      ready: '#never-there',
      timeouts: { readyMs: 1_000 },
    });
    await expect(capture(config)).rejects.toThrow(/ready selector/);
    const pids = readPids(pidFile);
    expect(isAlive(pids.server)).toBe(false);
    expect(isAlive(pids.grandchild)).toBe(false);
  });

  it('explains a start command that dies before the app answers', async () => {
    const port = await freePort();
    const config = fixtureConfig(tempDir(), {
      target: {
        mode: 'url',
        url: `http://127.0.0.1:${String(port)}/`,
        start: 'node -e "console.error(42); process.exit(3)"',
      },
    });
    await expect(capture(config)).rejects.toThrow(/exited \(code 3\) before .* answered\.\nLast output:\n42/);
  });
});

describe('capture, cdp mode', () => {
  let server: FixtureServer;
  let browser: Browser;
  let cdpUrl: string;

  beforeAll(async () => {
    server = await serveFixture();
    const port = await freePort();
    cdpUrl = `http://127.0.0.1:${String(port)}`;
    // Stands in for an Electron app started with --remote-debugging-port: a browser the kit did not
    // launch, with a window size of its own.
    browser = await chromium.launch({ args: [`--remote-debugging-port=${String(port)}`] });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(server.url);
    await browser.newPage(); // an about:blank decoy that pageMatch must skip
  });
  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  it('attaches to the matching page and captures at the configured size', async () => {
    const config = fixtureConfig(tempDir(), {
      target: { mode: 'cdp', cdpUrl, pageMatch: '127.0.0.1' },
      shots: [
        { id: 'home', nav: '[data-view="home"]' },
        { id: 'settings', nav: '[data-view="settings"]' },
      ],
    });
    const { files } = await capture(config);
    expect(files.map(file => file.id)).toEqual(['home', 'settings']);
    for (const file of files) {
      expect(await dims(file.path)).toEqual([1280, 800, 'png']);
    }
    // The app's page is still open after the kit disconnects, back at its own size.
    const page = browser
      .contexts()
      .flatMap(context => context.pages())
      .find(candidate => candidate.url().startsWith(server.url));
    expect(page).toBeDefined();
    expect(await page!.evaluate(() => window.innerWidth)).toBe(900);
  });

  it('freezes animations over CDP too', async () => {
    const config = fixtureConfig(tempDir(), {
      target: { mode: 'cdp', cdpUrl, pageMatch: '127.0.0.1' },
      shots: [{ id: 'home', nav: '[data-view="home"]' }],
    });
    const first = readFileSync((await capture(config)).files[0]!.path);
    await new Promise(resolve => setTimeout(resolve, 450));
    const second = readFileSync((await capture(config)).files[0]!.path);
    expect(second.equals(first)).toBe(true);
  });

  it('names the open pages when nothing matches', async () => {
    const config = fixtureConfig(tempDir(), {
      target: { mode: 'cdp', cdpUrl, pageMatch: 'no-such-app' },
      timeouts: { readyMs: 500 },
    });
    await expect(capture(config)).rejects.toThrow(
      /No page on the CDP connection matches no-such-app\. Open pages: .*127\.0\.0\.1/,
    );
  });
});
