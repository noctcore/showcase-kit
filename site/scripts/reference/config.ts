/**
 * The config reference: the tables from the type declarations, with each key's
 * modes decided by what the validator accepts, the messages it gives for keys
 * of the other mode, and the path template rules of every templated output.
 *
 * `problems` lists every way the declarations and the validator disagree (or a
 * key has no description). The generator refuses to write the reference while
 * there are any, and the tests assert there are none.
 */
import { extractConfigTypes, type TypeRow, type TypeTable } from './config-types';
import {
  FIXTURE_MODE,
  MODE_FIXTURE,
  acceptedKeys,
  fixture,
  issuePath,
  messageFor,
  segmentsOf,
  templateRules,
  type FixtureName,
} from './probe';
import type { ConfigForm, ConfigMode, ConfigReference, ConfigRow, ConfigTable, ModeError, PathTemplate } from './types';

const MODES: ConfigMode[] = ['web', 'tty'];

export interface ConfigResult {
  reference: ConfigReference;
  problems: string[];
  /** Object forms the validator checks without an "expected one of" list, so their keys come from the types alone. */
  unprobedForms: string[];
}

/** The fixtures a table is probed in: its target mode, or one per mode it is declared in. */
function fixturesOf(table: TypeTable): FixtureName[] {
  if (table.variantMode) return [table.variantMode as FixtureName];
  return MODES.filter((mode) => table.declaredIn.includes(mode)).map((mode) => MODE_FIXTURE[mode]);
}

/** Every `{token}` a description names. */
export function tokensIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
}

/** A key whose value is a path (or title) template: its description lists them (`Tokens: {lang}`, `(token {slug})`). */
export function isTemplate(row: { description: string }): boolean {
  return /\btokens?:?\s+`\{/i.test(row.description);
}

export async function buildConfigReference(): Promise<ConfigResult> {
  const types = extractConfigTypes();
  const problems: string[] = [];
  const unprobedForms: string[] = [];
  const modeErrors: ModeError[] = [];
  const accepted = new Map<string, Map<FixtureName, Set<string>>>();

  for (const table of types) {
    const perFixture = new Map<FixtureName, Set<string>>();
    accepted.set(table.id, perFixture);
    for (const name of fixturesOf(table)) {
      const segments = segmentsOf(table.path, table.array);
      if (table.kind === 'forms') {
        for (const form of table.forms) {
          if (!form.sample || !form.fields) continue;
          const keys = await acceptedKeys(fixture(name), segments, form.sample);
          if (keys === null) {
            unprobedForms.push(`${table.path} ${form.type}`);
            continue;
          }
          const declared = form.fields.map((field) => field.key);
          if (!sameSet(keys, declared)) {
            problems.push(`${table.path} ${form.type}: the validator accepts ${list(keys)}, the type declares ${list(declared)}`);
          }
        }
        continue;
      }
      const keys = await acceptedKeys(fixture(name), segments);
      if (keys === null) {
        problems.push(`${issuePath(segments)} in ${name} mode: the validator gave no list of accepted keys`);
        continue;
      }
      perFixture.set(name, new Set(keys));
      const mode = FIXTURE_MODE[name];
      for (const key of keys) {
        if (!table.rows.some((row) => row.key === key && row.declaredIn.includes(mode))) {
          problems.push(`${label(table)}: the validator accepts \`${key}\` in ${name} mode, but no config type declares it`);
        }
      }
    }
  }

  const tables: ConfigTable[] = [];
  for (const table of types) {
    const perFixture = accepted.get(table.id)!;
    const rows: ConfigRow[] = table.rows.map((row) => {
      const modes = table.kind === 'fields' ? rowModes(table, row, perFixture) : [];
      if (table.kind === 'fields' && modes.length === 0) {
        problems.push(`${row.path} (${label(table)}): declared in the types, but the validator accepts it in no mode`);
      }
      if (!row.description) problems.push(`${row.path} (${label(table)}): no JSDoc description in the source`);
      return toRow(row, modes, types);
    });
    for (const form of table.forms) {
      if (!form.description) problems.push(`${table.path} ${form.type}: no JSDoc description in the source`);
    }
    tables.push(toTable(table, rows));

    // Keys the validator refuses in a mode with a message of its own.
    for (const name of wrongModeFixtures(table)) {
      const known = perFixture.get(name) ?? (await acceptedKeys(fixture(name), segmentsOf(table.path, table.array)));
      if (!known) continue;
      const refused = [...new Set(table.rows.map((row) => row.key))].filter((key) => !has(known, key));
      for (const key of refused) {
        const message = await messageFor(fixture(name), segmentsOf(table.path, table.array), key);
        if (message && !message.startsWith('unknown key')) {
          const path = table.path === '' ? key : `${table.path}${table.array ? '[]' : ''}.${key}`;
          if (!modeErrors.some((e) => e.path === path && e.in === name)) modeErrors.push({ path, in: name, message });
        }
      }
    }
  }

  const templates: PathTemplate[] = [];
  for (const table of tables) {
    for (const row of table.rows.filter(isTemplate)) {
      const rules = await templateRules(MODE_FIXTURE[row.modes[0] ?? 'web'], row.path);
      const docTokens = tokensIn(row.description);
      templates.push({ path: row.path, modes: row.modes, docTokens, ...rules });
      if (rules.validated && !sameSet(docTokens, rules.allowed)) {
        problems.push(`${row.path}: the JSDoc names ${list(docTokens)}, the validator allows ${list(rules.allowed)}`);
      }
    }
  }

  return { reference: { tables, modeErrors, templates }, problems, unprobedForms };
}

function has(keys: Set<string> | string[], key: string): boolean {
  return Array.isArray(keys) ? keys.includes(key) : keys.has(key);
}

/** The fixtures to ask about keys that belong to another mode. */
function wrongModeFixtures(table: TypeTable): FixtureName[] {
  if (table.kind !== 'fields') return [];
  if (table.variantMode) return (['url', 'cdp', 'tty'] as const).filter((name) => name !== table.variantMode);
  return fixturesOf(table);
}

/** The modes a key is declared in and accepted in. */
function rowModes(table: TypeTable, row: TypeRow, perFixture: Map<FixtureName, Set<string>>): ConfigMode[] {
  return MODES.filter((mode) => {
    if (!row.declaredIn.includes(mode)) return false;
    return [...perFixture].some(([name, keys]) => FIXTURE_MODE[name] === mode && keys.has(row.key));
  });
}

function toRow(row: TypeRow, modes: ConfigMode[], tables: TypeTable[]): ConfigRow {
  const out: ConfigRow = {
    key: row.key,
    path: row.path,
    type: row.type,
    required: row.required,
    description: row.description,
    modes,
  };
  if (row.typeExpanded) out.typeExpanded = row.typeExpanded;
  if (row.default) out.default = row.default;
  const targets = tables.filter((t) => row.tables.includes(t.id));
  // Several tables (the target modes) share their section's heading.
  if (targets.length === 1) out.link = targets[0]!.anchor;
  else if (targets.length > 1) out.link = targets[0]!.section;
  return out;
}

function toTable(table: TypeTable, rows: ConfigRow[]): ConfigTable {
  const out: ConfigTable = {
    id: table.id,
    path: table.path,
    array: table.array,
    section: table.section,
    anchor: table.anchor,
    modes: MODES.filter((mode) => table.declaredIn.includes(mode)),
    kind: table.kind,
    rows,
    forms: table.forms.map(({ type, description, fields }): ConfigForm => ({ type, description, fields })),
  };
  if (table.variant) out.variant = table.variant;
  if (table.heading) out.heading = table.heading;
  if (table.description) out.description = table.description;
  return out;
}

function label(table: TypeTable): string {
  return table.variant ? `${table.path || 'top level'} in ${table.variant}` : table.path || 'top level';
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function list(items: string[]): string {
  return items.length ? items.map((item) => `\`${item}\``).join(', ') : 'nothing';
}
