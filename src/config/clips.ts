import type { ClipFormat, ClipStep, ResolvedClip, ResolvedShot } from './types.js';
import { checkKeys, describe, ID, isObj, num, str, textPattern, type Issues } from './validate.js';

export const DEFAULT_CLIPS = 'assets/showcase/{lang}/{id}.{ext}';
export const CLIP_FORMATS: readonly ClipFormat[] = ['webp', 'gif', 'mp4'];
const DEFAULT_FORMATS: ClipFormat[] = ['webp', 'gif'];

/** Why `clips` and `outputs.clips` are refused in url and cdp mode. */
export const WEB_CLIPS_MESSAGE = 'web clips arrive in v0.3; clips only work with target.mode "tty" for now';

const STEP_SHAPES = '{ keys }, { type, delayMs? }, { waitFor } or { sleep }';

function keys(issues: Issues, path: string, value: unknown): ClipStep | undefined {
  if (typeof value === 'string' && value !== '') return { keys: value };
  if (Array.isArray(value) && value.length > 0 && value.every(part => typeof part === 'string' && part !== '')) {
    return { keys: value as string[] };
  }
  issues.add(path, `must be a non-empty string or array of strings, such as '{Tab}' or ['j', 'j', '{Enter}'], got ${describe(value)}`);
  return undefined;
}

function step(issues: Issues, path: string, value: unknown): ClipStep | undefined {
  if (!isObj(value)) {
    issues.add(path, `must be one of ${STEP_SHAPES}, got ${describe(value)}`);
    return undefined;
  }
  const kinds = ['keys', 'type', 'waitFor', 'sleep'].filter(kind => kind in value);
  if (kinds.length !== 1) {
    issues.add(
      path,
      kinds.length === 0
        ? `must be one of ${STEP_SHAPES}, got keys ${Object.keys(value).join(', ') || '(none)'}`
        : `has ${kinds.join(' and ')}: use one per step, in the order they should run`,
    );
    return undefined;
  }
  const kind = kinds[0];
  checkKeys(issues, path, value, kind === 'type' ? ['type', 'delayMs'] : [kind ?? '']);
  if (kind === 'keys') return keys(issues, `${path}.keys`, value.keys);
  if (kind === 'type') {
    const text = str(issues, `${path}.type`, value.type, true);
    if (value.delayMs === undefined) return { type: text };
    return { type: text, delayMs: num(issues, `${path}.delayMs`, value.delayMs, 0, { min: 0, integer: true }) };
  }
  if (kind === 'waitFor') {
    const pattern = textPattern(issues, `${path}.waitFor`, value.waitFor);
    return pattern === undefined ? undefined : { waitFor: pattern };
  }
  return { sleep: num(issues, `${path}.sleep`, value.sleep, 0, { min: 0, integer: true }) };
}

function formats(issues: Issues, path: string, value: unknown): ClipFormat[] {
  if (value === undefined) return [...DEFAULT_FORMATS];
  const valid =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(format => CLIP_FORMATS.includes(format as ClipFormat)) &&
    new Set(value).size === value.length;
  if (!valid) {
    issues.add(path, `must be a non-empty list of distinct formats from "webp", "gif", "mp4", got ${describe(value)}`);
    return [...DEFAULT_FORMATS];
  }
  return value as ClipFormat[];
}

/** Check `clips` (tty mode). Ids are unique and must not repeat a shot id: clips and shots share output folders. */
export function resolveClips(issues: Issues, value: unknown, name: string, shots: ResolvedShot[]): ResolvedClip[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.add('clips', `must be an array, got ${describe(value)}`);
    return [];
  }
  const seen = new Set<string>();
  const clips: ResolvedClip[] = [];
  value.forEach((entry: unknown, index) => {
    const path = `clips[${String(index)}]`;
    if (!isObj(entry)) {
      issues.add(path, `must be an object, got ${describe(entry)}`);
      return;
    }
    checkKeys(issues, path, entry, ['id', 'title', 'caption', 'alt', 'steps', 'fps', 'durationMs', 'tailMs', 'formats']);
    const id = str(issues, `${path}.id`, entry.id, true);
    if (id && !ID.test(id)) issues.add(`${path}.id`, `may only contain letters, digits, "-" and "_", got "${id}"`);
    if (id && seen.has(id)) issues.add(`${path}.id`, `duplicates another clip id "${id}"`);
    if (id && shots.some(shot => shot.id === id)) {
      issues.add(`${path}.id`, `"${id}" is also a shot id; clips and shots share output folders, so pick another`);
    }
    seen.add(id);

    const steps: ClipStep[] = [];
    if (Array.isArray(entry.steps) && entry.steps.length > 0) {
      entry.steps.forEach((raw: unknown, stepIndex) => {
        const resolved = step(issues, `${path}.steps[${String(stepIndex)}]`, raw);
        if (resolved) steps.push(resolved);
      });
    } else {
      issues.add(`${path}.steps`, `must be a non-empty array of ${STEP_SHAPES}, got ${describe(entry.steps)}`);
    }

    const title = str(issues, `${path}.title`, entry.title) ?? id;
    clips.push({
      id,
      title,
      caption: str(issues, `${path}.caption`, entry.caption),
      alt: str(issues, `${path}.alt`, entry.alt) ?? `${name}: ${title}`,
      steps,
      // Above 50 fps a GIF frame would be under 20 ms, which browsers play as 100 ms.
      fps: num(issues, `${path}.fps`, entry.fps, 10, { min: 1, max: 50, integer: true }),
      durationMs:
        entry.durationMs === undefined
          ? undefined
          : num(issues, `${path}.durationMs`, entry.durationMs, 0, { min: 1, integer: true }),
      tailMs: num(issues, `${path}.tailMs`, entry.tailMs, 1500, { min: 0, integer: true }),
      formats: formats(issues, `${path}.formats`, entry.formats),
    });
  });
  return clips;
}
