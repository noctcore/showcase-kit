import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SITE_DIR } from './site';
import {
  DARK_SELECTOR,
  LIGHT_SELECTOR,
  PRESET_FILE,
  SHARED_TOKEN,
  blockTokens,
  presetContract,
  readTheme,
  tokensDeclared,
  tokensRead,
} from './theme';

describe('theme contract', () => {
  const preset = readFileSync(PRESET_FILE, 'utf8');
  const contract = presetContract();
  const dark = blockTokens(preset, DARK_SELECTOR);
  const light = blockTokens(preset, LIGHT_SELECTOR);

  test('base.css and components.css read preset tokens (the contract is not empty)', () => {
    expect(contract).toContain('--nc-bg');
    expect(contract).toContain('--nc-font-body');
    expect(contract).toContain('--nc-motif');
  });

  test('the preset sets every token base.css and components.css read, in its dark block', () => {
    expect(contract.filter((token) => !dark.has(token))).toEqual([]);
  });

  test('the preset sets every colour token again in its light block', () => {
    const perMode = contract.filter((token) => !SHARED_TOKEN.test(token));
    expect(perMode.filter((token) => !light.has(token))).toEqual([]);
  });

  test('the preset reads no token it leaves unset', () => {
    const own = new Set([...dark, ...light]);
    const unset = [...tokensRead(preset)].filter((token) => !own.has(token));
    expect(unset).toEqual([]);
  });

  test("the site's own rules read only tokens the theme sets", () => {
    const site = readFileSync(join(SITE_DIR, 'src', 'styles', 'site.css'), 'utf8');
    const theme = readTheme('base.css') + readTheme('components.css');
    const set = new Set([...tokensDeclared(theme), ...dark, ...light]);
    expect([...tokensRead(site)].filter((token) => !set.has(token))).toEqual([]);
  });

  test('the preset names no Starlight colour variable: base.css maps them once', () => {
    expect(preset).not.toMatch(/--sl-color-[\w-]+\s*:/);
  });

  test('astro.config.mjs loads the theme in its order: base, components, the preset, then the site', () => {
    const config = readFileSync(join(SITE_DIR, 'astro.config.mjs'), 'utf8');
    const files = [...config.matchAll(/'\.\/src\/styles\/([^']+\.css)'/g)].map((m) => m[1]);
    expect(files).toEqual(['noctcore/base.css', 'noctcore/components.css', 'noctcore/presets/observatory.css', 'site.css']);
  });
});
