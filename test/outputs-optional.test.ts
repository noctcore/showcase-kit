import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture } from '../src/capture.js';
import { resolveConfig } from '../src/config/resolve.js';
import type { ResolvedConfig, ShowcaseConfig } from '../src/config/types.js';
import { ConfigError } from '../src/errors.js';
import { frame } from '../src/frame/index.js';
import { exportPortfolio } from '../src/portfolio.js';
import { readmeSnippet } from '../src/readme.js';
import { fixtureInput, serveFixture, tempDir, type FixtureServer } from './helpers.js';

const minimal = {
  name: 'Demo App',
  target: { mode: 'url', url: 'http://localhost:5173' },
  shots: [{ id: 'home' }],
};

function issuesOf(input: unknown): string[] {
  try {
    resolveConfig(input, process.cwd());
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error('expected resolveConfig to throw');
}

describe('optional outputs, config', () => {
  it('defaults the gallery JSON into the portfolio dir', () => {
    const config = resolveConfig({ ...minimal, outputs: { portfolio: { dir: 'site/public/{slug}/' } } }, '/work');
    expect(config.outputs.portfolio?.gallery).toBe('site/public/{slug}/showcase.gallery.json');
  });

  it('accepts gallery: false, a relocated gallery and readme: false', () => {
    const skipped = resolveConfig({ ...minimal, outputs: { portfolio: { dir: 'p', gallery: false } } }, '/work');
    expect(skipped.outputs.portfolio?.gallery).toBe(false);
    const moved = resolveConfig(
      { ...minimal, outputs: { portfolio: { dir: 'p', gallery: 'src/data/{slug}.json' } } },
      '/work',
    );
    expect(moved.outputs.portfolio?.gallery).toBe('src/data/{slug}.json');
    expect(resolveConfig({ ...minimal, outputs: { readme: false } }, '/work').outputs.readme).toBe(false);
  });

  it('rejects a bad gallery path and readme: true', () => {
    expect(
      issuesOf({ ...minimal, outputs: { readme: true, portfolio: { dir: 'p', gallery: 'data/{id}.yaml' } } }),
    ).toEqual([
      'outputs.readme: must be a non-empty string, got boolean true',
      'outputs.portfolio.gallery: unknown token {id} (allowed: {slug})',
      'outputs.portfolio.gallery: must end in .json',
    ]);
  });
});

describe('optional outputs, end to end', () => {
  let server: FixtureServer;
  let root: string;
  function config(outputs: ShowcaseConfig['outputs']): ResolvedConfig {
    return resolveConfig(fixtureInput({ target: { mode: 'url', url: server.url }, outputs }), root);
  }
  beforeAll(async () => {
    server = await serveFixture();
    root = tempDir();
    await capture(config({}), { only: ['home', 'settings'] });
  });
  afterAll(async () => {
    await server.close();
  });

  it('skips the gallery JSON when gallery is false', async () => {
    const result = await exportPortfolio(
      config({ portfolio: { dir: 'skip/{slug}', size: [800, 450], gallery: false } }),
      { only: ['home'] },
    );
    expect(result.galleryFile).toBeUndefined();
    expect(readdirSync(join(root, 'skip', 'fixture-app')).sort()).toEqual(['home.webp', 'thumbnail.webp']);
  });

  it('writes the gallery JSON where gallery points, not into the portfolio dir', async () => {
    const result = await exportPortfolio(
      config({ portfolio: { dir: 'moved/{slug}', size: [800, 450], gallery: 'data/{slug}.gallery.json' } }),
      { only: ['home'] },
    );
    const file = join(root, 'data', 'fixture-app.gallery.json');
    expect(result.galleryFile).toBe(file);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([
      { src: '/projects/fixture-app/home.webp', alt: 'Fixture App: Home', caption: 'The home view.' },
    ]);
    expect(readdirSync(join(root, 'moved', 'fixture-app')).sort()).toEqual(['home.webp', 'thumbnail.webp']);
  });

  it('writes no README images when readme is false, and readme explains why', async () => {
    const portfolioOnly = config({ readme: false });
    expect(await frame(portfolioOnly)).toEqual([]);
    expect(existsSync(join(root, 'assets'))).toBe(false);
    expect(() => readmeSnippet(portfolioOnly)).toThrow(/outputs\.readme is false/);
  });

  it('`all` with readme: false still exports the portfolio from the raw captures', async () => {
    const dir = tempDir();
    const index = pathToFileURL(resolve('dist', 'index.js')).href;
    writeFileSync(
      join(dir, 'showcase.config.mjs'),
      `import { defineConfig } from '${index}';
export default defineConfig({
  name: 'Fixture App',
  target: { mode: 'url', url: '${server.url}' },
  ready: '[data-testid="app-ready"]',
  viewport: { width: 480, height: 300 },
  shots: [{ id: 'home', nav: '[data-view="home"]' }],
  outputs: { readme: false, portfolio: { dir: 'site/{slug}', size: [800, 450], gallery: false } },
});
`,
    );
    const result = await new Promise<{ code: number | null; stdout: string }>((done, fail) => {
      const child = spawn(process.execPath, [resolve('dist', 'cli.js'), 'all'], { cwd: dir });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.on('error', fail);
      child.on('close', code => done({ code, stdout }));
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/outputs\.readme is false, skipping the README images/);
    expect(existsSync(join(dir, 'assets'))).toBe(false);
    expect(readdirSync(join(dir, 'site', 'fixture-app')).sort()).toEqual(['home.webp', 'thumbnail.webp']);
  });
});
