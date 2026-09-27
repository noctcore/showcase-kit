import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, findConfigFile, loadConfig, resolveConfig } from '../src/index.js';

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

describe('resolveConfig', () => {
  it('fills defaults for a minimal config', () => {
    const config = resolveConfig(minimal, '/work/app');
    expect(config.slug).toBe('demo-app');
    expect(config.root).toBe(resolve('/work/app'));
    expect(config).toMatchObject({ viewport: { width: 1440, height: 900 } });
    expect(config.deviceScaleFactor).toBe(2);
    expect(config.langs).toEqual(['en']);
    expect(config.shots[0]).toMatchObject({ id: 'home', title: 'home', alt: 'Demo App: home', delayMs: 0 });
    expect(config.outputs.raw).toBe('showcase-out/raw/{lang}/{id}.png');
    expect(config.outputs.portfolio).toBeUndefined();
    expect(config.frame).toMatchObject({ style: 'window', theme: 'dark', padding: 72, title: '{name}' });
    expect(config.target).toMatchObject({ mode: 'url', readyTimeoutMs: 60_000, reuseExisting: true });
  });

  it('resolves portfolio defaults from shots and langs', () => {
    const config = resolveConfig(
      { ...minimal, langs: ['pl', 'en'], outputs: { portfolio: { dir: '../portfolio/public/projects/{slug}' } } },
      '/work/app',
    );
    expect(config.outputs.portfolio).toEqual({
      dir: '../portfolio/public/projects/{slug}',
      size: [1920, 1080],
      format: 'webp',
      quality: 90,
      thumbnail: 'home',
      lang: 'pl',
      publicPath: '/projects/{slug}',
      padding: 96,
      gallery: '../portfolio/public/projects/{slug}/showcase.gallery.json',
    });
  });

  it('drops trailing separators from the portfolio dir and publicPath', () => {
    const portfolio = (dir: string, publicPath: string) =>
      resolveConfig({ ...minimal, outputs: { portfolio: { dir, publicPath } } }, '/work/app').outputs.portfolio;
    expect(portfolio('out/{slug}\\//', '/projects/{slug}//')).toMatchObject({
      dir: 'out/{slug}\\//',
      publicPath: '/projects/{slug}',
      gallery: 'out/{slug}/showcase.gallery.json',
    });
    expect(portfolio('out', '/')).toMatchObject({ publicPath: '', gallery: 'out/showcase.gallery.json' });
  });

  it('reports every problem in a bad config at once', () => {
    const issues = issuesOf({
      name: '',
      target: { mode: 'ftp' },
      viewPort: { width: 10 },
      deviceScaleFactor: 9,
      shots: [{ id: 'a b' }, { id: 'x', nav: 42 }, { id: 'x' }],
      frame: { style: 'fancy', background: { type: 'solid', color: 'red; } body { display:none' } },
      outputs: { raw: 'out/{lang}/{id}.jpg', readme: 'out/readme.webp', portfolio: { size: [1920], thumbnail: 'nope' } },
      setup: 'yes',
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        'name: must be a non-empty string, got ""',
        'target.mode: must be "url", "cdp" or "tty", got "ftp"',
        expect.stringMatching(/^config\.viewPort: unknown key/),
        'deviceScaleFactor: must be a number between 0.25 and 4, got number 9',
        'shots[0].id: may only contain letters, digits, "-" and "_", got "a b"',
        expect.stringMatching(/^shots\[1\]\.nav: must be a selector/),
        'shots[2].id: duplicates another shot id "x"',
        'frame.style: must be one of "window", "minimal", "none", "browser", "windows", "terminal", got "fancy"',
        'frame.background.color: is not a CSS color: "red; } body { display:none"',
        'outputs.raw: must end in .png',
        'outputs.readme: must contain {id}, or every file overwrites the last',
        'outputs.portfolio.dir: is required',
        expect.stringMatching(/^outputs\.portfolio\.size: must be \[width, height\]/),
        'outputs.portfolio.thumbnail: "nope" is not a shot id (a b, x, x)',
        'setup: must be a function, got "yes"',
      ]),
    );
    expect(issues).toHaveLength(15);
  });

  it('requires {lang} in output paths once there is more than one language', () => {
    expect(issuesOf({ ...minimal, langs: ['en', 'pl'], outputs: { raw: 'raw/{id}.png' } })).toEqual([
      'outputs.raw: must contain {lang}, or every file overwrites the last',
    ]);
  });

  it('rejects unknown path tokens', () => {
    expect(issuesOf({ ...minimal, outputs: { readme: 'x/{id}-{theme}.webp' } })).toEqual([
      'outputs.readme: unknown token {theme} (allowed: {lang}, {id}, {slug})',
    ]);
  });

  it('accepts cdp targets with a RegExp page match and function nav', () => {
    const nav = async () => {};
    const config = resolveConfig(
      { ...minimal, target: { mode: 'cdp', pageMatch: /localhost:\d+/ }, shots: [{ id: 'a', nav }] },
      '/',
    );
    expect(config.target).toMatchObject({ mode: 'cdp', cdpUrl: 'http://127.0.0.1:9222' });
    expect(config.shots[0]?.nav).toBe(nav);
  });

  it('accepts color syntax but not url() or other non-color functions', () => {
    for (const ok of ['#0f766e', 'rebeccapurple', 'rgb(0 0 0 / 50%)', 'oklch(70% 0.1 200)', 'color-mix(in srgb, red 40%, blue)']) {
      expect(() => resolveConfig({ ...minimal, frame: { background: ok } }, '/'), ok).not.toThrow();
    }
    expect(issuesOf({ ...minimal, frame: { background: 'url(logo.png)' } })).toEqual(['frame.background: is not a CSS color: "url(logo.png)"']);
    expect(issuesOf({ ...minimal, frame: { background: 'url(https://example.com/x.png)' } })).toEqual([
      'frame.background: is not a CSS color: "url(https://example.com/x.png)"',
    ]);
    expect(issuesOf({ ...minimal, frame: { background: { type: 'solid', color: 'image-set(a 1x)' } } })).toEqual([
      'frame.background.color: is not a CSS color: "image-set(a 1x)"',
    ]);
  });

  it('defaults the new layout keys to the looks that existed before them', () => {
    const config = resolveConfig(minimal, '/work/app');
    expect(config.hero.layout).toBe('stack');
    expect(config.hero.shots).toEqual(['home']);
    expect(config.frame.address).toBe('{url}');
  });

  it('accepts every hero layout, and takes as many of the first shots as the layout shows', () => {
    const shots = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
    const heroShots = (layout: string) => resolveConfig({ ...minimal, shots, hero: { layout } }, '/').hero.shots;
    expect(heroShots('stack')).toEqual(['a', 'b', 'c']);
    expect(heroShots('row')).toEqual(['a', 'b', 'c', 'd']);
    expect(heroShots('mosaic')).toEqual(['a', 'b', 'c', 'd']);
    for (const layout of ['spotlight', 'split', 'centered']) expect(heroShots(layout)).toEqual(['a']);
  });

  it('rejects an unknown hero layout, and more shots than the layout shows', () => {
    const shots = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
    expect(issuesOf({ ...minimal, hero: { layout: 'carousel' } })).toEqual([
      'hero.layout: must be one of "stack", "spotlight", "split", "row", "mosaic", "centered", got "carousel"',
    ]);
    expect(issuesOf({ ...minimal, shots, hero: { layout: 'spotlight', shots: ['a', 'b'] } })).toEqual([
      'hero.shots: must be an array of one shot id (layout "spotlight"), got an array',
    ]);
    expect(issuesOf({ ...minimal, shots, hero: { layout: 'row', shots: ['a', 'b', 'c', 'd', 'e'] } })).toEqual([
      'hero.shots: must be an array of one to four shot ids (layout "row"), got an array',
    ]);
    expect(issuesOf({ ...minimal, shots, hero: { shots: ['a', 'b', 'c', 'd'] } })).toEqual([
      'hero.shots: must be an array of one to three shot ids, got an array',
    ]);
  });

  it('accepts the new frame styles and an address template', () => {
    for (const style of ['browser', 'windows', 'terminal']) {
      expect(resolveConfig({ ...minimal, frame: { style } }, '/').frame.style).toBe(style);
    }
    const frame = resolveConfig({ ...minimal, frame: { style: 'browser', address: 'demo.app/{id}?lang={lang}' } }, '/').frame;
    expect(frame.address).toBe('demo.app/{id}?lang={lang}');
  });

  it('rejects the browser style where there is no page, and unknown address tokens', () => {
    const tty = { name: 'Demo', target: { mode: 'tty', command: 'demo' }, shots: [{ id: 'home' }] };
    expect(issuesOf({ ...tty, frame: { style: 'browser' } })).toEqual([
      'frame.style: "browser" needs a page with an address; a terminal app has none (use "terminal" or "window")',
    ]);
    const cdp = { ...minimal, target: { mode: 'cdp' } };
    expect(issuesOf({ ...cdp, frame: { style: 'browser' } })).toEqual([
      'frame.address: cannot use {url} in cdp mode, where the page is not known when framing: write the address',
    ]);
    expect(resolveConfig({ ...cdp, frame: { style: 'browser', address: 'demo.app' } }, '/').frame.address).toBe('demo.app');
    expect(issuesOf({ ...minimal, frame: { address: '{host}/{id}' } })).toEqual([
      'frame.address: unknown token {host} (allowed: {url}, {name}, {title}, {id}, {lang})',
    ]);
  });

  it('resolves the mesh, dots and noise backgrounds with their defaults', () => {
    const background = (value: unknown) => resolveConfig({ ...minimal, frame: { background: value } }, '/').frame.background;
    expect(background({ type: 'mesh', colors: ['#000', 'red', 'oklch(70% 0.1 200)'] })).toEqual({
      type: 'mesh',
      colors: ['#000', 'red', 'oklch(70% 0.1 200)'],
    });
    expect(background({ type: 'dots', color: '#101010' })).toEqual({
      type: 'dots',
      color: '#101010',
      dot: 'rgba(255,255,255,0.14)',
      spacing: 24,
    });
    expect(background({ type: 'noise', from: '#111', to: '#222' })).toEqual({
      type: 'noise',
      from: '#111',
      to: '#222',
      angle: 135,
      amount: 0.2,
    });
    const hero = resolveConfig({ ...minimal, hero: { background: { type: 'dots', color: '#fff', dot: '#0003', spacing: 12 } } }, '/');
    expect(hero.hero.background).toEqual({ type: 'dots', color: '#fff', dot: '#0003', spacing: 12 });
  });

  it('rejects bad mesh, dots and noise backgrounds with the reason', () => {
    expect(issuesOf({ ...minimal, frame: { background: { type: 'mesh', colors: ['#000'] } } })).toEqual([
      'frame.background.colors: must be an array of two to five CSS colors, got an array',
    ]);
    expect(issuesOf({ ...minimal, frame: { background: { type: 'mesh', colors: ['#000', 'url(x.png)'] } } })).toEqual([
      'frame.background.colors[1]: is not a CSS color: "url(x.png)"',
    ]);
    expect(issuesOf({ ...minimal, frame: { background: { type: 'dots', color: '#000', spacing: 4, size: 2 } } })).toEqual([
      'frame.background.size: unknown key (expected one of: type, color, dot, spacing)',
      'frame.background.spacing: must be a number between 8 and 96, got number 4',
    ]);
    expect(issuesOf({ ...minimal, frame: { background: { type: 'noise', from: '#000', to: '#fff', amount: 2 } } })).toEqual([
      'frame.background.amount: must be a number between 0 and 1, got number 2',
    ]);
    expect(issuesOf({ ...minimal, frame: { background: { type: 'stripes' } } })).toEqual([
      'frame.background: must be a color string or { type: "solid" | "gradient" | "transparent" | "mesh" | "dots" | "noise" }, got an object',
    ]);
  });

  it('drops the g and y flags from a RegExp pageMatch, whose lastIndex would make matching flaky', () => {
    const config = resolveConfig({ ...minimal, target: { mode: 'cdp', pageMatch: /localhost/giy } }, '/');
    const pageMatch = (config.target as { pageMatch: RegExp }).pageMatch;
    expect(pageMatch.flags).toBe('i');
    const url = 'http://localhost:15175/';
    expect([pageMatch.test(url), pageMatch.test(url), pageMatch.test(url)]).toEqual([true, true, true]);
  });

  it('rejects a shot called "thumbnail" when the portfolio export would overwrite it', () => {
    const shots = [{ id: 'home' }, { id: 'thumbnail' }];
    expect(() => resolveConfig({ ...minimal, shots }, '/')).not.toThrow();
    expect(issuesOf({ ...minimal, shots, outputs: { portfolio: { dir: 'out' } } })).toEqual([
      'shots[1].id: "thumbnail" is reserved when outputs.portfolio is set (it writes thumbnail.<format>)',
    ]);
  });

  it('names the file in the error message', () => {
    expect(() => resolveConfig({}, '/', 'showcase.config.mjs')).toThrow(
      /^Invalid showcase config \(showcase\.config\.mjs\):\n {2}- name: is required/,
    );
  });
});

describe('loadConfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'showcase-config-'));
  const nested = join(dir, 'packages', 'app');
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(dir, 'showcase.config.ts'),
    `const viewport: { width: number; height: number } = { width: 800, height: 600 };
export default { name: 'Typed', viewport, target: { mode: 'url', url: 'http://localhost:1' }, shots: [{ id: 'a' }] };\n`,
  );

  it('finds a TypeScript config in a parent directory and resolves paths against it', async () => {
    expect(findConfigFile(nested)).toBe(join(dir, 'showcase.config.ts'));
    const config = await loadConfig(undefined, nested);
    expect(config.name).toBe('Typed');
    expect(config).toMatchObject({ viewport: { width: 800, height: 600 } });
    expect(config.root).toBe(dir);
  });

  it('stops looking at the package or repository root', () => {
    const base = mkdtempSync(join(tmpdir(), 'showcase-boundary-'));
    writeFileSync(join(base, 'showcase.config.mjs'), 'export default {};\n');
    // Inside a git repository: the config above the repo is not this project's.
    mkdirSync(join(base, 'repo', '.git'), { recursive: true });
    mkdirSync(join(base, 'repo', 'src'), { recursive: true });
    expect(findConfigFile(join(base, 'repo', 'src'))).toBeUndefined();
    // Inside a package: same.
    mkdirSync(join(base, 'pkg', 'src'), { recursive: true });
    writeFileSync(join(base, 'pkg', 'package.json'), '{}');
    expect(findConfigFile(join(base, 'pkg', 'src'))).toBeUndefined();
    // A config at the package root itself is found.
    writeFileSync(join(base, 'pkg', 'showcase.config.js'), 'export default {};\n');
    expect(findConfigFile(join(base, 'pkg', 'src'))).toBe(join(base, 'pkg', 'showcase.config.js'));
    // Plain directories in between are walked through.
    mkdirSync(join(base, 'plain', 'deeper'), { recursive: true });
    expect(findConfigFile(join(base, 'plain', 'deeper'))).toBe(join(base, 'showcase.config.mjs'));
  });

  it('explains a missing config', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'showcase-empty-'));
    await expect(loadConfig('nope.mjs', empty)).rejects.toThrow(/Config file not found/);
  });
});
