import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { isTtyConfig, resolveConfig } from '../src/config/resolve.js';
import type { ResolvedTtyConfig, TtyConfig, TtySession } from '../src/index.js';
import { log } from '../src/log.js';
import { record } from '../src/record.js';
import { FIXTURES, isAlive, tempDir } from './helpers.js';

const TUI = join(FIXTURES, 'tui.mjs');

function fixtureTty(root: string, overrides: Partial<TtyConfig> = {}): ResolvedTtyConfig {
  const input: TtyConfig = {
    name: 'Fixture TUI',
    target: { mode: 'tty', command: [process.execPath, TUI], cols: 60, rows: 16 },
    ready: 'fixture-tui · services',
    deviceScaleFactor: 1,
    shots: [{ id: 'services' }],
    clips: [
      {
        id: 'tour',
        title: 'Tour',
        // Every key changes the screen: the selection moves, then Tab opens the details.
        steps: [{ sleep: 300 }, { keys: 'j' }, { sleep: 300 }, { keys: 'j' }, { sleep: 300 }, { keys: '{Tab}' }],
        tailMs: 500,
      },
    ],
    ...overrides,
  };
  const config = resolveConfig(input, root);
  if (!isTtyConfig(config)) throw new Error('expected a tty config');
  return config;
}

describe('record, real terminal', () => {
  it('records the fixture TUI as framed WebP and GIF, byte-identical on a second run', async () => {
    const root = tempDir();
    const config = fixtureTty(root);
    const [first] = await record(config);
    // 60 x 16 cells of 9 x 20 CSS pixels plus 12px padding, in the window frame (40px bar, 72px padding), DPR 1.
    const width = 60 * 9 + 24 + 144;
    const height = 16 * 20 + 24 + 40 + 144;
    expect(first).toMatchObject({ lang: 'en', id: 'tour', width, height, frames: 4 });
    // Each screen lasts its 3 tick sleep plus the tick its key is pressed on; the last one is the 5 tick tail.
    expect(first?.durationMs).toBe(1700);
    const bytes = new Map<string, Buffer>();
    for (const file of first?.files ?? []) {
      const data = readFileSync(file.path);
      bytes.set(file.format, data);
      const meta = await sharp(data, { animated: true }).metadata();
      expect([meta.format, meta.width, meta.pageHeight, meta.pages, meta.loop]).toEqual([file.format, width, height, 4, 0]);
      expect(meta.delay).toEqual([400, 400, 400, 500]);
    }
    expect([...bytes.keys()]).toEqual(['webp', 'gif']);

    const [again] = await record(config);
    for (const file of again?.files ?? []) expect(readFileSync(file.path).equals(bytes.get(file.format) ?? Buffer.alloc(0))).toBe(true);
  });

  it('leaves no process behind, after a clip and after a failed one', async () => {
    const root = tempDir();
    const pids: number[] = [];
    const config = fixtureTty(root, {
      target: { mode: 'tty', command: [process.execPath, TUI], cols: 60, rows: 16, env: { TUI_GRANDCHILD: '1' } },
      timeouts: { shotMs: 1000 },
      // Runs in every fresh app, so it sees each clip's grandchild.
      setup: async ({ tty }: { tty: TtySession }) => {
        await tty.waitForText(/grandchild \d+/);
        pids.push(Number(/grandchild (\d+)/.exec(tty.screenText())?.[1]));
      },
      clips: [
        { id: 'ok', steps: [{ keys: 'j' }], tailMs: 200, formats: ['webp'] },
        { id: 'stuck', steps: [{ waitFor: 'no such text' }], formats: ['webp'] },
      ],
    });
    vi.spyOn(log, 'error').mockImplementation(() => {});
    await expect(record(config)).rejects.toThrow(/1 clip\(s\) failed \(1 recorded\):\n {2}- en\/stuck: Step 1: the waitFor text/);
    vi.restoreAllMocks();
    expect(pids).toHaveLength(2);
    expect(pids[0]).not.toBe(pids[1]);
    for (const pid of pids) await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000 });
  });

  it('refuses unknown clip ids and web configs', async () => {
    const config = fixtureTty(tempDir());
    await expect(record(config, { only: ['nope'] })).rejects.toThrow('Unknown clip id(s): nope. Known: tour');
    const web = resolveConfig({ name: 'Web', target: { mode: 'url', url: 'http://localhost:1' }, shots: [{ id: 'a' }] }, tempDir());
    await expect(record(web)).rejects.toThrow('Nothing to record: web clips arrive in v0.3');
  });
});
