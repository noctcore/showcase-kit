import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config/resolve.js';
import type { TtyConfig } from '../src/config/types.js';
import { log } from '../src/log.js';
import { readmeSnippet, type ReadmeLayout } from '../src/readme.js';

const config = resolveConfig(
  {
    name: 'Rumi',
    target: { mode: 'tty', command: 'rumi' },
    shots: [
      { id: 'queue', title: 'Queue', caption: 'The queue & its details.' },
      { id: 'log', title: 'Log' },
    ],
    clips: [{ id: 'video', title: 'Video', steps: [{ keys: 'v' }], formats: ['mp4'] }],
  } satisfies TtyConfig,
  '/work/rumi',
);

const snippet = (layout: ReadmeLayout, cols?: number): string => readmeSnippet(config, { layout, cols });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readme layouts', () => {
  it('keeps the table as the default', () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(snippet('table')).toBe(readmeSnippet(config));
    expect(readmeSnippet(config)).toMatch(/^<table>\n {2}<tr>\n {4}<td width="50%"><img /);
  });

  it('rows: image and text side by side, alternating, one table each, the caption only when it adds to the title', () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(snippet('rows')).toBe(`<table>
  <tr>
    <td width="60%"><img src="assets/showcase/en/queue.webp" alt="Rumi: Queue" /></td>
    <td width="40%"><h3>Queue</h3><p>The queue &#38; its details.</p></td>
  </tr>
</table>
<table>
  <tr>
    <td width="40%"><h3>Log</h3></td>
    <td width="60%"><img src="assets/showcase/en/log.webp" alt="Rumi: Log" /></td>
  </tr>
</table>
<table>
  <tr>
    <td width="60%"><a href="assets/showcase/en/video.mp4">Rumi: Video (MP4)</a></td>
    <td width="40%"><h3>Video</h3></td>
  </tr>
</table>`);
  });

  it('featured: the first image full width, the rest in a table of --cols', () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(snippet('featured', 3)).toBe(`<p align="center">
  <img width="100%" src="assets/showcase/en/queue.webp" alt="Rumi: Queue" />
  <br /><sub>The queue &#38; its details.</sub>
</p>
<table>
  <tr>
    <td width="33%"><img src="assets/showcase/en/log.webp" alt="Rumi: Log" /></td>
    <td width="33%"><a href="assets/showcase/en/video.mp4">Rumi: Video (MP4)</a></td>
  </tr>
  <tr>
    <td align="center"><sub>Log</sub></td>
    <td align="center"><sub>Video</sub></td>
  </tr>
</table>`);
  });

  it('details: one collapsible section per image, the first open', () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(snippet('details')).toBe(`<details open>
  <summary><b>Queue</b>: The queue &#38; its details.</summary>
  <p align="center"><img width="100%" src="assets/showcase/en/queue.webp" alt="Rumi: Queue" /></p>
</details>
<details>
  <summary><b>Log</b></summary>
  <p align="center"><img width="100%" src="assets/showcase/en/log.webp" alt="Rumi: Log" /></p>
</details>
<details>
  <summary><b>Video</b></summary>
  <p align="center"><a href="assets/showcase/en/video.mp4">Rumi: Video (MP4)</a></p>
</details>`);
  });

  it('list: every image full width with its caption', () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(snippet('list')).toBe(`<p align="center">
  <img width="100%" src="assets/showcase/en/queue.webp" alt="Rumi: Queue" />
  <br /><sub>The queue &#38; its details.</sub>
</p>
<p align="center">
  <img width="100%" src="assets/showcase/en/log.webp" alt="Rumi: Log" />
  <br /><sub>Log</sub>
</p>
<p align="center">
  <a href="assets/showcase/en/video.mp4">Rumi: Video (MP4)</a>
  <br /><sub>Video</sub>
</p>`);
  });

  it('refuses an unknown layout, and --cols where it means nothing', () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(() => readmeSnippet(config, { layout: 'grid' as ReadmeLayout })).toThrow(
      '--layout must be one of table, rows, featured, details, list, got grid',
    );
    expect(() => snippet('rows', 2)).toThrow('--cols only applies to the table and featured layouts, not rows');
  });
});
