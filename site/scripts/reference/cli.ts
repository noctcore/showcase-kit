/**
 * The CLI reference, from two sources that must agree:
 *
 * - the built CLI's `--help` (run with `node dist/cli.js --help`): the command
 *   list, each option's placeholder and wording;
 * - src/cli.ts, read with the TypeScript compiler: the options `parseArgs`
 *   accepts, and which command reads which option (`values.x` inside that
 *   command's code). Help text can only hint at that; the code decides it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { REPO_ROOT } from '../site';
import { CLI_FILE, libraryProgram, sourceFile } from './source';
import type { CliCommand, CliOption, CliReference } from './types';

export const DIST_CLI = join(REPO_ROOT, 'dist', 'cli.js');

export function runHelp(): string {
  if (!existsSync(DIST_CLI)) throw new Error(`${DIST_CLI} is missing. Run \`bun run build\` at the repo root first.`);
  const result = spawnSync('node', [DIST_CLI, '--help'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`node dist/cli.js --help exited with ${String(result.status)}: ${result.stderr}`);
  return result.stdout;
}

export interface HelpOption {
  name: string;
  short?: string;
  arg?: string;
  description: string;
}

export interface ParsedHelp {
  usage: string;
  commands: { name: string; summary: string }[];
  options: HelpOption[];
  note: string;
}

/** Split `--help` into its usage line, command list, option list and closing note. */
export function parseHelp(text: string): ParsedHelp {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const usage = /^Usage: (.+)$/m.exec(text)?.[1]?.trim();
  if (!usage) throw new Error('--help has no "Usage:" line');

  const block = (title: string): string[] => {
    const start = lines.indexOf(`${title}:`);
    if (start === -1) throw new Error(`--help has no "${title}:" block`);
    const end = lines.findIndex((line, i) => i > start && line.trim() === '');
    return lines.slice(start + 1, end === -1 ? undefined : end);
  };

  const commands = block('Commands').map((line) => {
    const match = /^\s+(\S+)\s{2,}(.+)$/.exec(line);
    if (!match) throw new Error(`Cannot read the command line "${line}"`);
    return { name: match[1]!, summary: match[2]!.trim() };
  });

  const options: HelpOption[] = [];
  for (const line of block('Options')) {
    const match = /^\s+(?:-(\w), )?\s*--([\w-]+)(?: (<[^>]+>))?(?:\s{2,}(.*))?$/.exec(line);
    if (match) {
      const option: HelpOption = { name: match[2]!, description: (match[4] ?? '').trim() };
      if (match[1]) option.short = match[1];
      if (match[3]) option.arg = match[3];
      options.push(option);
    } else if (options.length > 0 && line.trim()) {
      const last = options[options.length - 1]!;
      last.description = `${last.description} ${line.trim()}`.trim();
    } else {
      throw new Error(`Cannot read the option line "${line}"`);
    }
  }

  const afterOptions = lines.indexOf('Options:') + 1 + block('Options').length;
  const note = lines.slice(afterOptions).join('\n').trim();
  return { usage, commands, options, note };
}

/**
 * The commands the help text ties an option to: a closing `(capture, frame)`
 * list or a `for readme` phrase. `null` when it names none.
 */
export function helpCommands(description: string, commands: string[]): string[] | null {
  const found = new Set<string>();
  const paren = /\(([^()]*)\)\s*$/.exec(description)?.[1];
  for (const item of paren?.split(',') ?? []) {
    const word = item.trim();
    if (commands.includes(word)) found.add(word);
  }
  for (const match of description.matchAll(/\bfor (\w+)\b/g)) {
    if (commands.includes(match[1]!)) found.add(match[1]!);
  }
  return found.size > 0 ? [...found] : null;
}

/** The description without the closing list of commands (`(icons, default: icons)` -> `(default: icons)`). */
export function withoutCommandList(description: string, commands: string[]): string {
  return description
    .replace(/\s*\(([^()]*)\)\s*$/, (whole, inner: string) => {
      const rest = inner
        .split(',')
        .map((item) => item.trim())
        .filter((item) => !commands.includes(item));
      if (rest.length === inner.split(',').length) return whole;
      return rest.length > 0 ? ` (${rest.join(', ')})` : '';
    })
    .trim();
}

export interface SourceCli {
  options: { name: string; type: 'string' | 'boolean'; short?: string }[];
  /** Options read before any command runs. */
  global: string[];
  /** Global options that print something and return before any command runs (`--help`, `--version`). */
  early: string[];
  /** Commands handled on their own, before a config is loaded, and the options each reads. */
  standalone: Record<string, string[]>;
  /** Commands that run on a loaded config, and the options each reads (the shared ones included). */
  withConfig: Record<string, string[]>;
}

/** Read src/cli.ts: the parseArgs options and, per command, the `values.x` it reads. */
export function readCliSource(program: ts.Program = libraryProgram()): SourceCli {
  const file = sourceFile(program, CLI_FILE);
  const main = file.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'main');
  if (!main?.body) throw new Error('src/cli.ts has no main()');

  const options: SourceCli['options'] = [];
  const visitOptions = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'parseArgs') {
      const arg = node.arguments[0];
      const optionsProp = arg && ts.isObjectLiteralExpression(arg) ? property(arg, 'options') : undefined;
      if (!optionsProp || !ts.isObjectLiteralExpression(optionsProp)) throw new Error('parseArgs has no options object');
      for (const entry of optionsProp.properties) {
        if (!ts.isPropertyAssignment(entry) || !ts.isObjectLiteralExpression(entry.initializer)) continue;
        const name = propName(entry.name);
        if (!name) throw new Error(`parseArgs option with a computed name at ${entry.getStart(file)}`);
        const type = stringProp(entry.initializer, 'type');
        if (type !== 'string' && type !== 'boolean') throw new Error(`Option ${name} has type ${String(type)}`);
        const short = stringProp(entry.initializer, 'short');
        options.push(short ? { name, type, short } : { name, type });
      }
    }
    ts.forEachChild(node, visitOptions);
  };
  visitOptions(main);

  const global = new Set<string>();
  const early = new Set<string>();
  const standalone: Record<string, string[]> = {};
  const withConfig: Record<string, string[]> = {};
  const shared = new Set<string>();
  let commandsSeen = false;

  for (const statement of main.body.statements) {
    const only = commandCheck(statement);
    if (only) {
      standalone[only] = valuesRead(statement);
      continue;
    }
    const commands = commandsObject(statement);
    if (commands) {
      commandsSeen = true;
      for (const entry of commands.properties) {
        const name = ts.isPropertyAssignment(entry) ? propName(entry.name) : undefined;
        if (!name || !ts.isPropertyAssignment(entry)) throw new Error('commands has an entry that is not `name: handler`');
        withConfig[name] = valuesRead(entry.initializer);
      }
      continue;
    }
    for (const name of valuesRead(statement)) (commandsSeen ? shared : global).add(name);
    if (!commandsSeen && ts.isIfStatement(statement) && returns(statement.thenStatement)) {
      for (const name of valuesRead(statement.expression)) early.add(name);
    }
  }
  if (!commandsSeen) throw new Error('src/cli.ts main() has no `const commands = { ... }` object');
  for (const name of Object.keys(withConfig)) {
    withConfig[name] = [...new Set([...withConfig[name]!, ...shared])];
  }
  return { options, global: [...global], early: [...early], standalone, withConfig };
}

function returns(statement: ts.Statement): boolean {
  return ts.isReturnStatement(statement) || (ts.isBlock(statement) && statement.statements.some(ts.isReturnStatement));
}

/** The name of a property written as `name`, `'name'` or `"name"`. */
function propName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const entry of object.properties) {
    if (ts.isPropertyAssignment(entry) && propName(entry.name) === name) return entry.initializer;
  }
  return undefined;
}

function stringProp(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const value = property(object, name);
  return value && ts.isStringLiteral(value) ? value.text : undefined;
}

/** `if (command === 'init') { ... }` -> `init`. */
function commandCheck(statement: ts.Statement): string | undefined {
  if (!ts.isIfStatement(statement)) return undefined;
  const test = statement.expression;
  if (
    ts.isBinaryExpression(test) &&
    test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isIdentifier(test.left) &&
    test.left.text === 'command' &&
    ts.isStringLiteral(test.right)
  ) {
    return test.right.text;
  }
  return undefined;
}

/** `const commands = { capture: ..., frame: ... }`. */
function commandsObject(statement: ts.Statement): ts.ObjectLiteralExpression | undefined {
  if (!ts.isVariableStatement(statement)) return undefined;
  for (const decl of statement.declarationList.declarations) {
    if (ts.isIdentifier(decl.name) && decl.name.text === 'commands' && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
      return decl.initializer;
    }
  }
  return undefined;
}

/** Every `values.x` read inside `node`. */
function valuesRead(node: ts.Node): string[] {
  const found = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'values') {
      found.add(child.name.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...found];
}

export interface CliResult {
  reference: CliReference;
  problems: string[];
}

export function buildCliReference(help: ParsedHelp = parseHelp(runHelp()), source: SourceCli = readCliSource()): CliResult {
  const problems: string[] = [];
  const commandNames = help.commands.map((c) => c.name);
  const sourceCommands = [...Object.keys(source.standalone), ...Object.keys(source.withConfig)];

  for (const name of commandNames) {
    if (!sourceCommands.includes(name)) problems.push(`--help lists the command \`${name}\`, but src/cli.ts does not handle it`);
  }
  for (const name of sourceCommands) {
    if (!commandNames.includes(name)) problems.push(`src/cli.ts handles the command \`${name}\`, but --help does not list it`);
  }

  const readers = (name: string): string[] =>
    sourceCommands.filter((command) => (source.standalone[command] ?? source.withConfig[command] ?? []).includes(name));

  const options: CliOption[] = [];
  for (const parsed of source.options) {
    const helped = help.options.find((o) => o.name === parsed.name);
    if (!helped) {
      problems.push(`src/cli.ts accepts --${parsed.name}, but --help does not document it`);
      continue;
    }
    if (helped.short !== parsed.short) {
      problems.push(`--${parsed.name}: --help gives the short flag ${String(helped.short)}, src/cli.ts ${String(parsed.short)}`);
    }
    if ((helped.arg !== undefined) !== (parsed.type === 'string')) {
      problems.push(`--${parsed.name}: --help and src/cli.ts disagree on whether it takes a value`);
    }
    const global = source.global.includes(parsed.name);
    const exits = source.early.includes(parsed.name);
    const commands = global ? [] : readers(parsed.name);
    if (!global && commands.length === 0) problems.push(`--${parsed.name}: no command reads it`);
    const hinted = helpCommands(helped.description, commandNames);
    if (hinted && !sameSet(hinted, commands)) {
      problems.push(`--${parsed.name}: --help says it applies to ${hinted.join(', ')}, src/cli.ts reads it in ${commands.join(', ') || 'no command'}`);
    }
    const option: CliOption = {
      name: parsed.name,
      type: parsed.type,
      description: withoutCommandList(helped.description, commandNames),
      commands,
      global,
      exits,
    };
    if (parsed.short) option.short = parsed.short;
    if (helped.arg) option.arg = helped.arg;
    options.push(option);
  }
  for (const helped of help.options) {
    if (!source.options.some((o) => o.name === helped.name)) {
      problems.push(`--help documents --${helped.name}, but src/cli.ts does not accept it`);
    }
  }

  const commands: CliCommand[] = help.commands.map(({ name, summary }) => ({
    name,
    summary,
    usage: `showcase ${name} [options]`,
    options: options.filter((o) => (o.global && !o.exits) || o.commands.includes(name)).map((o) => o.name),
    loadsConfig: name in source.withConfig,
  }));

  return { reference: { usage: help.usage, note: help.note, commands, options }, problems };
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}
