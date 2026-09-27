import { describe, expect, it } from 'vitest';
import { trailingRunStart, trimTrailing } from '../src/text.js';

describe('trimTrailing', () => {
  it.each([
    ['normal', 'http://127.0.0.1:9222/', '/', 'http://127.0.0.1:9222'],
    ['nothing to trim', '/projects/demo', '/', '/projects/demo'],
    ['empty', '', '/', ''],
    ['all separators', '////', '/', ''],
    ['a run of mixed separators', 'out\\gallery/\\//', '\\/', 'out\\gallery'],
    ['separators inside, not at the end', 'a//b', '/', 'a//b'],
    ['newlines', 'row 1\n\nrow 3\n\n\n', '\n', 'row 1\n\nrow 3'],
    ['spaces but not other blanks', 'cell \t  ', ' ', 'cell \t'],
  ])('%s', (_, text, chars, expected) => {
    expect(trimTrailing(text, chars)).toBe(expected);
  });

  it('matches the regex it replaces on every short string of separators and letters', () => {
    const regexes: Record<string, RegExp> = { '/': /\/+$/, '\\/': /[\\/]+$/, '\n': /\n+$/, ' ': / +$/ };
    const alphabet = ['/', '\\', '\n', ' ', 'a'];
    // Every string of up to 5 characters, shortest first.
    const texts = [''];
    for (let i = 0; (texts[i]?.length ?? 5) < 5; i++) for (const c of alphabet) texts.push(`${texts[i] ?? ''}${c}`);
    for (const [chars, regex] of Object.entries(regexes)) {
      for (const text of texts) expect(trimTrailing(text, chars), JSON.stringify(text)).toBe(text.replace(regex, ''));
    }
  });

  it('stays linear on a long run of separators that does not end the string', () => {
    const text = `${'/'.repeat(100_000)}x`;
    const start = performance.now();
    expect(trimTrailing(text, '/')).toBe(text);
    expect(trimTrailing(`${text}${'/'.repeat(100_000)}`, '/')).toBe(text);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe('trailingRunStart', () => {
  it('doubles trailing backslashes the way the shim quoting needs', () => {
    const double = (arg: string): string => arg + arg.slice(trailingRunStart(arg, '\\'));
    expect(double('C:\\my dir\\')).toBe('C:\\my dir\\\\');
    expect(double('C:\\my dir\\\\')).toBe('C:\\my dir\\\\\\\\');
    expect(double('a\\b')).toBe('a\\b');
    expect(double('')).toBe('');
    for (const arg of ['x', '\\', 'a\\\\', '\\a\\', 'a b\\\\\\']) expect(double(arg)).toBe(arg.replace(/(\\+)$/, '$1$1'));
  });
});
