/**
 * Asks the built validator (`resolveConfig` from dist/) what it accepts,
 * instead of reading validation code as text: a key it does not know makes it
 * answer "unknown key (expected one of: ...)", a key of the other mode gets a
 * message of its own, and a path template with a stray token lists the tokens
 * it allows.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT, SITE_DIR } from '../site';
import type { ConfigMode } from './types';

export const DIST_INDEX = join(REPO_ROOT, 'dist', 'index.js');
/** Relative paths in the fixtures resolve here; nothing is read or written. */
export const FIXTURE_ROOT = SITE_DIR;

export interface Library {
  resolveConfig(input: unknown, root: string, source?: string): Record<string, unknown>;
}

let library: Library | undefined;

/** The built library. The site reads dist/, so `bun run build` at the root comes first. */
export async function loadLibrary(): Promise<Library> {
  if (library) return library;
  if (!existsSync(DIST_INDEX)) {
    throw new Error(`${DIST_INDEX} is missing. Run \`bun run build\` at the repo root first.`);
  }
  library = (await import(pathToFileURL(DIST_INDEX).href)) as Library;
  return library;
}

export type FixtureName = 'url' | 'cdp' | 'tty';

export const FIXTURE_MODE: Record<FixtureName, ConfigMode> = { url: 'web', cdp: 'web', tty: 'tty' };

/**
 * The smallest valid config of each kind: the required keys, plus the required
 * keys of the optional sections whose defaults only show when they exist
 * (`outputs.portfolio`, one clip).
 */
export function fixture(name: FixtureName): Record<string, unknown> {
  const shots = [{ id: 'home' }];
  const portfolio = { dir: 'portfolio' };
  if (name === 'url') {
    return { name: 'Demo App', target: { mode: 'url', url: 'http://localhost:5173' }, shots, outputs: { portfolio } };
  }
  if (name === 'cdp') return { name: 'Demo App', target: { mode: 'cdp' }, shots, outputs: { portfolio } };
  return {
    name: 'Demo App',
    target: { mode: 'tty', command: 'demo' },
    shots,
    outputs: { portfolio },
    clips: [{ id: 'tour', steps: [{ sleep: 100 }] }],
  };
}

/** The fixture that stands for a mode outside the target section. */
export const MODE_FIXTURE: Record<ConfigMode, FixtureName> = { web: 'url', tty: 'tty' };

/** `clips[].steps` -> `[['clips', 0], ['steps']]`: where a key lives in a config object. */
export type Segment = [key: string, index?: number];

export function segmentsOf(path: string, array = false): Segment[] {
  if (path === '') return [];
  const parts = path.split('.');
  return parts.map((part, i) => {
    const key = part.replace(/\[\]$/, '');
    const indexed = part.endsWith('[]') || (array && i === parts.length - 1);
    return indexed ? [key, 0] : [key];
  });
}

/** How the validator names a path in its messages: `clips[0].steps[0]`, or `config` for the top level. */
export function issuePath(segments: Segment[]): string {
  if (segments.length === 0) return 'config';
  return segments.map(([key, index]) => (index === undefined ? key : `${key}[${String(index)}]`)).join('.');
}

/**
 * Put `value` at `segments` in a copy of `config`, creating objects on the
 * way. With `merge`, an existing object there gets the value's keys instead.
 */
export function setAt(config: Record<string, unknown>, segments: Segment[], value: unknown, merge = false): Record<string, unknown> {
  const copy = structuredClone(config);
  let node: Record<string, unknown> = copy;
  segments.forEach(([key, index], i) => {
    const last = i === segments.length - 1;
    if (index === undefined) {
      if (last) {
        const current = node[key];
        node[key] = merge && isObject(current) && isObject(value) ? { ...current, ...value } : value;
      } else {
        if (!isObject(node[key])) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
      return;
    }
    if (!Array.isArray(node[key])) node[key] = [];
    const list = node[key] as unknown[];
    if (last) {
      const current = list[index];
      list[index] = merge && isObject(current) && isObject(value) ? { ...current, ...value } : value;
    } else {
      if (!isObject(list[index])) list[index] = {};
      node = list[index] as Record<string, unknown>;
    }
  });
  return copy;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The validator's problems with a config, or `[]` when it resolves. */
export async function issuesOf(config: unknown): Promise<string[]> {
  const { resolveConfig } = await loadLibrary();
  try {
    resolveConfig(config, FIXTURE_ROOT, 'probe');
    return [];
  } catch (error) {
    const issues = (error as { issues?: unknown }).issues;
    if (!Array.isArray(issues)) throw error;
    return issues.map(String);
  }
}

const PROBE = '__probe__';

/**
 * The keys the validator accepts in the object at `segments`, found by adding
 * an unknown key there. `null` when it answers without a list (it checks that
 * object some other way).
 */
export async function acceptedKeys(config: Record<string, unknown>, segments: Segment[], form?: Record<string, unknown>): Promise<string[] | null> {
  let probed: Record<string, unknown>;
  if (form) probed = setAt(config, segments, { ...form, [PROBE]: true });
  else if (segments.length === 0) probed = { ...structuredClone(config), [PROBE]: true };
  else probed = setAt(config, segments, { [PROBE]: true }, true);
  const prefix = `${issuePath(segments)}.${PROBE}: unknown key (expected one of: `;
  const issue = (await issuesOf(probed)).find((line) => line.startsWith(prefix));
  if (!issue) return null;
  return issue.slice(prefix.length, -1).split(', ');
}

/** What the validator says about `key` in the object at `segments`. */
export async function messageFor(config: Record<string, unknown>, segments: Segment[], key: string): Promise<string | undefined> {
  const probed = setAt(config, [...segments, [key]], null);
  const prefix = `${issuePath(segments)}.${key}: `;
  const issue = (await issuesOf(probed)).find((line) => line.startsWith(prefix));
  return issue?.slice(prefix.length);
}

export interface TemplateProbe {
  allowed: string[];
  required: string[];
  requiredMultiLang: string[];
  extensions: string[];
  validated: boolean;
}

/** The tokens and endings the validator allows and requires for the path template at `path`. */
export async function templateRules(name: FixtureName, path: string): Promise<TemplateProbe> {
  const segments = segmentsOf(path);
  const at = issuePath(segments);
  const lines = async (config: Record<string, unknown>, value: string): Promise<string[]> =>
    (await issuesOf(setAt(config, segments, value)))
      .filter((line) => line.startsWith(`${at}: `))
      .map((line) => line.slice(at.length + 2));

  const stray = await lines(fixture(name), `{${PROBE}}`);
  const allowedLine = stray.find((line) => line.startsWith(`unknown token {${PROBE}} (allowed: `));
  const allowed = allowedLine ? [...allowedLine.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((t) => t !== PROBE) : [];

  const tokensRequired = (found: string[]): string[] =>
    found.flatMap((line) => /^must contain \{(\w+)\}/.exec(line)?.[1] ?? []);
  const bare = await lines(fixture(name), 'probe');
  const multi = await lines({ ...fixture(name), langs: ['en', 'pl'] }, 'probe');
  const ending = bare.find((line) => line.startsWith('must end in '));

  return {
    allowed,
    required: tokensRequired(bare),
    requiredMultiLang: tokensRequired(multi),
    extensions: ending ? ending.slice('must end in '.length).split(' or ') : [],
    validated: allowedLine !== undefined,
  };
}
