import { describe, expect, it } from 'vitest';
import { ConfigError, isTtyConfig, resolveConfig, type ResolvedTtyConfig } from '../src/index.js';

const minimal = {
  name: 'Rumi',
  target: { mode: 'tty', command: 'bun run src/index.tsx' },
  shots: [{ id: 'resources' }],
};

function ttyConfig(input: unknown): ResolvedTtyConfig {
  const config = resolveConfig(input, '/work/rumi');
  if (!isTtyConfig(config)) throw new Error('expected a tty config');
  return config;
}

function issuesOf(input: unknown): string[] {
  try {
    resolveConfig(input, '/work/rumi');
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error('expected resolveConfig to throw');
}

describe('clips config', () => {
  it('fills in the defaults: 10 fps, 1.5 s tail, WebP and GIF, and the clip output path', () => {
    const config = ttyConfig({ ...minimal, clips: [{ id: 'tour', steps: [{ sleep: 500 }, { keys: 'jj' }] }] });
    expect(config.clips).toEqual([
      {
        id: 'tour',
        title: 'tour',
        caption: undefined,
        alt: 'Rumi: tour',
        steps: [{ sleep: 500 }, { keys: 'jj' }],
        fps: 10,
        durationMs: undefined,
        tailMs: 1500,
        formats: ['webp', 'gif'],
      },
    ]);
    expect(config.outputs.clips).toBe('assets/showcase/{lang}/{id}.{ext}');
    expect(ttyConfig(minimal).clips).toEqual([]);
  });

  it('takes every option and every step shape, and strips g and y from waitFor', () => {
    const config = ttyConfig({
      ...minimal,
      langs: ['en', 'pl'],
      outputs: { clips: 'docs/clips/{slug}-{lang}-{id}.{ext}' },
      clips: [
        {
          id: 'deploy',
          title: 'Deploy',
          caption: 'Deploying a service.',
          alt: 'A deploy in Rumi',
          steps: [{ keys: ['{Tab}', 'l'] }, { type: 'api', delayMs: 80 }, { type: 'x' }, { waitFor: /deployed/g }, { sleep: 0 }],
          fps: 25,
          durationMs: 8000,
          tailMs: 0,
          formats: ['mp4', 'webp'],
        },
      ],
    });
    const [clip] = config.clips;
    expect(clip).toMatchObject({
      title: 'Deploy',
      caption: 'Deploying a service.',
      alt: 'A deploy in Rumi',
      fps: 25,
      durationMs: 8000,
      tailMs: 0,
      formats: ['mp4', 'webp'],
    });
    expect(clip?.steps.slice(0, 3)).toEqual([{ keys: ['{Tab}', 'l'] }, { type: 'api', delayMs: 80 }, { type: 'x' }]);
    const wait = clip?.steps[3];
    expect(wait && 'waitFor' in wait ? String(wait.waitFor) : '').toBe('/deployed/');
    expect(config.outputs.clips).toBe('docs/clips/{slug}-{lang}-{id}.{ext}');
  });

  it('reports every clip problem at once', () => {
    const issues = issuesOf({
      ...minimal,
      langs: ['en', 'pl'],
      outputs: { clips: 'clips/{id}.webp' },
      clips: [
        { id: 'resources', steps: [{ keys: '' }, { sleep: -1 }, { keys: 'j', sleep: 100 }, { press: 'j' }, 'j'] },
        { id: 'a b', steps: [], fps: 60, tailMs: 1.5, durationMs: 0, formats: ['webp', 'webp'], speed: 2 },
        { id: 'tour', steps: [{ type: 'x', delayMs: -5 }, { waitFor: 3 }, { keys: 'j', delayMs: 10 }] },
        { id: 'tour', steps: [{ sleep: 10 }], formats: ['avi'] },
        42,
      ],
    });
    expect(issues).toEqual([
      'outputs.clips: must contain {lang}, or every file overwrites the last',
      'outputs.clips: must contain {ext}, or every file overwrites the last',
      'outputs.clips: must end in .{ext}',
      'clips[0].id: "resources" is also a shot id; clips and shots share output folders, so pick another',
      "clips[0].steps[0].keys: must be a non-empty string or array of strings, such as '{Tab}' or ['j', 'j', '{Enter}'], got \"\"",
      'clips[0].steps[1].sleep: must be an integer >= 0, got number -1',
      'clips[0].steps[2]: has keys and sleep: use one per step, in the order they should run',
      'clips[0].steps[3]: must be one of { keys }, { type, delayMs? }, { waitFor } or { sleep }, got keys press',
      'clips[0].steps[4]: must be one of { keys }, { type, delayMs? }, { waitFor } or { sleep }, got "j"',
      expect.stringMatching(/^clips\[1\]\.speed: unknown key/),
      'clips[1].id: may only contain letters, digits, "-" and "_", got "a b"',
      'clips[1].steps: must be a non-empty array of { keys }, { type, delayMs? }, { waitFor } or { sleep }, got an empty array',
      'clips[1].fps: must be an integer between 1 and 50, got number 60',
      'clips[1].durationMs: must be an integer >= 1, got number 0',
      'clips[1].tailMs: must be an integer >= 0, got number 1.5',
      'clips[1].formats: must be a non-empty list of distinct formats from "webp", "gif", "mp4", got an array',
      'clips[2].steps[0].delayMs: must be an integer >= 0, got number -5',
      'clips[2].steps[1].waitFor: must be a non-empty string, got number 3',
      'clips[2].steps[2].delayMs: unknown key (expected one of: keys)',
      'clips[3].id: duplicates another clip id "tour"',
      'clips[3].formats: must be a non-empty list of distinct formats from "webp", "gif", "mp4", got an array',
      'clips[4]: must be an object, got number 42',
    ]);
    expect(issuesOf({ ...minimal, clips: { id: 'x' } })).toEqual(['clips: must be an array, got an object']);
  });

  it('refuses clips and outputs.clips in url and cdp mode: web clips come in v0.3', () => {
    const web = { name: 'App', shots: [{ id: 'home' }], clips: [{ id: 'tour', steps: [{ sleep: 100 }] }] };
    const message = 'web clips arrive in v0.3; clips only work with target.mode "tty" for now';
    expect(issuesOf({ ...web, target: { mode: 'url', url: 'http://localhost:3000' } })).toEqual([`config.clips: ${message}`]);
    expect(
      issuesOf({ ...web, target: { mode: 'cdp' }, outputs: { clips: 'x/{id}.{ext}' } }),
    ).toEqual([`config.clips: ${message}`, `outputs.clips: ${message}`]);
  });
});
