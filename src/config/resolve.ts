import { isAbsolute, resolve } from 'node:path';
import { ConfigError } from '../errors.js';
import { templateTokens } from '../template.js';
import type {
  ResolvedBackground,
  ResolvedConfig,
  ResolvedFrame,
  ResolvedHero,
  ResolvedPortfolio,
  ResolvedShot,
  Target,
} from './types.js';

export const DEFAULT_RAW = 'showcase-out/raw/{lang}/{id}.png';
export const DEFAULT_README = 'assets/showcase/{lang}/{id}.webp';
export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

const DEFAULT_BACKGROUND: ResolvedBackground = { type: 'gradient', from: '#0f766e', to: '#1e1b4b', angle: 135 };

const ID = /^[A-Za-z0-9_-]+$/;
// Colors end up inside a CSS declaration. Allow color syntax, refuse anything that could close it.
const CSS_COLOR = /^[#\w\s(),.%/+-]+$/;

type Obj = Record<string, unknown>;

/** Collects every problem instead of stopping at the first, so one run shows the whole list. */
class Issues {
  readonly list: string[] = [];

  add(path: string, message: string): void {
    this.list.push(`${path}: ${message}`);
  }
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `"${value}"`;
  return typeof value === 'object' ? 'an object' : `${typeof value} ${String(value)}`;
}

function checkKeys(issues: Issues, path: string, value: Obj, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.add(`${path}.${key}`, `unknown key (expected one of: ${allowed.join(', ')})`);
    }
  }
}

function str(issues: Issues, path: string, value: unknown, required: true): string;
function str(issues: Issues, path: string, value: unknown, required?: false): string | undefined;
function str(issues: Issues, path: string, value: unknown, required = false): string | undefined {
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

function num(
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

function bool(issues: Issues, path: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    issues.add(path, `must be true or false, got ${describe(value)}`);
    return fallback;
  }
  return value;
}

function oneOf<T extends string>(issues: Issues, path: string, value: unknown, options: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !options.includes(value as T)) {
    issues.add(path, `must be one of ${options.map(option => `"${option}"`).join(', ')}, got ${describe(value)}`);
    return fallback;
  }
  return value as T;
}

function color(issues: Issues, path: string, value: unknown): string {
  const text = str(issues, path, value, true);
  if (text && !CSS_COLOR.test(text)) {
    issues.add(path, `is not a CSS color: "${text}"`);
  }
  return text;
}

function stringRecord(issues: Issues, path: string, value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObj(value) || Object.values(value).some(entry => typeof entry !== 'string')) {
    issues.add(path, 'must be an object of string values');
    return undefined;
  }
  return value as Record<string, string>;
}

/** Path templates must only use known tokens, and must include the ones that keep files apart. */
function pathTemplate(
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

function resolveTarget(issues: Issues, value: unknown): ResolvedConfig['target'] {
  if (!isObj(value)) {
    issues.add('target', `must be an object with mode "url" or "cdp", got ${describe(value)}`);
    return { mode: 'url', url: 'http://localhost', readyTimeoutMs: 60_000 };
  }
  const readyTimeoutMs = num(issues, 'target.readyTimeoutMs', value.readyTimeoutMs, 60_000, { min: 1, integer: true });
  const start = str(issues, 'target.start', value.start);
  const cwd = str(issues, 'target.cwd', value.cwd);
  const env = stringRecord(issues, 'target.env', value.env);
  const common = { start, cwd, env, readyTimeoutMs };

  if (value.mode === 'url') {
    checkKeys(issues, 'target', value, ['mode', 'url', 'start', 'cwd', 'env', 'readyTimeoutMs', 'reuseExisting']);
    const url = str(issues, 'target.url', value.url, true);
    if (url && !/^https?:\/\//.test(url)) {
      issues.add('target.url', `must start with http:// or https://, got "${url}"`);
    }
    return { mode: 'url', url, ...common, reuseExisting: bool(issues, 'target.reuseExisting', value.reuseExisting, true) };
  }
  if (value.mode === 'cdp') {
    checkKeys(issues, 'target', value, ['mode', 'cdpUrl', 'pageMatch', 'start', 'cwd', 'env', 'readyTimeoutMs']);
    const cdpUrl = str(issues, 'target.cdpUrl', value.cdpUrl) ?? DEFAULT_CDP_URL;
    if (!/^(https?|wss?):\/\//.test(cdpUrl)) {
      issues.add('target.cdpUrl', `must start with http://, https://, ws:// or wss://, got "${cdpUrl}"`);
    }
    let pageMatch: string | RegExp | undefined;
    if (value.pageMatch instanceof RegExp) {
      pageMatch = value.pageMatch;
    } else {
      pageMatch = str(issues, 'target.pageMatch', value.pageMatch);
    }
    return { mode: 'cdp', cdpUrl, pageMatch, ...common };
  }
  issues.add('target.mode', `must be "url" or "cdp", got ${describe(value.mode)}`);
  return { mode: 'url', url: 'http://localhost', readyTimeoutMs };
}

function resolveNav(issues: Issues, path: string, value: unknown): ResolvedShot['nav'] {
  if (value === undefined || typeof value === 'function') return value as ResolvedShot['nav'];
  if (typeof value === 'string') return str(issues, path, value);
  if (isObj(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && (keys[0] === 'click' || keys[0] === 'goto')) {
      const target = str(issues, `${path}.${keys[0]}`, value[keys[0]], true);
      return keys[0] === 'click' ? { click: target } : { goto: target };
    }
  }
  issues.add(path, `must be a selector, a path, { click }, { goto } or a function, got ${describe(value)}`);
  return undefined;
}

function resolveShots(issues: Issues, value: unknown, name: string): ResolvedShot[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.add('shots', `must be a non-empty array, got ${describe(value)}`);
    return [];
  }
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    const path = `shots[${String(index)}]`;
    if (!isObj(entry)) {
      issues.add(path, `must be an object, got ${describe(entry)}`);
      return { id: `shot-${String(index)}`, title: '', alt: '', delayMs: 0 };
    }
    checkKeys(issues, path, entry, ['id', 'title', 'caption', 'alt', 'nav', 'waitFor', 'delayMs']);
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
      nav: resolveNav(issues, `${path}.nav`, entry.nav),
      waitFor: str(issues, `${path}.waitFor`, entry.waitFor),
      delayMs: num(issues, `${path}.delayMs`, entry.delayMs, 0, { min: 0, integer: true }),
    };
  });
}

function resolveBackground(
  issues: Issues,
  value: unknown,
  path = 'frame.background',
  fallback: ResolvedBackground = DEFAULT_BACKGROUND,
): ResolvedBackground {
  if (value === undefined) return fallback;
  if (typeof value === 'string') return { type: 'solid', color: color(issues, path, value) };
  if (isObj(value)) {
    if (value.type === 'solid') {
      checkKeys(issues, path, value, ['type', 'color']);
      return { type: 'solid', color: color(issues, `${path}.color`, value.color) };
    }
    if (value.type === 'gradient') {
      checkKeys(issues, path, value, ['type', 'from', 'to', 'angle']);
      return {
        type: 'gradient',
        from: color(issues, `${path}.from`, value.from),
        to: color(issues, `${path}.to`, value.to),
        angle: num(issues, `${path}.angle`, value.angle, 135, { min: -360, max: 360 }),
      };
    }
    if (value.type === 'transparent') {
      checkKeys(issues, path, value, ['type']);
      return { type: 'transparent' };
    }
  }
  issues.add(path, `must be a color string or { type: "solid" | "gradient" | "transparent" }, got ${describe(value)}`);
  return fallback;
}

function resolveFrame(issues: Issues, value: unknown): ResolvedFrame {
  const frame = value === undefined ? {} : value;
  if (!isObj(frame)) {
    issues.add('frame', `must be an object, got ${describe(frame)}`);
    return resolveFrame(issues, {});
  }
  checkKeys(issues, 'frame', frame, ['style', 'theme', 'title', 'background', 'padding', 'radius', 'shadow', 'quality', 'maxWidth']);
  let title: string | false = '{name}';
  if (frame.title === false) {
    title = false;
  } else if (frame.title !== undefined) {
    title = str(issues, 'frame.title', frame.title) ?? '{name}';
  }
  return {
    style: oneOf(issues, 'frame.style', frame.style, ['window', 'minimal', 'none'] as const, 'window'),
    theme: oneOf(issues, 'frame.theme', frame.theme, ['light', 'dark'] as const, 'dark'),
    title,
    background: resolveBackground(issues, frame.background),
    padding: num(issues, 'frame.padding', frame.padding, 72, { min: 0, integer: true }),
    radius: num(issues, 'frame.radius', frame.radius, 14, { min: 0, integer: true }),
    shadow: bool(issues, 'frame.shadow', frame.shadow, true),
    quality: num(issues, 'frame.quality', frame.quality, 90, { min: 1, max: 100, integer: true }),
    maxWidth: frame.maxWidth === undefined ? undefined : num(issues, 'frame.maxWidth', frame.maxWidth, 0, { min: 1, integer: true }),
  };
}

function resolvePortfolio(
  issues: Issues,
  value: unknown,
  shots: ResolvedShot[],
  langs: string[],
): ResolvedPortfolio | undefined {
  if (value === undefined) return undefined;
  if (!isObj(value)) {
    issues.add('outputs.portfolio', `must be an object, got ${describe(value)}`);
    return undefined;
  }
  const path = 'outputs.portfolio';
  checkKeys(issues, path, value, ['dir', 'size', 'format', 'quality', 'thumbnail', 'lang', 'publicPath', 'padding']);
  const dir = pathTemplate(issues, `${path}.dir`, value.dir, '', { allowed: ['slug'], required: [] });
  if (value.dir === undefined) issues.add(`${path}.dir`, 'is required');

  let size: [number, number] = [1920, 1080];
  if (value.size !== undefined) {
    const valid =
      Array.isArray(value.size) &&
      value.size.length === 2 &&
      value.size.every(side => typeof side === 'number' && Number.isInteger(side) && side >= 16 && side <= 8192);
    if (valid) {
      size = value.size as [number, number];
    } else {
      issues.add(`${path}.size`, `must be [width, height] in whole pixels (16 to 8192), got ${describe(value.size)}`);
    }
  }

  const thumbnail = str(issues, `${path}.thumbnail`, value.thumbnail) ?? shots[0]?.id ?? '';
  if (value.thumbnail !== undefined && !shots.some(shot => shot.id === thumbnail)) {
    issues.add(`${path}.thumbnail`, `"${thumbnail}" is not a shot id (${shots.map(shot => shot.id).join(', ')})`);
  }
  const lang = str(issues, `${path}.lang`, value.lang) ?? langs[0] ?? 'en';
  if (value.lang !== undefined && !langs.includes(lang)) {
    issues.add(`${path}.lang`, `"${lang}" is not in langs (${langs.join(', ')})`);
  }
  const publicPath = pathTemplate(issues, `${path}.publicPath`, value.publicPath, '/projects/{slug}', {
    allowed: ['slug'],
    required: [],
  });

  return {
    dir,
    size,
    format: oneOf(issues, `${path}.format`, value.format, ['webp', 'png'] as const, 'webp'),
    quality: num(issues, `${path}.quality`, value.quality, 90, { min: 1, max: 100, integer: true }),
    thumbnail,
    lang,
    publicPath: publicPath.replace(/\/+$/, ''),
    padding: num(issues, `${path}.padding`, value.padding, 96, { min: 0, integer: true }),
  };
}

function resolveHero(
  issues: Issues,
  value: unknown,
  { shots, langs, frame }: { shots: ResolvedShot[]; langs: string[]; frame: ResolvedFrame },
): ResolvedHero {
  const hero = value === undefined ? {} : value;
  if (!isObj(hero)) {
    issues.add('hero', `must be an object, got ${describe(hero)}`);
    return resolveHero(issues, {}, { shots, langs, frame });
  }
  checkKeys(issues, 'hero', hero, ['tagline', 'logo', 'shots', 'lang', 'output', 'size', 'background', 'theme', 'quality']);

  let heroShots = shots.slice(0, 3).map(shot => shot.id);
  if (hero.shots !== undefined) {
    const valid =
      Array.isArray(hero.shots) &&
      hero.shots.length >= 1 &&
      hero.shots.length <= 3 &&
      hero.shots.every(id => typeof id === 'string');
    if (valid) {
      heroShots = hero.shots as string[];
      for (const id of heroShots) {
        if (!shots.some(shot => shot.id === id)) issues.add('hero.shots', `"${id}" is not a shot id`);
      }
    } else {
      issues.add('hero.shots', `must be an array of one to three shot ids, got ${describe(hero.shots)}`);
    }
  }
  let size: [number, number] = [1280, 640];
  if (hero.size !== undefined) {
    const valid =
      Array.isArray(hero.size) &&
      hero.size.length === 2 &&
      hero.size.every(side => typeof side === 'number' && Number.isInteger(side) && side >= 320 && side <= 8192);
    if (valid) size = hero.size as [number, number];
    else issues.add('hero.size', `must be [width, height] in whole pixels (320 to 8192), got ${describe(hero.size)}`);
  }
  const lang = str(issues, 'hero.lang', hero.lang) ?? langs[0] ?? 'en';
  if (hero.lang !== undefined && !langs.includes(lang)) issues.add('hero.lang', `"${lang}" is not in langs`);

  return {
    tagline: str(issues, 'hero.tagline', hero.tagline),
    logo: str(issues, 'hero.logo', hero.logo),
    shots: heroShots,
    lang,
    output: pathTemplate(issues, 'hero.output', hero.output, 'assets/showcase/hero.webp', {
      allowed: ['lang', 'slug'],
      required: [],
      extensions: ['.webp', '.png'],
    }),
    size,
    background: resolveBackground(issues, hero.background, 'hero.background', frame.background),
    theme: oneOf(issues, 'hero.theme', hero.theme, ['light', 'dark'] as const, frame.theme),
    quality: num(issues, 'hero.quality', hero.quality, 90, { min: 1, max: 100, integer: true }),
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Validate a user config and fill in every default.
 *
 * @param input the object a config file exported
 * @param root directory relative paths resolve against (normally the config file's directory)
 * @param source file name shown in error messages
 */
export function resolveConfig(input: unknown, root: string, source?: string): ResolvedConfig {
  const issues = new Issues();
  if (!isObj(input)) {
    throw new ConfigError([`the config must export an object, got ${describe(input)}`], source);
  }
  checkKeys(issues, 'config', input, [
    'name',
    'slug',
    'root',
    'target',
    'ready',
    'viewport',
    'deviceScaleFactor',
    'colorScheme',
    'langs',
    'css',
    'setup',
    'shots',
    'frame',
    'outputs',
    'hero',
    'browser',
    'timeouts',
  ]);

  const name = str(issues, 'name', input.name, true);
  const slug = str(issues, 'slug', input.slug) ?? slugify(name);
  if (slug && !ID.test(slug)) issues.add('slug', `may only contain letters, digits, "-" and "_", got "${slug}"`);
  const rootDir = resolve(root, str(issues, 'root', input.root) ?? '.');

  let viewport = { width: 1440, height: 900 };
  if (input.viewport !== undefined) {
    if (isObj(input.viewport)) {
      checkKeys(issues, 'viewport', input.viewport, ['width', 'height']);
      viewport = {
        width: num(issues, 'viewport.width', input.viewport.width, 1440, { min: 16, max: 8192, integer: true }),
        height: num(issues, 'viewport.height', input.viewport.height, 900, { min: 16, max: 8192, integer: true }),
      };
    } else {
      issues.add('viewport', `must be { width, height }, got ${describe(input.viewport)}`);
    }
  }

  let langs = ['en'];
  if (input.langs !== undefined) {
    const valid =
      Array.isArray(input.langs) &&
      input.langs.length > 0 &&
      input.langs.every(lang => typeof lang === 'string' && ID.test(lang));
    if (valid) {
      langs = input.langs as string[];
    } else {
      issues.add('langs', `must be a non-empty array of language codes, got ${describe(input.langs)}`);
    }
  }

  if (input.setup !== undefined && typeof input.setup !== 'function') {
    issues.add('setup', `must be a function, got ${describe(input.setup)}`);
  }

  const shots = resolveShots(issues, input.shots, name);

  const outputs = input.outputs === undefined ? {} : input.outputs;
  let raw = DEFAULT_RAW;
  let readme = DEFAULT_README;
  let portfolio: ResolvedPortfolio | undefined;
  if (isObj(outputs)) {
    checkKeys(issues, 'outputs', outputs, ['raw', 'readme', 'portfolio']);
    const required = langs.length > 1 ? ['id', 'lang'] : ['id'];
    const allowed = ['lang', 'id', 'slug'];
    raw = pathTemplate(issues, 'outputs.raw', outputs.raw, DEFAULT_RAW, { allowed, required, extensions: ['.png'] });
    readme = pathTemplate(issues, 'outputs.readme', outputs.readme, DEFAULT_README, {
      allowed,
      required,
      extensions: ['.webp', '.png'],
    });
    portfolio = resolvePortfolio(issues, outputs.portfolio, shots, langs);
  } else {
    issues.add('outputs', `must be an object, got ${describe(outputs)}`);
  }

  const browser = input.browser === undefined ? {} : input.browser;
  if (isObj(browser)) {
    checkKeys(issues, 'browser', browser, ['channel', 'executablePath', 'headless', 'args']);
    str(issues, 'browser.channel', browser.channel);
    str(issues, 'browser.executablePath', browser.executablePath);
    bool(issues, 'browser.headless', browser.headless, true);
    if (browser.args !== undefined && (!Array.isArray(browser.args) || browser.args.some(arg => typeof arg !== 'string'))) {
      issues.add('browser.args', 'must be an array of strings');
    }
  } else {
    issues.add('browser', `must be an object, got ${describe(browser)}`);
  }

  const timeouts = input.timeouts === undefined ? {} : input.timeouts;
  let resolvedTimeouts = { readyMs: 30_000, shotMs: 15_000, networkIdleMs: 3_000 };
  if (isObj(timeouts)) {
    checkKeys(issues, 'timeouts', timeouts, ['readyMs', 'shotMs', 'networkIdleMs']);
    resolvedTimeouts = {
      readyMs: num(issues, 'timeouts.readyMs', timeouts.readyMs, 30_000, { min: 1, integer: true }),
      shotMs: num(issues, 'timeouts.shotMs', timeouts.shotMs, 15_000, { min: 1, integer: true }),
      networkIdleMs: num(issues, 'timeouts.networkIdleMs', timeouts.networkIdleMs, 3_000, { min: 0, integer: true }),
    };
  } else {
    issues.add('timeouts', `must be an object, got ${describe(timeouts)}`);
  }

  const target: Target & { readyTimeoutMs: number } = resolveTarget(issues, input.target);
  if (target.cwd !== undefined && !isAbsolute(target.cwd)) {
    target.cwd = resolve(rootDir, target.cwd);
  }

  const frame = resolveFrame(issues, input.frame);
  const config: ResolvedConfig = {
    name,
    slug,
    root: rootDir,
    target,
    ready: str(issues, 'ready', input.ready),
    viewport,
    deviceScaleFactor: num(issues, 'deviceScaleFactor', input.deviceScaleFactor, 2, { min: 0.25, max: 4 }),
    colorScheme: oneOf(issues, 'colorScheme', input.colorScheme, ['light', 'dark', 'no-preference'] as const, 'dark'),
    langs,
    css: str(issues, 'css', input.css),
    setup: input.setup as ResolvedConfig['setup'],
    shots,
    frame,
    outputs: { raw, readme, portfolio },
    hero: resolveHero(issues, input.hero, { shots, langs, frame }),
    browser: isObj(browser) ? (browser as ResolvedConfig['browser']) : {},
    timeouts: resolvedTimeouts,
  };

  if (issues.list.length > 0) {
    throw new ConfigError(issues.list, source);
  }
  return config;
}
