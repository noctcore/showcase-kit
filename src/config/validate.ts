import { templateTokens } from '../template.js';

// Small validators shared by the config resolvers. Each reports into `Issues` and returns a usable fallback, so one
// run lists every problem instead of stopping at the first.

export const ID = /^[A-Za-z0-9_-]+$/;
// Colors end up inside a CSS declaration. Allow color syntax only: characters that cannot close the
// declaration, and no functions but color functions (so no url() fetches or image-set()).
const CSS_COLOR = /^[#\w\s(),.%/+-]+$/;
const CSS_COLOR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix']);

function isCssColor(text: string): boolean {
  if (!CSS_COLOR.test(text)) return false;
  return [...text.matchAll(/([\w-]+)\s*\(/g)].every(match => CSS_COLOR_FUNCTIONS.has((match[1] ?? '').toLowerCase()));
}

export type Obj = Record<string, unknown>;

/** Collects every problem instead of stopping at the first, so one run shows the whole list. */
export class Issues {
  readonly list: string[] = [];

  add(path: string, message: string): void {
    this.list.push(`${path}: ${message}`);
  }
}

export function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? 'an empty array' : 'an array';
  if (typeof value === 'string') return `"${value}"`;
  return typeof value === 'object' ? 'an object' : `${typeof value} ${String(value)}`;
}

/**
 * Every key must be in `allowed`. A key that belongs to another mode gets the message in `elsewhere` (for example
 * "not used in tty mode") instead of "unknown key".
 */
export function checkKeys(
  issues: Issues,
  path: string,
  value: Obj,
  allowed: readonly string[],
  elsewhere: Readonly<Record<string, string>> = {},
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    issues.add(`${path}.${key}`, (Object.hasOwn(elsewhere, key) ? elsewhere[key] : undefined) ?? `unknown key (expected one of: ${allowed.join(', ')})`);
  }
}

export function str(issues: Issues, path: string, value: unknown, required: true): string;
export function str(issues: Issues, path: string, value: unknown, required?: false): string | undefined;
export function str(issues: Issues, path: string, value: unknown, required = false): string | undefined {
  if (value === undefined) {
    if (required) issues.add(path, 'is required');
    return required ? '' : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    issues.add(path, `must be a non-empty string, got ${describe(value)}`);
    return required ? '' : undefined;
  }
  return value;
}

export function num(
  issues: Issues,
  path: string,
  value: unknown,
  fallback: number,
  { min, max, integer = false }: { min: number; max?: number; integer?: boolean },
): number {
  if (value === undefined) return fallback;
  const ok =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    (max === undefined || value <= max) &&
    (!integer || Number.isInteger(value));
  if (!ok) {
    const range = max === undefined ? `>= ${String(min)}` : `between ${String(min)} and ${String(max)}`;
    issues.add(path, `must be ${integer ? 'an integer' : 'a number'} ${range}, got ${describe(value)}`);
    return fallback;
  }
  return value;
}

export function bool(issues: Issues, path: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    issues.add(path, `must be true or false, got ${describe(value)}`);
    return fallback;
  }
  return value;
}

export function oneOf<T extends string>(issues: Issues, path: string, value: unknown, options: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !options.includes(value as T)) {
    issues.add(path, `must be one of ${options.map(option => `"${option}"`).join(', ')}, got ${describe(value)}`);
    return fallback;
  }
  return value as T;
}

export function color(issues: Issues, path: string, value: unknown): string {
  const text = str(issues, path, value, true);
  if (text && !isCssColor(text)) {
    issues.add(path, `is not a CSS color: "${text}"`);
  }
  return text;
}

export function stringRecord(issues: Issues, path: string, value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObj(value) || Object.values(value).some(entry => typeof entry !== 'string')) {
    issues.add(path, 'must be an object of string values');
    return undefined;
  }
  return value as Record<string, string>;
}

/** Path templates must only use known tokens, and must include the ones that keep files apart. */
export function pathTemplate(
  issues: Issues,
  path: string,
  value: unknown,
  fallback: string,
  { allowed, required, extensions }: { allowed: string[]; required: string[]; extensions?: string[] },
): string {
  const template = value === undefined ? fallback : str(issues, path, value, true);
  if (!template) return fallback;
  for (const token of templateTokens(template)) {
    if (!allowed.includes(token)) {
      issues.add(path, `unknown token {${token}} (allowed: ${allowed.map(name => `{${name}}`).join(', ')})`);
    }
  }
  for (const token of required) {
    if (!template.includes(`{${token}}`)) {
      issues.add(path, `must contain {${token}}, or every file overwrites the last`);
    }
  }
  if (extensions && !extensions.some(extension => template.toLowerCase().endsWith(extension))) {
    issues.add(path, `must end in ${extensions.join(' or ')}`);
  }
  return template;
}

/** A copy without the g and y flags: they keep `lastIndex` between `test()` calls, so every other test would fail. */
export function statelessRegExp(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
}

/** Text to find: a non-empty string or a RegExp. */
export function textPattern(issues: Issues, path: string, value: unknown): string | RegExp | undefined {
  return value instanceof RegExp ? statelessRegExp(value) : str(issues, path, value);
}

/** A CSS selector. A RegExp means someone wrote a tty mode config for a web target: say so. */
export function selector(issues: Issues, path: string, value: unknown): string | undefined {
  if (value instanceof RegExp) {
    issues.add(path, 'must be a selector string in url and cdp mode (a RegExp is screen text, for tty mode)');
    return undefined;
  }
  return str(issues, path, value);
}

export interface ShotBase {
  id: string;
  title: string;
  caption: string | undefined;
  alt: string;
  delayMs: number;
}

/** The fields every shot has and the checks across shots (unique ids); `extra` resolves the mode's own fields. */
export function resolveShotList<T>(
  issues: Issues,
  value: unknown,
  { name, allowed, elsewhere, extra }: {
    name: string;
    allowed: readonly string[];
    elsewhere: Readonly<Record<string, string>>;
    extra: (entry: Obj, path: string) => T;
  },
): (ShotBase & T)[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.add('shots', `must be a non-empty array, got ${describe(value)}`);
    return [];
  }
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    const path = `shots[${String(index)}]`;
    if (!isObj(entry)) {
      issues.add(path, `must be an object, got ${describe(entry)}`);
      return { id: `shot-${String(index)}`, title: '', caption: undefined, alt: '', delayMs: 0, ...extra({}, path) };
    }
    checkKeys(issues, path, entry, ['id', 'title', 'caption', 'alt', 'waitFor', 'delayMs', ...allowed], elsewhere);
    const id = str(issues, `${path}.id`, entry.id, true);
    if (id && !ID.test(id)) {
      issues.add(`${path}.id`, `may only contain letters, digits, "-" and "_", got "${id}"`);
    }
    if (id && seen.has(id)) {
      issues.add(`${path}.id`, `duplicates another shot id "${id}"`);
    }
    seen.add(id);
    const title = str(issues, `${path}.title`, entry.title) ?? id;
    return {
      id,
      title,
      caption: str(issues, `${path}.caption`, entry.caption),
      alt: str(issues, `${path}.alt`, entry.alt) ?? `${name}: ${title}`,
      delayMs: num(issues, `${path}.delayMs`, entry.delayMs, 0, { min: 0, integer: true }),
      ...extra(entry, path),
    };
  });
}
