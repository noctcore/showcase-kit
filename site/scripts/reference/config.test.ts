/**
 * Drift tests for the config reference: the documented defaults against what
 * the built resolveConfig fills in, and the documented keys against what the
 * built validator accepts. They read dist/, so run `bun run build` at the repo
 * root after changing src/.
 */
import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS_DIR, REPO_ROOT } from '../site';
import { DEFAULT_CLIP_DURATION_MS } from '../../../src/config/clips';
import { buildConfigReference, type ConfigResult } from './config';
import { parseLiteral } from './literal';
import { FIXTURE_ROOT, MODE_FIXTURE, fixture, loadLibrary, segmentsOf, setAt, type FixtureName } from './probe';
import type { ConfigTable } from './types';

setDefaultTimeout(120_000);

let result: ConfigResult;
let tables: ConfigTable[];
let lib: Record<string, unknown> & { resolveConfig(input: unknown, root: string): Record<string, unknown> };
const resolved = {} as Record<FixtureName, Record<string, unknown>>;

beforeAll(async () => {
  result = await buildConfigReference();
  tables = result.reference.tables;
  lib = (await loadLibrary()) as typeof lib;
  for (const name of ['url', 'cdp', 'tty'] as const) resolved[name] = lib.resolveConfig(fixture(name), FIXTURE_ROOT);
});

/** Read `clips[].fps` out of a resolved config (arrays at index 0). */
function valueAt(config: unknown, path: string): unknown {
  let node: unknown = config;
  for (const [key, index] of segmentsOf(path)) {
    node = (node as Record<string, unknown> | undefined)?.[key];
    if (index !== undefined) node = (node as unknown[] | undefined)?.[index];
  }
  return node;
}

/** The fixtures a row's default is checked in: its target mode, or every mode it works in. */
function fixturesFor(table: ConfigTable, modes: ConfigTable['modes']): FixtureName[] {
  if (table.variant) return [table.variant.split(' ')[0] as FixtureName];
  return modes.map((mode) => MODE_FIXTURE[mode]);
}

/**
 * Literal defaults resolveConfig leaves unset because code downstream applies
 * them. Each names where, and the value there is checked when it can be.
 */
const APPLIED_LATER: Record<string, { value: unknown; where: string }> = {
  // src/browser.ts: `const { channel, executablePath, headless = true, args } = config.browser`.
  'browser.headless': { value: true, where: 'src/browser.ts' },
  // src/record.ts falls back to DEFAULT_CLIP_DURATION_MS when durationMs is undefined.
  'clips[].durationMs': { value: DEFAULT_CLIP_DURATION_MS, where: 'src/config/clips.ts' },
};

/** Literal defaults resolveConfig turns into another shape. */
const NORMALIZED: Record<string, (literal: unknown) => unknown> = {
  'terminal.theme': (literal) => (literal === 'dark' ? lib.DARK_THEME : lib.LIGHT_THEME),
};

/**
 * Form fields with a default, keyed by path and the form's `type` (two forms can share a field name), and a value of
 * that form without the field, to see the default filled in.
 */
const GRADIENT = { type: 'gradient', from: '#000000', to: '#ffffff' };
const NOISE = { type: 'noise', from: '#000000', to: '#ffffff' };
const DOTS = { type: 'dots', color: '#000000' };
const FORM_SAMPLES: Record<string, Record<string, unknown>> = {
  'frame.background.angle in gradient': GRADIENT,
  'frame.background.angle in noise': NOISE,
  'frame.background.amount in noise': NOISE,
  'frame.background.dot in dots': DOTS,
  'frame.background.spacing in dots': DOTS,
};

/** Every default written as prose (it depends on other keys or on files), exactly. */
const PROSE_DEFAULTS = [
  'slug',
  'root',
  'outputs.portfolio.thumbnail',
  'outputs.portfolio.lang',
  'outputs.portfolio.gallery',
  'hero.shots',
  'hero.lang',
  'hero.background',
  'hero.theme',
  'target.cwd',
  'target.pageMatch',
  'shots[].title',
  'shots[].caption',
  'shots[].alt',
  'terminal.theme.cursor',
  'terminal.font.file',
  'terminal.font.boldFile',
  'terminal.font.italicFile',
  'terminal.font.boldItalicFile',
  'clips[].title',
  'clips[].caption',
  'clips[].alt',
];

describe('(a) documented defaults', () => {
  test('every literal default equals what resolveConfig fills in for a minimal config', () => {
    const later: string[] = [];
    let checked = 0;
    for (const table of tables) {
      for (const row of table.rows) {
        if (row.default?.kind !== 'literal') continue;
        const expected = parseLiteral(row.default.text);
        for (const name of fixturesFor(table, row.modes)) {
          const actual = valueAt(resolved[name], row.path);
          const late = APPLIED_LATER[row.path];
          if (late) {
            expect({ path: row.path, actual }).toEqual({ path: row.path, actual: undefined });
            expect({ path: row.path, value: late.value }).toEqual({ path: row.path, value: expected });
            if (!later.includes(row.path)) later.push(row.path);
          } else {
            const want = NORMALIZED[row.path]?.(expected) ?? expected;
            expect({ path: row.path, in: name, value: actual }).toEqual({ path: row.path, in: name, value: want });
          }
          checked++;
        }
      }
    }
    expect(later.sort()).toEqual(Object.keys(APPLIED_LATER).sort());
    expect(checked).toBeGreaterThan(40);
  });

  test('browser.headless defaults to true where the browser is launched', () => {
    expect(readFileSync(join(REPO_ROOT, 'src', 'browser.ts'), 'utf8')).toContain('headless = true');
  });

  test('every literal default of a union form equals what resolveConfig fills in', () => {
    const seen: string[] = [];
    for (const table of tables.filter((t) => t.kind === 'forms')) {
      for (const form of table.forms) {
        for (const field of form.fields ?? []) {
          if (field.default?.kind !== 'literal') continue;
          const path = `${table.path}.${field.key}`;
          const key = `${path} in ${/type: '(\w+)'/.exec(form.type)?.[1] ?? form.type}`;
          const sample = FORM_SAMPLES[key];
          expect({ key, sample: sample !== undefined }).toEqual({ key, sample: true });
          const config = setAt(fixture('url'), segmentsOf(table.path, table.array), sample);
          expect(valueAt(lib.resolveConfig(config, FIXTURE_ROOT), path)).toEqual(parseLiteral(field.default.text));
          seen.push(key);
        }
      }
    }
    expect(seen.sort()).toEqual(Object.keys(FORM_SAMPLES).sort());
  });

  test('the prose defaults are exactly the listed ones', () => {
    const prose = tables.flatMap((table) => table.rows.filter((row) => row.default?.kind === 'prose').map((row) => row.path));
    expect([...new Set(prose)].sort()).toEqual([...PROSE_DEFAULTS].sort());
  });

  test('an optional key documented without a default resolves to nothing', () => {
    for (const table of tables) {
      for (const row of table.rows) {
        if (row.required || row.default || row.link) continue;
        for (const name of fixturesFor(table, row.modes)) {
          if (valueAt(fixture(name), row.path) !== undefined) continue;
          expect({ path: row.path, in: name, value: valueAt(resolved[name], row.path) }).toEqual({
            path: row.path,
            in: name,
            value: undefined,
          });
        }
      }
    }
  });
});

describe('(b) documented keys against the validator', () => {
  test('every accepted key is documented, every documented key is accepted, every key has a description', () => {
    expect(result.problems).toEqual([]);
  });

  test('only the nav object forms are checked without an "expected one of" list', () => {
    expect(result.unprobedForms).toEqual(['shots[].nav { click: string }', 'shots[].nav { goto: string }']);
  });

  test('every table has at least one key or form, and every key works in some mode', () => {
    for (const table of tables) {
      expect({ id: table.id, size: table.rows.length + table.forms.length > 0 }).toEqual({ id: table.id, size: true });
      for (const row of table.rows) expect({ path: row.path, modes: row.modes.length > 0 }).toEqual({ path: row.path, modes: true });
    }
  });

  test('every templated key names the tokens the validator allows; only frame.title is not checked', () => {
    const templates = result.reference.templates;
    expect(templates.filter((t) => !t.validated).map((t) => t.path)).toEqual(['frame.title']);
    for (const template of templates.filter((t) => t.validated)) {
      expect({ path: template.path, tokens: [...template.docTokens].sort() }).toEqual({
        path: template.path,
        tokens: [...template.allowed].sort(),
      });
    }
  });

  test('keys of the other mode get their own message', () => {
    const paths = result.reference.modeErrors.map((e) => `${e.path} in ${e.in}`);
    expect(paths).toContain('viewport in tty');
    expect(paths).toContain('terminal in url');
    expect(paths).toContain('timeouts.readyMs in tty');
    expect(paths).toContain('target.command in cdp');
    for (const error of result.reference.modeErrors) expect(error.message.startsWith('unknown key')).toBe(false);
  });
});

describe('config.mdx', () => {
  const page = readFileSync(join(DOCS_DIR, 'reference', 'config.mdx'), 'utf8');
  const placed = [...page.matchAll(/<ReferenceConfigTable id="([^"]+)" \/>/g)].map((m) => m[1]);
  const headings = [...page.matchAll(/^### (.+)$/gm)].map((m) => m[1]!.replace(/`/g, ''));

  test('places every generated table exactly once', () => {
    expect([...placed].sort()).toEqual(tables.map((t) => t.id).sort());
  });

  test('has the heading each table sits under, right before it', () => {
    for (const table of tables.filter((t) => t.heading)) {
      expect(headings).toContain(table.heading!);
      const heading = page.split('\n').findIndex((line) => line.replace(/`/g, '') === `### ${table.heading!}`);
      const component = page.split('\n').findIndex((line) => line === `<ReferenceConfigTable id="${table.id}" />`);
      expect({ id: table.id, order: heading < component }).toEqual({ id: table.id, order: true });
    }
  });
});
