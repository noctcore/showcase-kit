/**
 * Owner: L5 (gallery).
 *
 * Regenerates everything the /gallery/ page shows by running the built CLI
 * against the fixture app in site/gallery/: README frames, portfolio images and
 * their gallery JSON, the hero banner, a terminal shot and clip, and an icon
 * set. It starts from empty output folders, so a run leaves exactly what the
 * configs produce, then writes a manifest (size, pixel size, hash of every
 * file) that the page reads for image dimensions.
 *
 *   bun run docs:gallery   (from the repo root; needs `bun run build` first)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { REPO_ROOT, SITE_DIR } from './site.ts';

export const GALLERY_DIR = join(SITE_DIR, 'gallery');
/** Committed outputs, served byte for byte from /showcase-kit/gallery/. */
export const OUTPUT_DIR = join(SITE_DIR, 'public', 'gallery');
/** Raw captures and the icon source: gitignored (`showcase-out/`). */
export const RAW_DIR = join(GALLERY_DIR, 'showcase-out');
export const GALLERY_JSON = join(GALLERY_DIR, 'showcase.gallery.json');
export const MANIFEST = join(GALLERY_DIR, 'gallery.manifest.json');
export const WEB_CONFIG = join(GALLERY_DIR, 'showcase.config.mjs');
export const TTY_CONFIG = join(GALLERY_DIR, 'showcase.tty.config.mjs');
export const CLI = join(REPO_ROOT, 'dist', 'cli.js');
const MARK = join(SITE_DIR, 'src', 'assets', 'mark.svg');
const ICON_SOURCE = join(RAW_DIR, 'icon-source.png');

/** Every committed gallery file together (outputs, gallery JSON, manifest) stays under this. */
export const BUDGET_BYTES = 4 * 1024 * 1024;

export interface ManifestEntry {
  bytes: number;
  sha256: string;
  /** Pixel size, for images; an animation reports the size of one frame. */
  width?: number;
  height?: number;
  /** Frame count, for an animation. */
  frames?: number;
}

/** Files under OUTPUT_DIR by path relative to it, with `/` separators on every OS. */
export type Manifest = Record<string, ManifestEntry>;

/** The CLI runs, in order. Arguments only: no shell is involved. */
export const STEPS: readonly (readonly string[])[] = [
  ['all', '--config', WEB_CONFIG],
  ['hero', '--config', WEB_CONFIG],
  // `all` on the tty config would record the clip too; the shot and the clip run as two steps so each is visible.
  ['all', '--config', TTY_CONFIG, '--only', 'queue'],
  ['record', '--config', TTY_CONFIG],
  ['icons', '--source', ICON_SOURCE, '--preset', 'web', '--out', join(OUTPUT_DIR, 'icons')],
];

/** Why the gallery cannot run yet, or undefined when the built CLI is there. */
export function missingBuild(cli: string = CLI): string | undefined {
  if (existsSync(cli)) return undefined;
  return `gallery: ${cli} not found. Build the library first: run \`bun run build\` in the repo root.`;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .sort();
}

/** Size, hash and pixel size of every file under `dir`, keyed and sorted by its `/` path. */
export async function buildManifest(dir: string): Promise<Manifest> {
  const manifest: Manifest = {};
  for (const file of await listFiles(dir)) {
    const data = await readFile(file);
    const entry: ManifestEntry = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    if (/\.(png|webp|gif)$/.test(file)) {
      const meta = await sharp(data).metadata();
      entry.width = meta.width;
      // Without `pages: -1` sharp reads the first frame, so an animation reports one frame's size.
      entry.height = meta.height;
      if ((meta.pages ?? 1) > 1) entry.frames = meta.pages;
    }
    manifest[relative(dir, file).split(sep).join('/')] = entry;
  }
  return manifest;
}

/** Every file the budget covers, with its size: the outputs plus the files beside the configs. */
export function budgetLines(manifest: Manifest, extra: Record<string, number>): { lines: [string, number][]; total: number } {
  const lines: [string, number][] = [
    ...Object.entries(manifest).map(([path, entry]): [string, number] => [`public/gallery/${path}`, entry.bytes]),
    ...Object.entries(extra),
  ];
  return { lines, total: lines.reduce((sum, [, bytes]) => sum + bytes, 0) };
}

/** Undefined when `total` fits the budget, else the message the run fails with. */
export function overBudget(total: number, budget: number = BUDGET_BYTES): string | undefined {
  if (total <= budget) return undefined;
  return `gallery: the committed files come to ${kb(total)}, over the ${kb(budget)} budget. Shrink the outputs (frame.maxWidth, quality, clip length) before committing.`;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** True when something accepts connections on 127.0.0.1:`port`. */
function portAnswers(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

let current: ReturnType<typeof spawn> | undefined;

/** Run the built CLI under Node (tty mode refuses the Bun runtime) and wait for it. */
function runCli(args: readonly string[]): Promise<void> {
  console.log(`\n$ node dist/cli.js ${args.map(arg => (arg.startsWith(REPO_ROOT) ? relative(REPO_ROOT, arg) : arg)).join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, ...args], { cwd: REPO_ROOT, stdio: 'inherit', windowsHide: true });
    current = child;
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      current = undefined;
      if (code === 0) resolve();
      else reject(new Error(`gallery: \`showcase ${args[0] ?? ''}\` failed (${signal ?? `exit code ${String(code)}`})`));
    });
  });
}

/** A 1024px square PNG of the site's mark, the source for the icon set. */
async function renderIconSource(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });
  // mark.svg is 32 units square: this density rasterises it at 1024px instead of scaling up a small bitmap.
  await sharp(MARK, { density: (1024 / 32) * 72 }).resize(1024, 1024).png().toFile(ICON_SOURCE);
  console.log(`  ok    icon source  1024x1024  ${relative(REPO_ROOT, ICON_SOURCE)}`);
}

async function main(): Promise<void> {
  const missing = missingBuild();
  if (missing) throw new Error(missing);

  const web = (await import(pathToFileURL(WEB_CONFIG).href)) as { default: { target: { url: string } } };
  const port = Number(new URL(web.default.target.url).port);
  if (await portAnswers(port)) {
    throw new Error(`gallery: something already answers on 127.0.0.1:${String(port)}. Stop it first (the fixture app must start fresh).`);
  }

  // Ctrl+C reaches the CLI too (same console), and the CLI kills what it started before it exits. A SIGTERM only
  // reaches this process, so pass it on.
  process.on('SIGTERM', () => current?.kill('SIGTERM'));

  for (const path of [OUTPUT_DIR, RAW_DIR, GALLERY_JSON, MANIFEST]) await rm(path, { recursive: true, force: true });
  await renderIconSource();
  for (const args of STEPS) await runCli(args);

  if (await portAnswers(port)) throw new Error(`gallery: the fixture server is still running on 127.0.0.1:${String(port)}.`);

  const manifest = await buildManifest(OUTPUT_DIR);
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const extra = {
    'gallery/showcase.gallery.json': (await readFile(GALLERY_JSON)).length,
    'gallery/gallery.manifest.json': (await readFile(MANIFEST)).length,
  };
  const { lines, total } = budgetLines(manifest, extra);
  console.log('\nCommitted gallery files (under site/):');
  for (const [path, bytes] of lines) console.log(`  ${kb(bytes).padStart(10)}  ${path}`);
  console.log(`  ${kb(total).padStart(10)}  total, budget ${kb(BUDGET_BYTES)}`);
  const over = overBudget(total);
  if (over) throw new Error(over);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
