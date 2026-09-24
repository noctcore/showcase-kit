import { ShowcaseError } from '../errors.js';
import type { Keys } from './types.js';

export interface KeyOptions {
  /**
   * Application cursor keys mode (DECCKM), as the app last set it. Apps that turn it on (most ncurses style
   * TUIs) expect `ESC O A` for Up instead of `ESC [ A`, and the same for Home and End.
   */
  applicationCursor?: boolean;
}

/** Keys whose bytes depend on the application cursor keys mode: the final byte after `ESC [` or `ESC O`. */
const CURSOR_KEYS: Record<string, string> = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F' };

const FIXED_KEYS: Record<string, string> = {
  enter: '\r',
  tab: '\t',
  's-tab': '\x1b[Z',
  esc: '\x1b',
  space: ' ',
  backspace: '\x7f',
  insert: '\x1b[2~',
  delete: '\x1b[3~',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  f1: '\x1bOP',
  f2: '\x1bOQ',
  f3: '\x1bOR',
  f4: '\x1bOS',
  f5: '\x1b[15~',
  f6: '\x1b[17~',
  f7: '\x1b[18~',
  f8: '\x1b[19~',
  f9: '\x1b[20~',
  f10: '\x1b[21~',
  f11: '\x1b[23~',
  f12: '\x1b[24~',
};

const KNOWN =
  '{Enter} {Tab} {S-Tab} {Esc} {Space} {Backspace} {Insert} {Delete} {Up} {Down} {Left} {Right} {Home} {End} ' +
  '{PageUp} {PageDown} {F1} to {F12}, {C-x} (Ctrl), {A-x} (Alt), and {{ for a literal {';

/** The byte Ctrl plus `char` sends, or undefined when a terminal has no such key. */
function ctrl(char: string): string | undefined {
  if (char === ' ' || char === '@') return '\x00';
  if (char === '?') return '\x7f';
  const code = char.toUpperCase().charCodeAt(0);
  // `A` to `Z`, then `[ \ ] ^ _`.
  if (char.length === 1 && code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
  return undefined;
}

function named(name: string, source: string, opts: KeyOptions): string {
  const fail = (): never => {
    throw new ShowcaseError(`Unknown key {${name}} in ${JSON.stringify(source)}. Known keys: ${KNOWN}.`);
  };
  const combo = /^([CA])-(.)$/su.exec(name);
  if (combo) {
    const [, modifier, char = ''] = combo;
    if (modifier === 'A') return `\x1b${char}`;
    return ctrl(char) ?? fail();
  }
  const lower = name.toLowerCase();
  const cursor = CURSOR_KEYS[lower];
  if (cursor) return `\x1b${opts.applicationCursor ? 'O' : '['}${cursor}`;
  return FIXED_KEYS[lower] ?? fail();
}

/**
 * Turn `Keys` into keystrokes: one string of bytes per key, to be written one at a time. Plain text is typed a
 * character at a time; `{Name}` is a key (see `KNOWN`); `{{` is a literal `{`. Unknown names are errors.
 */
export function parseKeys(keys: Keys, opts: KeyOptions = {}): string[] {
  const strokes: string[] = [];
  for (const source of Array.isArray(keys) ? keys : [keys]) {
    let i = 0;
    while (i < source.length) {
      if (source.startsWith('{{', i)) {
        strokes.push('{');
        i += 2;
        continue;
      }
      if (source[i] === '{') {
        const end = source.indexOf('}', i + 2);
        if (end < 0) {
          throw new ShowcaseError(
            `Unclosed key name at ${JSON.stringify(source.slice(i))} in ${JSON.stringify(source)}. ` +
              'Write {{ for a literal {.',
          );
        }
        strokes.push(named(source.slice(i + 1, end), source, opts));
        i = end + 1;
        continue;
      }
      // One stroke per code point, so a surrogate pair is never split across two writes.
      const char = String.fromCodePoint(source.codePointAt(i) ?? 0);
      strokes.push(char);
      i += char.length;
    }
  }
  return strokes;
}
