import { isAbsolute, resolve } from 'node:path';
import { ConfigError } from '../errors.js';
import { trimTrailing } from '../text.js';
import { resolveTerminalOptions } from '../tty/theme.js';
import { DEFAULT_CLIPS, resolveClips, WEB_CLIPS_MESSAGE } from './clips.js';
import {
  checkTerminal,
  resolveTtyShots,
  resolveTtyTarget,
  TTY_ONLY_KEYS,
  TTY_SHOT_KEYS,
  TTY_TARGET_KEYS,
  TTY_TIMEOUT_KEYS,
  WEB_ONLY_KEYS,
} from './tty.js';
import type {
  Mode,
  ResolvedBackground,
  ResolvedConfig,
  ResolvedFrame,
  ResolvedHero,
  ResolvedPortfolio,
  ResolvedShot,
  ResolvedTtyConfig,
  ResolvedWebConfig,
  ResolvedWebShot,
} from './types.js';
import {
  bool,
  checkKeys,
  color,
  describe,
  ID,
  isObj,
  Issues,
  num,
  oneOf,
  pathTemplate,
  resolveShotList,
  selector,
  statelessRegExp,
  str,
  stringRecord,
  textPattern,
} from './validate.js';

export const DEFAULT_RAW = 'showcase-out/raw/{lang}/{id}.png';
export const DEFAULT_README = 'assets/showcase/{lang}/{id}.webp';
export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
export const GALLERY_FILE = 'showcase.gallery.json';

const DEFAULT_BACKGROUND: ResolvedBackground = { type: 'gradient', from: '#0f766e', to: '#1e1b4b', angle: 135 };
const DEFAULT_DOT = 'rgba(255,255,255,0.14)';
const BACKGROUND_TYPES = ['solid', 'gradient', 'transparent', 'mesh', 'dots', 'noise'] as const;
export const FRAME_STYLES = ['window', 'minimal', 'none', 'browser', 'windows', 'terminal'] as const;
const ADDRESS_TOKENS = ['url', 'name', 'title', 'id', 'lang'];

function resolveWebTarget(issues: Issues, value: unknown, rootDir: string): ResolvedWebConfig['target'] {
  if (!isObj(value)) {
    issues.add('target', `must be an object with mode "url", "cdp" or "tty", got ${describe(value)}`);
    return { mode: 'url', url: 'http://localhost', readyTimeoutMs: 60_000 };
  }
  const readyTimeoutMs = num(issues, 'target.readyTimeoutMs', value.readyTimeoutMs, 60_000, { min: 1, integer: true });
  const start = str(issues, 'target.start', value.start);
  let cwd = str(issues, 'target.cwd', value.cwd);
  if (cwd !== undefined && !isAbsolute(cwd)) cwd = resolve(rootDir, cwd);
  const env = stringRecord(issues, 'target.env', value.env);
  const common = { start, cwd, env, readyTimeoutMs };

  if (value.mode === 'url') {
    checkKeys(
      issues,
      'target',
      value,
      ['mode', 'url', 'start', 'cwd', 'env', 'readyTimeoutMs', 'reuseExisting'],
      TTY_TARGET_KEYS,
    );
    const url = str(issues, 'target.url', value.url, true);
    if (url && !/^https?:\/\//.test(url)) {
      issues.add('target.url', `must start with http:// or https://, got "${url}"`);
    }
    return { mode: 'url', url, ...common, reuseExisting: bool(issues, 'target.reuseExisting', value.reuseExisting, true) };
  }
  if (value.mode === 'cdp') {
    checkKeys(issues, 'target', value, ['mode', 'cdpUrl', 'pageMatch', 'start', 'cwd', 'env', 'readyTimeoutMs'], TTY_TARGET_KEYS);
    const cdpUrl = str(issues, 'target.cdpUrl', value.cdpUrl) ?? DEFAULT_CDP_URL;
    if (!/^(https?|wss?):\/\//.test(cdpUrl)) {
      issues.add('target.cdpUrl', `must start with http://, https://, ws:// or wss://, got "${cdpUrl}"`);
    }
    // A g or y RegExp keeps lastIndex between test() calls, so it would match every other page.
    const pageMatch =
      value.pageMatch instanceof RegExp
        ? statelessRegExp(value.pageMatch)
        : str(issues, 'target.pageMatch', value.pageMatch);
    return { mode: 'cdp', cdpUrl, pageMatch, ...common };
  }
  issues.add('target.mode', `must be "url", "cdp" or "tty", got ${describe(value.mode)}`);
  return { mode: 'url', url: 'http://localhost', readyTimeoutMs };
}

function resolveNav(issues: Issues, path: string, value: unknown): ResolvedWebShot['nav'] {
  if (value === undefined || typeof value === 'function') return value as ResolvedWebShot['nav'];
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

function resolveWebShots(issues: Issues, value: unknown, name: string): ResolvedWebShot[] {
  return resolveShotList(issues, value, {
    name,
    allowed: ['nav'],
    elsewhere: TTY_SHOT_KEYS,
    extra: (entry, path) => ({
      nav: resolveNav(issues, `${path}.nav`, entry.nav),
      waitFor: selector(issues, `${path}.waitFor`, entry.waitFor),
    }),
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
    if (value.type === 'mesh') {
      checkKeys(issues, path, value, ['type', 'colors']);
      const { colors } = value;
      if (!Array.isArray(colors) || colors.length < 2 || colors.length > 5) {
        issues.add(`${path}.colors`, `must be an array of two to five CSS colors, got ${describe(colors)}`);
        return fallback;
      }
      return { type: 'mesh', colors: colors.map((entry, index) => color(issues, `${path}.colors[${String(index)}]`, entry)) };
    }
    if (value.type === 'dots') {
      checkKeys(issues, path, value, ['type', 'color', 'dot', 'spacing']);
      return {
        type: 'dots',
        color: color(issues, `${path}.color`, value.color),
        dot: value.dot === undefined ? DEFAULT_DOT : color(issues, `${path}.dot`, value.dot),
        spacing: num(issues, `${path}.spacing`, value.spacing, 24, { min: 8, max: 96 }),
      };
    }
    if (value.type === 'noise') {
      checkKeys(issues, path, value, ['type', 'from', 'to', 'angle', 'amount']);
      return {
        type: 'noise',
        from: color(issues, `${path}.from`, value.from),
        to: color(issues, `${path}.to`, value.to),
        angle: num(issues, `${path}.angle`, value.angle, 135, { min: -360, max: 360 }),
        amount: num(issues, `${path}.amount`, value.amount, 0.2, { min: 0, max: 1 }),
      };
    }
  }
  issues.add(
    path,
    `must be a color string or { type: ${BACKGROUND_TYPES.map(type => `"${type}"`).join(' | ')} }, got ${describe(value)}`,
  );
  return fallback;
}

function resolveFrame(issues: Issues, value: unknown, mode: Mode): ResolvedFrame {
  const frame = value === undefined ? {} : value;
  if (!isObj(frame)) {
    issues.add('frame', `must be an object, got ${describe(frame)}`);
    return resolveFrame(issues, {}, mode);
  }
  checkKeys(issues, 'frame', frame, [
    'style',
    'theme',
    'title',
    'address',
    'background',
    'padding',
    'radius',
    'shadow',
    'quality',
    'maxWidth',
  ]);
  let title: string | false = '{name}';
  if (frame.title === false) {
    title = false;
  } else if (frame.title !== undefined) {
    title = str(issues, 'frame.title', frame.title) ?? '{name}';
  }
  const style = oneOf(issues, 'frame.style', frame.style, FRAME_STYLES, 'window');
  const address = pathTemplate(issues, 'frame.address', frame.address, '{url}', { allowed: ADDRESS_TOKENS, required: [] });
  if (style === 'browser' && mode === 'tty') {
    issues.add('frame.style', '"browser" needs a page with an address; a terminal app has none (use "terminal" or "window")');
  } else if (style === 'browser' && mode === 'cdp' && address.includes('{url}')) {
    issues.add('frame.address', 'cannot use {url} in cdp mode, where the page is not known when framing: write the address');
  }
  return {
    style,
    theme: oneOf(issues, 'frame.theme', frame.theme, ['light', 'dark'] as const, 'dark'),
    title,
    address,
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
  checkKeys(issues, path, value, [
    'dir',
    'size',
    'format',
    'quality',
    'thumbnail',
    'lang',
    'publicPath',
    'padding',
    'gallery',
  ]);
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

  shots.forEach((shot, index) => {
    if (shot.id === 'thumbnail') {
      issues.add(
        `shots[${String(index)}].id`,
        '"thumbnail" is reserved when outputs.portfolio is set (it writes thumbnail.<format>)',
      );
    }
  });
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

  const defaultGallery = `${trimTrailing(dir, '\\/')}/${GALLERY_FILE}`;
  const gallery =
    value.gallery === false
      ? false
      : pathTemplate(issues, `${path}.gallery`, value.gallery, defaultGallery, {
          allowed: ['slug'],
          required: [],
          extensions: ['.json'],
        });

  return {
    dir,
    size,
    format: oneOf(issues, `${path}.format`, value.format, ['webp', 'png'] as const, 'webp'),
    quality: num(issues, `${path}.quality`, value.quality, 90, { min: 1, max: 100, integer: true }),
    thumbnail,
    lang,
    publicPath: trimTrailing(publicPath, '/'),
    padding: num(issues, `${path}.padding`, value.padding, 96, { min: 0, integer: true }),
    gallery,
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

/** Narrows a resolved config to tty mode. */
export function isTtyConfig(config: ResolvedConfig): config is ResolvedTtyConfig {
  return config.target.mode === 'tty';
}

const WEB_KEYS = [
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
];
const TTY_KEYS = [...WEB_KEYS.filter(key => !(key in WEB_ONLY_KEYS)), 'terminal', 'clips'];

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
  const ttyTarget = isObj(input.target) && input.target.mode === 'tty' ? input.target : undefined;
  const tty = ttyTarget !== undefined;
  if (tty) checkKeys(issues, 'config', input, TTY_KEYS, WEB_ONLY_KEYS);
  else checkKeys(issues, 'config', input, WEB_KEYS, { ...TTY_ONLY_KEYS, clips: WEB_CLIPS_MESSAGE });

  const name = str(issues, 'name', input.name, true);
  const slug = str(issues, 'slug', input.slug) ?? slugify(name);
  if (slug && !ID.test(slug)) issues.add('slug', `may only contain letters, digits, "-" and "_", got "${slug}"`);
  const rootDir = resolve(root, str(issues, 'root', input.root) ?? '.');

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

  const ttyShots = tty ? resolveTtyShots(issues, input.shots, name) : [];
  const webShots = tty ? [] : resolveWebShots(issues, input.shots, name);
  const shots: ResolvedShot[] = tty ? ttyShots : webShots;
  const outputs = resolveOutputs(issues, input.outputs, shots, langs, tty);

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
    if (tty) checkKeys(issues, 'timeouts', timeouts, ['shotMs'], TTY_TIMEOUT_KEYS);
    else checkKeys(issues, 'timeouts', timeouts, ['readyMs', 'shotMs', 'networkIdleMs']);
    resolvedTimeouts = {
      readyMs: num(issues, 'timeouts.readyMs', timeouts.readyMs, 30_000, { min: 1, integer: true }),
      shotMs: num(issues, 'timeouts.shotMs', timeouts.shotMs, 15_000, { min: 1, integer: true }),
      networkIdleMs: num(issues, 'timeouts.networkIdleMs', timeouts.networkIdleMs, 3_000, { min: 0, integer: true }),
    };
  } else {
    issues.add('timeouts', `must be an object, got ${describe(timeouts)}`);
  }

  const mode: Mode = tty ? 'tty' : isObj(input.target) && input.target.mode === 'cdp' ? 'cdp' : 'url';
  const frame = resolveFrame(issues, input.frame, mode);
  const common = {
    name,
    slug,
    root: rootDir,
    deviceScaleFactor: num(issues, 'deviceScaleFactor', input.deviceScaleFactor, 2, { min: 0.25, max: 4 }),
    langs,
    frame,
    outputs,
    hero: resolveHero(issues, input.hero, { shots, langs, frame }),
    browser: isObj(browser) ? (browser as ResolvedConfig['browser']) : {},
    timeouts: resolvedTimeouts,
  };

  let config: ResolvedConfig;
  if (ttyTarget) {
    const issuesBefore = issues.list.length;
    const terminal = checkTerminal(issues, input.terminal, rootDir);
    config = {
      ...common,
      target: resolveTtyTarget(issues, ttyTarget, rootDir),
      ready: textPattern(issues, 'ready', input.ready),
      // Only hand a checked look to the engine; a bad one is reported and replaced by the defaults.
      terminal: resolveTerminalOptions(issues.list.length === issuesBefore ? terminal : undefined, rootDir),
      setup: input.setup as ResolvedTtyConfig['setup'],
      shots: ttyShots,
      clips: resolveClips(issues, input.clips, name, ttyShots),
    };
  } else {
    config = {
      ...common,
      target: resolveWebTarget(issues, input.target, rootDir),
      ready: selector(issues, 'ready', input.ready),
      viewport: resolveViewport(issues, input.viewport),
      colorScheme: oneOf(issues, 'colorScheme', input.colorScheme, ['light', 'dark', 'no-preference'] as const, 'dark'),
      css: str(issues, 'css', input.css),
      setup: input.setup as ResolvedWebConfig['setup'],
      shots: webShots,
    };
  }

  if (issues.list.length > 0) {
    throw new ConfigError(issues.list, source);
  }
  return config;
}

function resolveViewport(issues: Issues, value: unknown): ResolvedWebConfig['viewport'] {
  if (value === undefined) return { width: 1440, height: 900 };
  if (!isObj(value)) {
    issues.add('viewport', `must be { width, height }, got ${describe(value)}`);
    return { width: 1440, height: 900 };
  }
  checkKeys(issues, 'viewport', value, ['width', 'height']);
  return {
    width: num(issues, 'viewport.width', value.width, 1440, { min: 16, max: 8192, integer: true }),
    height: num(issues, 'viewport.height', value.height, 900, { min: 16, max: 8192, integer: true }),
  };
}

function resolveOutputs(
  issues: Issues,
  value: unknown,
  shots: ResolvedShot[],
  langs: string[],
  tty: boolean,
): ResolvedConfig['outputs'] {
  const outputs = value === undefined ? {} : value;
  if (!isObj(outputs)) {
    issues.add('outputs', `must be an object, got ${describe(outputs)}`);
    return { raw: DEFAULT_RAW, readme: DEFAULT_README, portfolio: undefined, clips: DEFAULT_CLIPS };
  }
  if (tty) checkKeys(issues, 'outputs', outputs, ['raw', 'readme', 'portfolio', 'clips']);
  else checkKeys(issues, 'outputs', outputs, ['raw', 'readme', 'portfolio'], { clips: WEB_CLIPS_MESSAGE });
  const required = langs.length > 1 ? ['id', 'lang'] : ['id'];
  const allowed = ['lang', 'id', 'slug'];
  return {
    raw: pathTemplate(issues, 'outputs.raw', outputs.raw, DEFAULT_RAW, { allowed, required, extensions: ['.png'] }),
    readme:
      outputs.readme === false
        ? false
        : pathTemplate(issues, 'outputs.readme', outputs.readme, DEFAULT_README, {
            allowed,
            required,
            extensions: ['.webp', '.png'],
          }),
    portfolio: resolvePortfolio(issues, outputs.portfolio, shots, langs),
    clips: pathTemplate(issues, 'outputs.clips', tty ? outputs.clips : undefined, DEFAULT_CLIPS, {
      allowed: [...allowed, 'ext'],
      required: [...required, 'ext'],
      extensions: ['.{ext}'],
    }),
  };
}
