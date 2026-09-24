import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_NAMES } from './config/load.js';
import { ShowcaseError } from './errors.js';

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  bin?: string | Record<string, string>;
}

function readPackageJson(dir: string): PackageJson {
  try {
    return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return {};
  }
}

function runner(dir: string): string {
  if (existsSync(resolve(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(resolve(dir, 'bun.lock')) || existsSync(resolve(dir, 'bun.lockb'))) return 'bun run';
  if (existsSync(resolve(dir, 'yarn.lock'))) return 'yarn';
  return 'npm run';
}

function titleCase(name: string): string {
  return name
    .replace(/^@[^/]+\//, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

/** How to run a terminal app from `dir`: its package bin, else a start or dev script. */
function ttyCommand(dir: string, pkg: PackageJson): string {
  const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0];
  if (bin) return `['node', ${JSON.stringify(bin)}]`;
  const script = ['start', 'dev'].find(candidate => pkg.scripts?.[candidate]);
  return script ? `'${runner(dir)} ${script}'` : "'node index.js'";
}

function ttyStarter(name: string, command: string, typescript: boolean): string {
  return `${typescript ? '' : '// @ts-check\n'}import { defineConfig } from '@noctcore/showcase-kit';

// Terminal capture needs a PTY package next to the kit: pnpm add -D @lydell/node-pty
export default defineConfig({
  name: ${JSON.stringify(name)},
  target: {
    mode: 'tty',
    // A string runs through the shell; an array such as ['node', 'dist/cli.js'] is spawned directly.
    command: ${command},
    // Fixture data, a frozen clock and a pinned locale keep captures the same on every run.
    // env: ({ lang }) => ({ MY_APP_FIXTURES: '1', MY_APP_LANG: lang }),
    cols: 120,
    rows: 32,
  },
  // Text on screen once the app has drawn: a string or a RegExp.
  // ready: 'Press ? for help',
  deviceScaleFactor: 2,
  langs: ['en'],
  terminal: { theme: 'dark', font: { size: 15 } },
  shots: [
    { id: 'home', title: 'Home', caption: 'The start screen.' },
    // Keys: plain text is typed, names in braces are keys ({Tab}, {Down}, {Enter}, {Esc}, {C-c}).
    // { id: 'help', title: 'Help', keys: '?', waitFor: 'Keyboard shortcuts' },
  ],
  frame: {
    style: 'window',
    theme: 'dark',
    background: { type: 'gradient', from: '#0f766e', to: '#1e1b4b' },
  },
  outputs: {
    raw: 'showcase-out/raw/{lang}/{id}.png',
    readme: 'assets/showcase/{lang}/{id}.webp',
  },
});
`;
}

/** The starter config text, filled in from the package.json in `dir` where possible. */
export function starterConfig(dir: string, typescript: boolean, { tty = false }: { tty?: boolean } = {}): string {
  const pkg = readPackageJson(dir);
  const name = titleCase(pkg.name ?? 'My App') || 'My App';
  if (tty) return ttyStarter(name, ttyCommand(dir, pkg), typescript);
  const script = ['dev:web', 'dev', 'start'].find(candidate => pkg.scripts?.[candidate]);
  const start = script ? `'${runner(dir)} ${script}'` : undefined;

  return `${typescript ? '' : '// @ts-check\n'}import { defineConfig } from '@noctcore/showcase-kit';

export default defineConfig({
  name: ${JSON.stringify(name)},
  target: {
    mode: 'url',
    url: 'http://localhost:5173',
    ${start ? `start: ${start},` : "// start: 'pnpm dev',"}
    // Electron, or Tauri on Windows: { mode: 'cdp', cdpUrl: 'http://127.0.0.1:9222', pageMatch: 'localhost' }
  },
  // A selector that exists once the app has booted.
  ready: 'body',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  langs: ['en'],
  // setup: async ({ page, lang }) => {
  //   await page.evaluate(value => localStorage.setItem('lang', value), lang);
  //   await page.reload();
  // },
  shots: [
    { id: 'home', title: 'Home', caption: 'The home screen.', nav: '/' },
    // { id: 'settings', title: 'Settings', nav: '[data-view="settings"]', delayMs: 300 },
  ],
  frame: {
    style: 'window',
    theme: 'dark',
    background: { type: 'gradient', from: '#0f766e', to: '#1e1b4b' },
  },
  outputs: {
    raw: 'showcase-out/raw/{lang}/{id}.png',
    readme: 'assets/showcase/{lang}/{id}.webp',
    // portfolio: { dir: '../portfolio/public/projects/{slug}' },
  },
});
`;
}

/** Write a starter config into `dir`. Refuses to overwrite an existing config unless `force`. */
export function init(dir: string, { typescript = false, force = false, tty = false } = {}): string {
  const existing = CONFIG_NAMES.map(name => resolve(dir, name)).find(path => existsSync(path));
  if (existing && !force) {
    throw new ShowcaseError(`${existing} already exists. Pass --force to overwrite it.`);
  }
  const path = resolve(dir, typescript ? 'showcase.config.ts' : 'showcase.config.mjs');
  if (existing && existing !== path) {
    // Two configs side by side would leave the old one winning discovery.
    throw new ShowcaseError(`${existing} already exists. Delete it first to switch to ${path}.`);
  }
  writeFileSync(path, starterConfig(dir, typescript, { tty }));
  return path;
}
