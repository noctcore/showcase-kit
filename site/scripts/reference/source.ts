/**
 * The library source as the TypeScript compiler sees it, plus the JSDoc
 * helpers the config and API extractors share.
 */
import { join } from 'node:path';
import ts from 'typescript';

import { REPO_ROOT } from '../site';
import type { ConfigDefault } from './types';

export const SRC_DIR = join(REPO_ROOT, 'src');
export const INDEX_FILE = join(SRC_DIR, 'index.ts');
export const CLI_FILE = join(SRC_DIR, 'cli.ts');
export const CONFIG_TYPES_FILE = join(SRC_DIR, 'config', 'types.ts');
export const TTY_TYPES_FILE = join(SRC_DIR, 'tty', 'types.ts');

let cached: ts.Program | undefined;

/** One program over the library's entry points, with the library's own compiler options. */
export function libraryProgram(): ts.Program {
  if (cached) return cached;
  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, REPO_ROOT);
  cached = ts.createProgram({ rootNames: [INDEX_FILE, CLI_FILE], options: { ...parsed.options, noEmit: true } });
  // Binding sets the parent pointers that node.getText() and the JSDoc helpers walk.
  cached.getTypeChecker();
  return cached;
}

export function sourceFile(program: ts.Program, file: string): ts.SourceFile {
  const found = program.getSourceFile(file);
  if (!found) throw new Error(`The library program has no ${file}`);
  return found;
}

/** Collapse the whitespace of source text printed on several lines. */
export function oneLine(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/;\s*}/g, ' }')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .trim();
}

/** Keep paragraphs and list items, join the lines inside them. */
export function normalizeDoc(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .reduce<string[]>((lines, line) => {
          if (lines.length === 0 || /^[-*] /.test(line)) lines.push(line);
          else lines[lines.length - 1] += ` ${line}`;
          return lines;
        }, [])
        .join('\n'),
    )
    .join('\n\n')
    .trim();
}

function jsDocsOf(node: ts.Node): ts.JSDoc[] {
  return ts.getJSDocCommentsAndTags(node).filter((doc): doc is ts.JSDoc => ts.isJSDoc(doc));
}

/** The description of a node's JSDoc, without its tags. */
export function docOf(node: ts.Node): string {
  return normalizeDoc(
    jsDocsOf(node)
      .map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? '')
      .join('\n\n'),
  );
}

/**
 * The `@default` tag. A value written entirely in backticks is a literal
 * (`` @default `120` ``); anything else is prose (`@default the config root`).
 */
export function defaultOf(node: ts.Node): ConfigDefault | undefined {
  const tag = ts.getJSDocTags(node).find((t) => t.tagName.text === 'default');
  if (!tag) return undefined;
  const text = oneLine(ts.getTextOfJSDocComment(tag.comment) ?? '');
  if (!text) throw new Error(`Empty @default at ${where(node)}`);
  const literal = /^`([^`]+)`$/.exec(text);
  return literal ? { kind: 'literal', text: literal[1]! } : { kind: 'prose', text };
}

/**
 * A `/** ... *\/` comment in the trivia right before `node`, from `from` on.
 * Union members carry their docs this way (`/** doc *\/ | { keys }`), where the
 * compiler attaches no JSDoc.
 */
export function leadingDoc(node: ts.Node, from: number): string {
  const text = node.getSourceFile().text.slice(from, node.getStart());
  const match = /\/\*\*([\s\S]*?)\*\//.exec(text);
  if (!match) return '';
  return normalizeDoc(
    match[1]!
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, ''))
      .join('\n'),
  );
}

export function where(node: ts.Node): string {
  const file = node.getSourceFile();
  const { line } = file.getLineAndCharacterOfPosition(node.getStart());
  return `${file.fileName.slice(REPO_ROOT.length + 1)}:${String(line + 1)}`;
}
