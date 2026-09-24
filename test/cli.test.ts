import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveFixture, tempDir, type FixtureServer } from './helpers.js';

const CLI = resolve('dist', 'cli.js');
const INDEX_URL = pathToFileURL(resolve('dist', 'index.js')).href;

/** Run the built bin with plain Node, as a consumer would. Async: the fixture server lives in this process. */
function run(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', fail);
    child.on('close', code => done({ code, stdout, stderr }));
  });
}

let server: FixtureServer;
beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error('dist/cli.js is missing: run `bun run build` first (`bun run test` does).');
  server = await serveFixture();
});
afterAll(async () => {
  await server.close();
});

function writeConfig(dir: string, file = 'showcase.config.mjs', extra = ''): void {
  writeFileSync(
    join(dir, file),
    `import { defineConfig } from '${INDEX_URL}';
${extra}
export default defineConfig({
  name: 'Fixture App',
  target: { mode: 'url', url: '${server.url}' },
  ready: '[data-testid="app-ready"]',
  viewport: { width: 480, height: 300 },
  deviceScaleFactor: 2,
  langs: ['en', 'pl'],
  setup: async ({ page, lang }) => {
    await page.evaluate(value => localStorage.setItem('fixture.lang', value), lang);
    await page.reload();
  },
  shots: [
    { id: 'home', title: 'Home', caption: 'Home & friends', nav: '[data-view="home"]' },
    { id: 'settings', title: 'Settings', nav: '[data-view="settings"]' },
    { id: 'about', title: 'About', caption: 'About page', nav: '/about' },
  ],
  outputs: {
    portfolio: { dir: 'site/public/projects/{slug}', size: [800, 450], thumbnail: 'about' },
  },
});
`,
  );
}

describe('showcase CLI', () => {
  it('prints help and version under plain Node', async () => {
    // The suite itself runs on Node (vitest's bin), not on Bun's runtime.
    expect(process.versions.bun).toBeUndefined();
    const help = await run(['--help'], process.cwd());
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/^showcase: capture, frame and export/);
    const version = await run(['--version'], process.cwd());
    expect(version.stdout.trim()).toBe(
      (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version,
    );
  });

  it('runs `all` end to end from a config file found in the working directory', async () => {
    const dir = tempDir();
    writeConfig(dir);
    const result = await run(['all'], dir);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    for (const lang of ['en', 'pl']) {
      expect(readdirSync(join(dir, 'showcase-out', 'raw', lang)).sort()).toEqual(['about.png', 'home.png', 'settings.png']);
      expect(readdirSync(join(dir, 'assets', 'showcase', lang)).sort()).toEqual([
        'about.webp',
        'home.webp',
        'settings.webp',
      ]);
    }
    expect(readdirSync(join(dir, 'site', 'public', 'projects', 'fixture-app')).sort()).toEqual([
      'about.webp',
      'home.webp',
      'settings.webp',
      'showcase.gallery.json',
      'thumbnail.webp',
    ]);

    const readme = await run(['readme', '--lang', 'pl', '--cols', '2'], dir);
    expect(readme.code).toBe(0);
    expect(readme.stdout).toBe(`<table>
  <tr>
    <td width="50%"><img src="assets/showcase/pl/home.webp" alt="Fixture App: Home" /></td>
    <td width="50%"><img src="assets/showcase/pl/settings.webp" alt="Fixture App: Settings" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Home &#38; friends</sub></td>
    <td align="center"><sub>Settings</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/showcase/pl/about.webp" alt="Fixture App: About" /></td>
  </tr>
  <tr>
    <td align="center"><sub>About page</sub></td>
  </tr>
</table>
`);
  });

  it('captures only what --only and --langs select', async () => {
    const dir = tempDir();
    writeConfig(dir);
    const result = await run(['capture', '--only', 'settings', '--langs', 'pl'], dir);
    expect(result.code).toBe(0);
    expect(readdirSync(join(dir, 'showcase-out', 'raw'))).toEqual(['pl']);
    expect(readdirSync(join(dir, 'showcase-out', 'raw', 'pl'))).toEqual(['settings.png']);
    const meta = await sharp(join(dir, 'showcase-out', 'raw', 'pl', 'settings.png')).metadata();
    expect([meta.width, meta.height]).toEqual([960, 600]);
  });

  it('loads a TypeScript config with Node type stripping', async () => {
    const dir = tempDir();
    writeConfig(dir, 'showcase.config.ts', 'const typed: number = 1;\nvoid typed;');
    const result = await run(['readme'], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('<img src="assets/showcase/en/home.webp"');
  });

  it('prints config problems without a stack trace and exits 1', async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'showcase.config.mjs'),
      "export default { name: 'Bad', target: { mode: 'url', url: 'localhost:3000' }, shots: [], colour: 'red' };\n",
    );
    const result = await run(['capture'], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'showcase: Invalid showcase config (showcase.config.mjs):\n' +
        '  - config.colour: unknown key (expected one of: name, slug, root, target, ready, viewport, deviceScaleFactor, colorScheme, langs, css, setup, shots, frame, outputs, hero, browser, timeouts)\n' +
        '  - shots: must be a non-empty array, got an empty array\n' +
        '  - target.url: must start with http:// or https://, got "localhost:3000"\n',
    );
  });

  it('explains a missing config and unknown commands', async () => {
    const dir = tempDir();
    const missing = await run(['capture'], dir);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/^showcase: No showcase config found in .*Run `showcase init`/);
    const unknown = await run(['shoot'], dir);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown command "shoot"/);
  });

  it('init writes a starter config that validates, and will not clobber it', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@acme/cool-app', scripts: { 'dev:web': 'vite' } }));
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect((await run(['init'], dir)).code).toBe(0);
    const text = readFileSync(join(dir, 'showcase.config.mjs'), 'utf8');
    expect(text).toContain('name: "Cool App"');
    expect(text).toContain("start: 'pnpm dev:web'");

    // The starter must pass validation: swap the package import for the built file and resolve it.
    writeFileSync(join(dir, 'showcase.config.mjs'), text.replace('@noctcore/showcase-kit', INDEX_URL));
    const readme = await run(['readme'], dir);
    expect(readme.stderr).toMatch(/does not exist yet/);
    expect(readme.code).toBe(0);

    const again = await run(['init'], dir);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/already exists\. Pass --force/);
  });
});
