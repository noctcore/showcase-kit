/**
 * Every key reachable from the two config roots (`WebConfig`, `TtyConfig`),
 * read from src/config/types.ts and src/tty/types.ts with the TypeScript
 * compiler: type as written, required or optional, JSDoc description and
 * `@default`. Modes here are where a key is *declared*; the validator decides
 * where it is *accepted* (see probe.ts).
 */
import ts from 'typescript';

import { CONTRACT_ANCHORS } from '../site';
import {
  CONFIG_TYPES_FILE,
  TTY_TYPES_FILE,
  defaultOf,
  docOf,
  leadingDoc,
  libraryProgram,
  oneLine,
  sourceFile,
} from './source';
import type { ConfigDefault, ConfigMode } from './types';

const LOCAL_FILES = [CONFIG_TYPES_FILE, TTY_TYPES_FILE];
export const CONFIG_SECTIONS = CONTRACT_ANCHORS['reference/config/'] ?? [];

type ObjectDecl = ts.InterfaceDeclaration | ts.TypeLiteralNode;

export interface TypeRow {
  key: string;
  path: string;
  type: string;
  typeExpanded?: string;
  required: boolean;
  description: string;
  default?: ConfigDefault;
  /** Modes whose config declares this key. */
  declaredIn: ConfigMode[];
  /** The declaration, so rows reached twice through the same declaration merge. */
  decl: ts.PropertySignature;
  /** Ids of the tables that document the key's own fields or forms. */
  tables: string[];
}

export interface TypeForm {
  type: string;
  description: string;
  fields: { key: string; required: boolean; description: string; default?: ConfigDefault }[] | null;
  /** A value of this form, built from its literal types, for probing the validator. */
  sample: Record<string, unknown> | null;
}

export interface TypeTable {
  id: string;
  path: string;
  array: boolean;
  variant?: string;
  /** The `mode` literal of a target variant: `url`, `cdp` or `tty`. */
  variantMode?: string;
  section: string;
  heading?: string;
  anchor: string;
  declaredIn: ConfigMode[];
  description?: string;
  kind: 'fields' | 'forms';
  rows: TypeRow[];
  forms: TypeForm[];
  decls: ts.Node[];
}

/** The fragment Starlight (github-slugger) gives a heading made of words, dots, brackets and spaces. */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-');
}

/** `clips[].steps` -> `clips`, `''` -> `top-level`, a key outside the contract sections -> `top-level`. */
function sectionOf(path: string): string {
  const root = path.split(/[.[]/)[0] ?? '';
  return CONFIG_SECTIONS.includes(root) && root !== 'top-level' ? root : 'top-level';
}

function isLocal(node: ts.Node): boolean {
  return LOCAL_FILES.includes(node.getSourceFile().fileName);
}

class Walker {
  readonly tables: TypeTable[] = [];
  private readonly checker: ts.TypeChecker;

  constructor(private readonly program: ts.Program) {
    this.checker = program.getTypeChecker();
  }

  /** The local declaration a type reference names, if any. */
  private localDecl(node: ts.TypeReferenceNode): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
    let symbol = this.checker.getSymbolAtLocation(node.typeName);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol);
    const decl = symbol?.declarations?.find(
      (d): d is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
        (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d)) && isLocal(d),
    );
    return decl;
  }

  /** The members of an interface, base interfaces first, in source order. */
  private members(decl: ObjectDecl): ts.PropertySignature[] {
    if (ts.isTypeLiteralNode(decl)) return decl.members.filter(ts.isPropertySignature);
    const inherited: ts.PropertySignature[] = [];
    for (const clause of decl.heritageClauses ?? []) {
      for (const base of clause.types) {
        const symbol = this.checker.getSymbolAtLocation(base.expression);
        const baseDecl = symbol?.declarations?.find(ts.isInterfaceDeclaration);
        if (baseDecl) inherited.push(...this.members(baseDecl));
      }
    }
    return [...inherited, ...decl.members.filter(ts.isPropertySignature)];
  }

  /** What `type` stands for, when it is a bare local alias or an array of one. */
  private expansion(node: ts.TypeNode): string | undefined {
    const inner = ts.isArrayTypeNode(node) ? node.elementType : node;
    if (!ts.isTypeReferenceNode(inner)) return undefined;
    const decl = this.localDecl(inner);
    if (!decl || !ts.isTypeAliasDeclaration(decl)) return undefined;
    const text = oneLine(stripComments(decl.type));
    return ts.isArrayTypeNode(node) ? `(${text})[]` : text;
  }

  /**
   * The object declarations a key's type leads to, and whether they are
   * union forms: `FrameOptions` -> one table, `WebTarget` -> two, `Background`
   * -> a forms table.
   */
  private targets(node: ts.TypeNode): { array: boolean; objects: ObjectDecl[]; forms?: { owner: ts.Node; union: ts.UnionTypeNode } } {
    let array = false;
    let type = node;
    if (ts.isArrayTypeNode(type)) {
      array = true;
      type = type.elementType;
    }
    while (ts.isParenthesizedTypeNode(type)) type = type.type;
    const objects: ObjectDecl[] = [];
    const visit = (t: ts.TypeNode, owner: ts.Node): { owner: ts.Node; union: ts.UnionTypeNode } | undefined => {
      while (ts.isParenthesizedTypeNode(t)) t = t.type;
      if (ts.isTypeLiteralNode(t)) {
        objects.push(t);
        return undefined;
      }
      if (ts.isUnionTypeNode(t)) {
        if (t.types.some(ts.isTypeLiteralNode)) return { owner, union: t };
        for (const member of t.types) {
          const forms = visit(member, owner);
          if (forms) return forms;
        }
        return undefined;
      }
      if (ts.isTypeReferenceNode(t)) {
        const decl = this.localDecl(t);
        if (!decl) return undefined;
        if (ts.isInterfaceDeclaration(decl)) {
          objects.push(decl);
          return undefined;
        }
        return visit(decl.type, decl);
      }
      return undefined;
    };
    const forms = visit(type, node);
    return forms ? { array, objects: [], forms } : { array, objects };
  }

  private findTable(decl: ts.Node): TypeTable | undefined {
    return this.tables.find((table) => table.decls.includes(decl));
  }

  private newTable(path: string, array: boolean, kind: TypeTable['kind'], decl: ts.Node): TypeTable {
    const section = sectionOf(path);
    const table: TypeTable = {
      id: path === '' ? 'top-level' : path,
      path,
      array,
      section,
      anchor: section,
      declaredIn: [],
      kind,
      rows: [],
      forms: [],
      decls: [decl],
    };
    this.tables.push(table);
    return table;
  }

  /** Walk an object declaration reached at `path` from a config of `mode`. */
  walkObject(decl: ObjectDecl, path: string, array: boolean, mode: ConfigMode): TypeTable {
    let table = this.findTable(decl);
    if (!table) {
      // Two declarations at one path merge into one table (web and tty shots),
      // unless they are target modes, which read better apart.
      const samePath = this.tables.find((t) => t.path === path && t.kind === 'fields' && !t.variantMode);
      if (samePath && !modeLiteral(decl)) {
        table = samePath;
        table.decls.push(decl);
        // Neither declaration's own JSDoc describes the merged table.
        delete table.description;
      } else {
        table = this.newTable(path, array, 'fields', decl);
        const description = ts.isInterfaceDeclaration(decl) ? docOf(decl) : '';
        if (description) table.description = description;
        const ownMode = modeLiteral(decl);
        if (ownMode) {
          table.variantMode = ownMode;
          table.variant = `${ownMode} mode`;
          table.id = `${path}#${ownMode}`;
        }
      }
    }
    if (!table.declaredIn.includes(mode)) table.declaredIn.push(mode);

    for (const member of this.members(decl)) {
      if (!member.type || !ts.isIdentifier(member.name)) continue;
      const key = member.name.text;
      const rowPath = path === '' ? key : `${path}${array ? '[]' : ''}.${key}`;
      let row = table.rows.find((r) => r.decl === member);
      if (!row) {
        const candidate: TypeRow = {
          key,
          path: rowPath,
          type: oneLine(stripComments(member.type)),
          required: !member.questionToken,
          description: docOf(member),
          declaredIn: [],
          decl: member,
          tables: [],
        };
        const expanded = this.expansion(member.type);
        if (expanded) candidate.typeExpanded = expanded;
        const fallback = defaultOf(member);
        if (fallback) candidate.default = fallback;
        // Same key, same text from another declaration (a web and a tty shot's `id`): one row.
        const twin = table.rows.find((r) => r.key === key && sameRow(r, candidate));
        if (twin) {
          row = twin;
        } else {
          row = candidate;
          const lastSameKey = table.rows.map((r) => r.key).lastIndexOf(key);
          if (lastSameKey >= 0) table.rows.splice(lastSameKey + 1, 0, row);
          else table.rows.push(row);
        }
      }
      if (!row.declaredIn.includes(mode)) row.declaredIn.push(mode);

      const next = this.targets(member.type);
      if (next.forms) {
        const forms = this.walkForms(next.forms.owner, next.forms.union, rowPath, next.array, mode);
        if (!row.tables.includes(forms.id)) row.tables.push(forms.id);
      }
      for (const object of next.objects) {
        const child = this.walkObject(object, rowPath, next.array, mode);
        if (!row.tables.includes(child.id)) row.tables.push(child.id);
      }
    }
    return table;
  }

  private walkForms(owner: ts.Node, union: ts.UnionTypeNode, path: string, array: boolean, mode: ConfigMode): TypeTable {
    let table = this.findTable(union);
    if (!table) {
      table = this.newTable(path, array, 'forms', union);
      const description = ts.isTypeAliasDeclaration(owner) ? docOf(owner) : '';
      if (description) table.description = description;
      let from = union.pos;
      for (const member of union.types) {
        table.forms.push(this.form(member, from));
        from = member.end;
      }
    }
    if (!table.declaredIn.includes(mode)) table.declaredIn.push(mode);
    return table;
  }

  private form(member: ts.TypeNode, from: number): TypeForm {
    const description = leadingDoc(member, from);
    if (!ts.isTypeLiteralNode(member)) {
      return { type: oneLine(stripComments(member)), description, fields: null, sample: null };
    }
    const sample: Record<string, unknown> = {};
    const fields = member.members.filter(ts.isPropertySignature).map((field) => {
      const key = ts.isIdentifier(field.name) ? field.name.text : field.name.getText();
      const literal = field.type && ts.isLiteralTypeNode(field.type) ? field.type.literal : undefined;
      if (literal && ts.isStringLiteral(literal)) {
        sample[key] = literal.text;
      } else if (!field.questionToken) {
        sample[key] = 'x';
      }
      const entry: NonNullable<TypeForm['fields']>[number] = {
        key,
        required: !field.questionToken,
        description: docOf(field),
      };
      const fallback = defaultOf(field);
      if (fallback) entry.default = fallback;
      return entry;
    });
    return { type: oneLine(stripComments(member)), description, fields, sample };
  }
}

/** The `mode: 'x'` literal of a target interface. */
function modeLiteral(decl: ObjectDecl): string | undefined {
  for (const member of decl.members) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name)) continue;
    if (member.name.text !== 'mode') continue;
    if (ts.isLiteralTypeNode(member.type) && ts.isStringLiteral(member.type.literal)) return member.type.literal.text;
  }
  return undefined;
}

function sameRow(a: TypeRow, b: TypeRow): boolean {
  return (
    a.type === b.type &&
    a.required === b.required &&
    a.description === b.description &&
    JSON.stringify(a.default) === JSON.stringify(b.default)
  );
}

/** A type node's text without the JSDoc inside it (inline object types carry member docs). */
function stripComments(node: ts.Node): string {
  const printer = ts.createPrinter({ removeComments: true, omitTrailingSemicolon: true });
  return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
}

/** Walk both config roots and return every table, top level first. */
export function extractConfigTypes(program: ts.Program = libraryProgram()): TypeTable[] {
  const file = sourceFile(program, CONFIG_TYPES_FILE);
  const root = (name: string): ts.InterfaceDeclaration => {
    const decl = file.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === name);
    if (!decl) throw new Error(`src/config/types.ts has no interface ${name}`);
    return decl;
  };
  const walker = new Walker(program);
  const top = walker.walkObject(root('WebConfig'), '', false, 'web');
  top.decls.push(root('TtyConfig'));
  // The top level merges two roots; neither root's own JSDoc describes both.
  delete top.description;
  walker.walkObject(root('TtyConfig'), '', false, 'tty');

  for (const table of walker.tables) {
    // A key with its own table needs no alias spelled out next to it.
    for (const row of table.rows) if (row.tables.length > 0) delete row.typeExpanded;
    const bare = table.path.replace(/\[\]$/, '');
    if (table.path !== '' && (table.variant || bare !== table.section)) {
      table.heading = table.variant ? `${table.path} in ${table.variant}` : table.path;
      table.anchor = slug(table.heading);
    }
  }
  return walker.tables;
}
