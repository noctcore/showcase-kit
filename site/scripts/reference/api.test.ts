/**
 * The API reference against the built package: the documented exports must
 * be exactly what dist/index.d.ts exports, runtime and type-only alike. Run
 * `bun run build` at the repo root after changing src/.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { DOCS_DIR, REPO_ROOT } from '../site';
import { GROUP_ORDER, buildApiReference } from './api';

const { reference, problems, undocumented } = buildApiReference();

/** Every name dist/index.d.ts exports, and whether it is a type only. */
function builtExports(): Map<string, boolean> {
  const file = join(REPO_ROOT, 'dist', 'index.d.ts');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Map<string, boolean>();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        names.set(element.name.text, statement.isTypeOnly || element.isTypeOnly);
      }
    } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const typeOnly = ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
      const declared = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.map((d) => d.name.getText(source))
        : [(statement as ts.DeclarationStatement).name?.getText(source) ?? ''];
      for (const name of declared) names.set(name, typeOnly);
    }
  }
  return names;
}

/** Exports whose source has no JSDoc summary, outside the files the docs may edit. Exactly these. */
const UNDOCUMENTED = [
  'AnimationFormat',
  'CONFIG_NAMES',
  'CaptureOptions',
  'CaptureResult',
  'CapturedFile',
  'ConfigError',
  'EncodeOptions',
  'FrameRunOptions',
  'FramedFile',
  'GALLERY_FILE',
  'ICON_PRESETS',
  'IconPreset',
  'PortfolioResult',
  'ReadmeOptions',
  'RecordOptions',
  'RecordedClip',
  'RecordedFile',
  'TERMINAL_DEFAULTS',
];

describe('the API reference', () => {
  test('every export of src/index.ts resolves to a grouped declaration', () => {
    expect(problems).toEqual([]);
  });

  test('documents exactly what dist/index.d.ts exports, runtime and type-only alike', () => {
    const built = builtExports();
    expect(reference.exports.map((e) => e.name).sort()).toEqual([...built.keys()].sort());
    for (const entry of reference.exports) {
      expect({ name: entry.name, typeOnly: !entry.runtime }).toEqual({ name: entry.name, typeOnly: built.get(entry.name)! });
    }
  });

  test('only the listed exports lack a JSDoc summary', () => {
    expect([...undocumented].sort()).toEqual([...UNDOCUMENTED].sort());
  });

  test('every export has a signature', () => {
    for (const entry of reference.exports) expect({ name: entry.name, signed: entry.signature.length > 0 }).toEqual({ name: entry.name, signed: true });
  });

  test('api.mdx renders every group once, in order, and every group has exports', () => {
    const page = readFileSync(join(DOCS_DIR, 'reference', 'api.mdx'), 'utf8');
    const groups = [...page.matchAll(/<ReferenceApiGroup group="([^"]+)" \/>/g)].map((m) => m[1]);
    expect(groups).toEqual([...GROUP_ORDER]);
    for (const group of GROUP_ORDER) expect({ group, used: reference.exports.some((e) => e.group === group) }).toEqual({ group, used: true });
  });
});
