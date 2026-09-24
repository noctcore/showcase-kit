import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config/resolve.js';
import type { TtyConfig } from '../src/config/types.js';
import { log } from '../src/log.js';
import { readmeSnippet } from '../src/readme.js';
import { FIXTURES, tempDir } from './helpers.js';

const base: TtyConfig = {
  name: 'Rumi',
  target: { mode: 'tty', command: 'rumi' },
  shots: [{ id: 'resources', title: 'Resources' }],
  clips: [
    { id: 'tour', title: 'Tour', caption: 'A quick tour.', steps: [{ keys: 'j' }] },
    { id: 'deploy', title: 'Deploy', steps: [{ keys: 'd' }], formats: ['gif', 'mp4'] },
    { id: 'video', title: 'Video', steps: [{ keys: 'v' }], formats: ['mp4'] },
  ],
};

function snippet(input: TtyConfig, only?: string[]): string {
  const config = resolveConfig(input, '/work/rumi');
  return readmeSnippet(config, { only, cols: 4 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readme with clips', () => {
  it('lists clips after the shots: the WebP (or GIF) as an image, MP4 as a link', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(snippet(base)).toBe(`<table>
  <tr>
    <td width="25%"><img src="assets/showcase/en/resources.webp" alt="Rumi: Resources" /></td>
    <td width="25%"><img src="assets/showcase/en/tour.webp" alt="Rumi: Tour" /></td>
    <td width="25%"><img src="assets/showcase/en/deploy.gif" alt="Rumi: Deploy" /></td>
    <td width="25%"><a href="assets/showcase/en/video.mp4">Rumi: Video (MP4)</a></td>
  </tr>
  <tr>
    <td align="center"><sub>Resources</sub></td>
    <td align="center"><sub>A quick tour.</sub></td>
    <td align="center"><sub>Deploy (<a href="assets/showcase/en/deploy.mp4">MP4</a>)</sub></td>
    <td align="center"><sub>Video</sub></td>
  </tr>
</table>`);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/tour\.webp does not exist yet \(run `showcase record`\)\.$/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/resources\.webp does not exist yet \(run `showcase frame`\)\.$/));
  });

  it('takes shot and clip ids in --only, and lists only clips when outputs.readme is false', () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(snippet(base, ['tour'])).toContain('<td width="25%"><img src="assets/showcase/en/tour.webp" alt="Rumi: Tour" /></td>\n  </tr>');
    expect(snippet(base, ['tour'])).not.toContain('resources');
    expect(snippet(base, ['resources'])).not.toContain('tour');
    expect(() => snippet(base, ['nope'])).toThrow('Unknown shot or clip id(s): nope. Shots: resources; clips: tour, deploy, video');
    const noReadme = snippet({ ...base, outputs: { readme: false } });
    expect(noReadme).not.toContain('resources');
    expect(noReadme).toContain('tour.webp');
  });
});

const TUI = join(FIXTURES, 'tui.mjs');

function run(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [resolve('dist', 'cli.js'), ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', fail);
    child.on('close', code => done({ code, stdout, stderr }));
  });
}

describe('the CLI with clips', () => {
  it('records through `record` and `all`, and `all --only` splits shot and clip ids', async () => {
    const dir = tempDir();
    const index = pathToFileURL(resolve('dist', 'index.js')).href;
    writeFileSync(
      join(dir, 'showcase.config.mjs'),
      `import { defineConfig } from '${index}';
export default defineConfig({
  name: 'Fixture TUI',
  target: { mode: 'tty', command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(TUI)}], cols: 50, rows: 14 },
  ready: 'fixture-tui',
  deviceScaleFactor: 1,
  shots: [{ id: 'services' }],
  clips: [{ id: 'tour', steps: [{ keys: 'j' }], tailMs: 300 }],
});
`,
    );
    // Only the clip: nothing is captured or framed.
    const clipOnly = await run(['all', '--only', 'tour'], dir);
    expect(clipOnly.stderr).toBe('');
    expect(clipOnly.code).toBe(0);
    expect(clipOnly.stdout).toContain('MP4 skipped: no clip lists "mp4" in its formats');
    expect(existsSync(join(dir, 'showcase-out'))).toBe(false);
    expect(readdirSync(join(dir, 'assets', 'showcase', 'en')).sort()).toEqual(['tour.gif', 'tour.webp']);
    // From a buffer: sharp keeps a file it opened by path locked on Windows, and `all` writes it again below.
    const meta = await sharp(readFileSync(join(dir, 'assets', 'showcase', 'en', 'tour.webp')), { animated: true }).metadata();
    expect([meta.width, meta.pageHeight, meta.pages]).toEqual([50 * 9 + 24 + 144, 14 * 20 + 24 + 40 + 144, 2]);

    const everything = await run(['all'], dir);
    expect(everything.stderr).toBe("");
    expect(everything.code).toBe(0);
    expect(readdirSync(join(dir, 'assets', 'showcase', 'en')).sort()).toEqual(['services.webp', 'tour.gif', 'tour.webp']);

    const unknown = await run(['record', '--only', 'services'], dir);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('showcase: Unknown clip id(s): services. Known: tour');

    const readme = await run(['readme'], dir);
    expect(readme.stdout).toContain('<img src="assets/showcase/en/tour.webp" alt="Fixture TUI: tour" />');
    expect(readme.stderr).toBe('');
  });
});

