/**
 * Reads the noctcore theme files (src/styles/noctcore/) for the contract test:
 * which --nc-* tokens base.css and components.css read, and which ones a
 * preset sets for dark and for light.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SITE_DIR } from './site';

export const THEME_DIR = join(SITE_DIR, 'src', 'styles', 'noctcore');

/** The preset this site ships, as in astro.config.mjs `customCss`. */
export const PRESET_FILE = join(THEME_DIR, 'presets', 'observatory.css');

/** The selectors that open a preset's dark block (Starlight's default) and its light block. */
export const DARK_SELECTOR = ':root,\n::backdrop';
export const LIGHT_SELECTOR = ":root[data-theme='light'],\n[data-theme='light'] ::backdrop";

/**
 * Tokens with one value for both modes (README "Type, shape and labels"): a
 * preset sets them once in its dark block. Every other token is a colour or
 * the motif and needs a value in each mode.
 */
export const SHARED_TOKEN = /^--nc-(?:font-|label-|radius$|measure$)/;

export const readTheme = (name: string) => readFileSync(join(THEME_DIR, name), 'utf8');

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every --nc-* custom property a stylesheet reads through var(). */
export function tokensRead(css: string): Set<string> {
  return new Set([...stripComments(css).matchAll(/var\(\s*(--nc-[\w-]+)/g)].map((m) => m[1]!));
}

/** Every --nc-* custom property a stylesheet declares, anywhere. */
export function tokensDeclared(css: string): Set<string> {
  return new Set([...stripComments(css).matchAll(/(--nc-[\w-]+)\s*:/g)].map((m) => m[1]!));
}

/** The declarations of the rule whose selector list is exactly `selector`, at the top level. */
export function blockTokens(css: string, selector: string): Set<string> {
  const text = stripComments(css);
  const start = text.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`theme: no "${selector.replace(/\n/g, ' ')}" block`);
  const open = text.indexOf('{', start);
  const close = text.indexOf('}', open);
  return tokensDeclared(text.slice(open + 1, close));
}

/** Tokens base.css and components.css read that neither file sets itself, so a preset must. */
export function presetContract(): string[] {
  const shared = readTheme('base.css') + readTheme('components.css');
  const own = tokensDeclared(shared);
  return [...tokensRead(shared)].filter((token) => !own.has(token)).sort();
}
