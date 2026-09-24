import { describe, expect, it } from 'vitest';
import { ShowcaseError } from '../src/errors.js';
import { parseKeys } from '../src/tty/keys.js';

describe('parseKeys', () => {
  it('types plain text one character per keystroke, surrogate pairs whole', () => {
    expect(parseKeys('ab 😀')).toEqual(['a', 'b', ' ', '😀']);
  });

  it('maps named keys to the bytes xterm sends', () => {
    expect(parseKeys('{Enter}{Tab}{S-Tab}{Esc}{Space}{Backspace}{Insert}{Delete}{PageUp}{PageDown}')).toEqual([
      '\r',
      '\t',
      '\x1b[Z',
      '\x1b',
      ' ',
      '\x7f',
      '\x1b[2~',
      '\x1b[3~',
      '\x1b[5~',
      '\x1b[6~',
    ]);
  });

  it('maps F1 to F12', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `{F${String(i + 1)}}`).join('');
    expect(parseKeys(keys)).toEqual([
      '\x1bOP',
      '\x1bOQ',
      '\x1bOR',
      '\x1bOS',
      '\x1b[15~',
      '\x1b[17~',
      '\x1b[18~',
      '\x1b[19~',
      '\x1b[20~',
      '\x1b[21~',
      '\x1b[23~',
      '\x1b[24~',
    ]);
  });

  it('sends cursor keys in the mode the app asked for', () => {
    const keys = '{Up}{Down}{Right}{Left}{Home}{End}';
    expect(parseKeys(keys)).toEqual(['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D', '\x1b[H', '\x1b[F']);
    expect(parseKeys(keys, { applicationCursor: true })).toEqual(['\x1bOA', '\x1bOB', '\x1bOC', '\x1bOD', '\x1bOH', '\x1bOF']);
  });

  it('ignores the case of key names', () => {
    expect(parseKeys('{enter}{PAGEUP}{f5}')).toEqual(['\r', '\x1b[5~', '\x1b[15~']);
  });

  it('maps Ctrl combos to control bytes', () => {
    expect(parseKeys('{C-c}{C-C}{C-a}{C-z}{C-[}{C-@}{C- }{C-?}')).toEqual([
      '\x03',
      '\x03',
      '\x01',
      '\x1a',
      '\x1b',
      '\x00',
      '\x00',
      '\x7f',
    ]);
  });

  it('maps Alt combos to Esc plus the key, keeping the case', () => {
    expect(parseKeys('{A-x}{A-X}{A-1}')).toEqual(['\x1bx', '\x1bX', '\x1b1']);
  });

  it('reads {{ as a literal brace and a lone } as text', () => {
    expect(parseKeys('{{x}')).toEqual(['{', 'x', '}']);
  });

  it('accepts a list and keeps its order', () => {
    expect(parseKeys(['{Down}', 'l', '{Enter}'])).toEqual(['\x1b[B', 'l', '\r']);
  });

  it('rejects unknown names, impossible Ctrl combos and unclosed braces', () => {
    expect(() => parseKeys('{Foo}')).toThrow(ShowcaseError);
    expect(() => parseKeys('{Foo}')).toThrow(/Unknown key \{Foo\}.*Known keys/);
    expect(() => parseKeys('{F13}')).toThrow(/Unknown key \{F13\}/);
    expect(() => parseKeys('{C-1}')).toThrow(/Unknown key \{C-1\}/);
    expect(() => parseKeys('{C-ab}')).toThrow(/Unknown key/);
    expect(() => parseKeys('go {Enter')).toThrow(/Unclosed key name/);
    expect(() => parseKeys('{}')).toThrow(ShowcaseError);
  });
});
