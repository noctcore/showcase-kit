/**
 * The programmatic API reference: every export of src/index.ts, read with the
 * type checker (re-exports resolved to their declarations), grouped by the
 * module index.ts takes it from, marked runtime or type-only, with its JSDoc
 * summary and signature.
 */
import { relative } from 'node:path';
import ts from 'typescript';

import { REPO_ROOT } from '../site';
import { INDEX_FILE, SRC_DIR, libraryProgram, normalizeDoc, sourceFile } from './source';
import type { ApiExport, ApiGroup, ApiReference } from './types';

/** Which group each module that index.ts re-exports from belongs to. */
export const MODULE_GROUPS: Readonly<Record<string, ApiGroup>> = {
  './config/define.js': 'config',
  './config/load.js': 'config',
  './config/resolve.js': 'config',
  './init.js': 'config',
  './capture.js': 'pipeline',
  './frame/index.js': 'pipeline',
  './record.js': 'pipeline',
  './portfolio.js': 'outputs',
  './readme.js': 'outputs',
  './hero.js': 'outputs',
  './icons.js': 'outputs',
  './tty/index.js': 'terminal',
  './encode.js': 'encoding',
  './errors.js': 'errors',
  './config/types.js': 'types',
  './tty/types.js': 'types',
};

export const GROUP_ORDER: readonly ApiGroup[] = ['config', 'pipeline', 'outputs', 'terminal', 'encoding', 'errors', 'types'];

const FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

export interface ApiResult {
  reference: ApiReference;
  problems: string[];
  /** Exports whose declaration has no JSDoc summary in the source. */
  undocumented: string[];
}

interface Entry {
  module: string;
  typeOnly: boolean;
}

/** Where index.ts takes each name from, and whether it re-exports it as a type only. */
function indexEntries(program: ts.Program): Map<string, Entry> {
  const checker = program.getTypeChecker();
  const entries = new Map<string, Entry>();
  for (const statement of sourceFile(program, INDEX_FILE).statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const module = statement.moduleSpecifier.text;
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        entries.set(element.name.text, { module, typeOnly: statement.isTypeOnly || element.isTypeOnly });
      }
    } else if (!statement.exportClause) {
      const target = checker.getSymbolAtLocation(statement.moduleSpecifier);
      for (const symbol of target ? checker.getExportsOfModule(target) : []) {
        entries.set(symbol.name, { module, typeOnly: statement.isTypeOnly });
      }
    }
  }
  return entries;
}

export function buildApiReference(program: ts.Program = libraryProgram()): ApiResult {
  const checker = program.getTypeChecker();
  const index = sourceFile(program, INDEX_FILE);
  const moduleSymbol = checker.getSymbolAtLocation(index);
  if (!moduleSymbol) throw new Error('src/index.ts is not a module');
  const entries = indexEntries(program);
  const problems: string[] = [];
  const undocumented: string[] = [];
  const exports: ApiExport[] = [];

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.name;
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const decl = symbol.declarations?.[0];
    const entry = entries.get(name);
    if (!decl || !entry) {
      problems.push(`\`${name}\`: cannot find its declaration or the export statement in src/index.ts`);
      continue;
    }
    const group = MODULE_GROUPS[entry.module];
    if (!group) {
      problems.push(`\`${name}\` comes from ${entry.module}, which has no group in MODULE_GROUPS`);
      continue;
    }
    const kind = kindOf(decl);
    if (!kind) {
      problems.push(`\`${name}\`: unsupported declaration kind ${ts.SyntaxKind[decl.kind]}`);
      continue;
    }
    const runtime = !entry.typeOnly && (symbol.flags & ts.SymbolFlags.Value) !== 0;
    const summary = summaryOf(symbol, decl, checker);
    if (!summary) undocumented.push(name);
    exports.push({
      name,
      kind,
      runtime,
      group,
      source: relative(REPO_ROOT, decl.getSourceFile().fileName).split('\\').join('/'),
      summary,
      signature: signatureOf(name, symbol, decl, checker),
    });
  }

  exports.sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      Number(b.runtime) - Number(a.runtime) ||
      a.name.localeCompare(b.name),
  );
  return { reference: { exports }, problems, undocumented };
}

function kindOf(decl: ts.Declaration): ApiExport['kind'] | undefined {
  if (ts.isFunctionDeclaration(decl)) return 'function';
  if (ts.isVariableDeclaration(decl)) return 'const';
  if (ts.isClassDeclaration(decl)) return 'class';
  if (ts.isInterfaceDeclaration(decl)) return 'interface';
  if (ts.isTypeAliasDeclaration(decl)) return 'type';
  return undefined;
}

/**
 * The first paragraph of the JSDoc. A const typed with a documented alias
 * (`renderTtyScreen: RenderTtyScreen`) falls back to the alias's JSDoc.
 */
function summaryOf(symbol: ts.Symbol, decl: ts.Declaration, checker: ts.TypeChecker): string {
  let text = ts.displayPartsToString(symbol.getDocumentationComment(checker));
  if (!text && ts.isVariableDeclaration(decl) && decl.type && ts.isTypeReferenceNode(decl.type)) {
    let alias = checker.getSymbolAtLocation(decl.type.typeName);
    if (alias && alias.flags & ts.SymbolFlags.Alias) alias = checker.getAliasedSymbol(alias);
    // Only the library's own aliases: `Record<...>` would bring the TypeScript lib's JSDoc.
    const local = alias?.declarations?.some((d) => d.getSourceFile().fileName.startsWith(SRC_DIR));
    if (alias && local) text = ts.displayPartsToString(alias.getDocumentationComment(checker));
  }
  return normalizeDoc(text).split('\n\n')[0] ?? '';
}

function signatureOf(name: string, symbol: ts.Symbol, decl: ts.Declaration, checker: ts.TypeChecker): string {
  if (ts.isFunctionDeclaration(decl)) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
    return checker
      .getSignaturesOfType(type, ts.SignatureKind.Call)
      .map((signature) => `function ${name}${checker.signatureToString(signature, undefined, FLAGS)}`)
      .join('\n');
  }
  if (ts.isVariableDeclaration(decl)) {
    const type = decl.type ? decl.type.getText() : checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, decl), undefined, FLAGS);
    return `const ${name}: ${type}`;
  }
  if (ts.isClassDeclaration(decl)) {
    const heritage = decl.heritageClauses?.map((clause) => ` ${clause.getText()}`).join('') ?? '';
    const members: string[] = [];
    const constructorType = checker.getTypeOfSymbolAtLocation(symbol, decl);
    for (const signature of checker.getSignaturesOfType(constructorType, ts.SignatureKind.Construct)) {
      const text = checker.signatureToString(signature, undefined, FLAGS);
      members.push(`  constructor${text.slice(0, text.lastIndexOf('):') + 1)};`);
    }
    // Public fields, including constructor parameter properties (`readonly issues: string[]`).
    const fields: ts.Node[] = [
      ...decl.members.filter(ts.isPropertyDeclaration),
      ...(decl.members.find(ts.isConstructorDeclaration)?.parameters.filter((p) => ts.getModifiers(p)?.length) ?? []),
    ];
    for (const field of fields) {
      if (!ts.isPropertyDeclaration(field) && !ts.isParameter(field)) continue;
      const modifiers = ts.getModifiers(field)?.map((m) => m.getText()) ?? [];
      if (modifiers.includes('private') || modifiers.includes('protected')) continue;
      const readonly = modifiers.includes('readonly') ? 'readonly ' : '';
      const type = checker.typeToString(checker.getTypeAtLocation(field), undefined, FLAGS);
      members.push(`  ${readonly}${field.name.getText()}: ${type};`);
    }
    return `class ${name}${heritage} {\n${members.join('\n')}\n}`;
  }
  return printed(decl).replace(/^export /, '');
}

/** A declaration's source without comments and without its `export` keyword. */
function printed(node: ts.Node): string {
  const printer = ts.createPrinter({ removeComments: true });
  return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/^export /, '');
}
