/**
 * The CLI reference against the built CLI's `--help` and src/cli.ts. Reads
 * dist/, so run `bun run build` at the repo root after changing src/.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS_DIR } from '../site';
import {
  buildCliReference,
  helpCommands,
  parseHelp,
  readCliSource,
  runHelp,
  withoutCommandList,
  type ParsedHelp,
} from './cli';

const help = parseHelp(runHelp());
const source = readCliSource();
const { reference, problems } = buildCliReference(help, source);

describe('the CLI reference', () => {
  test('--help and src/cli.ts agree on every command and option', () => {
    expect(problems).toEqual([]);
  });

  test('every option the CLI accepts is documented, with a description', () => {
    expect(reference.options.map((o) => o.name).sort()).toEqual(source.options.map((o) => o.name).sort());
    for (const option of reference.options) expect({ option: option.name, described: option.description !== '' }).toEqual({ option: option.name, described: true });
  });

  test('every option applies somewhere', () => {
    for (const option of reference.options) {
      expect({ option: option.name, applies: option.global || option.commands.length > 0 }).toEqual({ option: option.name, applies: true });
    }
  });

  test('every command in --help has its section on cli.mdx, in order', () => {
    const page = readFileSync(join(DOCS_DIR, 'reference', 'cli.mdx'), 'utf8');
    const sections = [...page.matchAll(/^## (\S+)\n\n<ReferenceCliCommand name="([^"]+)" \/>/gm)].map((m) => [m[1], m[2]]);
    expect(sections).toEqual(help.commands.map((c) => [c.name, c.name]));
    expect(page).toContain('<ReferenceCliOptions />');
  });
});

describe('reading --help', () => {
  const sample = [
    'tool: does things',
    '',
    'Usage: tool <command> [options]',
    '',
    'Commands:',
    '  build     Build it',
    '  icons     Make icons (no config needed)',
    '',
    'Options:',
    '  -c, --config <file>   Config file (default: tool.config.js in the',
    '                        current directory)',
    '      --only <ids>      Comma-separated ids (build, icons)',
    '      --out <dir>       Output directory (icons, default: icons)',
    '      --cols <n>        Images per row for build (default 2)',
    '  -h, --help            Show this help',
    '',
    'Needs a browser.',
  ].join('\n');

  test('splits usage, commands, options with continuation lines, and the note', () => {
    const parsed = parseHelp(sample);
    expect(parsed.usage).toBe('tool <command> [options]');
    expect(parsed.commands).toEqual([
      { name: 'build', summary: 'Build it' },
      { name: 'icons', summary: 'Make icons (no config needed)' },
    ]);
    expect(parsed.options[0]).toEqual({
      name: 'config',
      short: 'c',
      arg: '<file>',
      description: 'Config file (default: tool.config.js in the current directory)',
    });
    expect(parsed.options.map((o) => o.name)).toEqual(['config', 'only', 'out', 'cols', 'help']);
    expect(parsed.note).toBe('Needs a browser.');
  });

  test('reads the commands an option names, and drops them from its wording', () => {
    const commands = ['build', 'icons'];
    expect(helpCommands('Comma-separated ids (build, icons)', commands)).toEqual(['build', 'icons']);
    expect(helpCommands('Output directory (icons, default: icons)', commands)).toEqual(['icons']);
    expect(helpCommands('Images per row for build (default 2)', commands)).toEqual(['build']);
    expect(helpCommands('Show this help', commands)).toBeNull();
    expect(withoutCommandList('Comma-separated ids (build, icons)', commands)).toBe('Comma-separated ids');
    expect(withoutCommandList('Output directory (icons, default: icons)', commands)).toBe('Output directory (default: icons)');
    expect(withoutCommandList('Images per row for build (default 2)', commands)).toBe('Images per row for build (default 2)');
  });

  test('reports an option the help leaves out, and a command it does not list', () => {
    const trimmed: ParsedHelp = {
      ...help,
      commands: help.commands.filter((c) => c.name !== 'hero'),
      options: help.options.filter((o) => o.name !== 'base'),
    };
    const { problems: found } = buildCliReference(trimmed, source);
    expect(found).toContain('src/cli.ts accepts --base, but --help does not document it');
    expect(found).toContain('src/cli.ts handles the command `hero`, but --help does not list it');
  });

  test('reports help text that ties an option to the wrong commands', () => {
    const wrong: ParsedHelp = {
      ...help,
      options: help.options.map((o) => (o.name === 'cols' ? { ...o, description: 'Images per row (capture)' } : o)),
    };
    expect(buildCliReference(wrong, source).problems).toContain(
      '--cols: --help says it applies to capture, src/cli.ts reads it in readme',
    );
  });
});
