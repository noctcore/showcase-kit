import { createHash } from 'node:crypto';
import type { IBufferCell, IBufferLine, Terminal } from '@xterm/headless';
import { ShowcaseError } from '../errors.js';
import { log } from '../log.js';
import { killTreeSync } from '../process.js';
import { parseKeys } from './keys.js';
import { loadPty, spawnPty, type PtyProcess } from './pty.js';
import type { OpenTtySession, TtyScreen, TtySession } from './types.js';

/** Attribute bits of a `GridCell`. */
export const Attr = {
  bold: 1,
  italic: 2,
  dim: 4,
  underline: 8,
  inverse: 16,
  invisible: 32,
  strikethrough: 64,
  overline: 128,
} as const;

/**
 * A color as the app set it, before any theme: -1 is the default color, 0 to 255 a palette index, and
 * `TRUECOLOR + 0xRRGGBB` a 24 bit color.
 */
export type GridColor = number;
export const DEFAULT_COLOR = -1;
export const TRUECOLOR = 0x1000000;

/** One cell: its text, width (1, or 2 for a wide char; the trailing half of a wide char is not stored), colors, attributes. */
export type GridCell = [chars: string, width: 1 | 2, fg: GridColor, bg: GridColor, attrs: number];

/** The engine-private `TtyScreen.grid`: every visible cell plus the cursor. */
export interface Grid {
  cols: number;
  rows: number;
  /** Per row, cells in column order with their start column. */
  cells: Array<Array<[x: number, cell: GridCell]>>;
  cursor: { x: number; y: number; visible: boolean };
}

function color(mode: 'fg' | 'bg', cell: IBufferCell): GridColor {
  if (mode === 'fg') {
    if (cell.isFgDefault()) return DEFAULT_COLOR;
    return cell.isFgRGB() ? TRUECOLOR + cell.getFgColor() : cell.getFgColor();
  }
  if (cell.isBgDefault()) return DEFAULT_COLOR;
  return cell.isBgRGB() ? TRUECOLOR + cell.getBgColor() : cell.getBgColor();
}

function attrs(cell: IBufferCell): number {
  return (
    (cell.isBold() ? Attr.bold : 0) |
    (cell.isItalic() ? Attr.italic : 0) |
    (cell.isDim() ? Attr.dim : 0) |
    (cell.isUnderline() ? Attr.underline : 0) |
    (cell.isInverse() ? Attr.inverse : 0) |
    (cell.isInvisible() ? Attr.invisible : 0) |
    (cell.isStrikethrough() ? Attr.strikethrough : 0) |
    (cell.isOverline() ? Attr.overline : 0)
  );
}

/** A row as plain text. xterm only trims cells never written to; spaces the app printed are trimmed too. */
function rowText(line: IBufferLine | undefined): string {
  return (line?.translateToString(true) ?? '').replace(/ +$/, '');
}

/** Copy the visible screen of `term` into an immutable `TtyScreen`. */
export function snapshot(term: Terminal, cursorVisible: boolean): TtyScreen {
  const buffer = term.buffer.active;
  const scratch = buffer.getNullCell();
  const cells: Grid['cells'] = [];
  const lines: string[] = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y);
    const row: Grid['cells'][number] = [];
    for (let x = 0; line && x < term.cols; x++) {
      line.getCell(x, scratch);
      const width = scratch.getWidth();
      if (width === 0) continue;
      row.push([x, [scratch.getChars() || ' ', width === 2 ? 2 : 1, color('fg', scratch), color('bg', scratch), attrs(scratch)]]);
    }
    cells.push(row);
    lines.push(rowText(line));
  }
  const grid: Grid = {
    cols: term.cols,
    rows: term.rows,
    cells,
    // A hidden cursor renders the same wherever it is, so its position only counts while it is visible.
    cursor: cursorVisible ? { x: buffer.cursorX, y: buffer.cursorY, visible: true } : { x: 0, y: 0, visible: false },
  };
  const key = createHash('sha256').update(JSON.stringify(grid)).digest('hex');
  return Object.freeze({ cols: term.cols, rows: term.rows, text: lines.join('\n'), key, grid });
}

type XtermModule = typeof import('@xterm/headless');

async function loadXterm(): Promise<XtermModule['Terminal']> {
  // A CommonJS bundle: Node exposes it as the default export.
  const mod = (await import('@xterm/headless')) as XtermModule & { default?: XtermModule };
  return (mod.default ?? mod).Terminal;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

/** True when `promise` settles within `ms`. Clears its timer, so a long timeout never holds the host open. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>(resolve => {
    timer = setTimeout(resolve, Math.max(0, ms), false);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** How long `close` waits for the app to quit after its quit key, and for the tree to die after a kill. */
const QUIT_WAIT_MS = 1_500;
const KILL_WAIT_MS = 5_000;
/** A lone Esc followed at once by another key reads as Alt plus that key. */
const ESC_GAP_MS = 50;
const POLL_MS = 50;

function describe(pattern: string | RegExp): string {
  return typeof pattern === 'string' ? JSON.stringify(pattern) : String(pattern);
}

export const openTtySession: OpenTtySession = async opts => {
  const [pty, Terminal] = await Promise.all([loadPty(), loadXterm()]);
  const term = new Terminal({ cols: opts.cols, rows: opts.rows, scrollback: 0, allowProposedApi: true });

  // DECTCEM (`CSI ? 25 h/l`) is not in the public buffer API; follow it without swallowing the sequence.
  let cursorVisible = true;
  const cursorMode = (visible: boolean) => (params: (number | number[])[]) => {
    if (params.includes(25)) cursorVisible = visible;
    return false;
  };
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, cursorMode(true));
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, cursorMode(false));
  // A full reset (RIS) shows the cursor again.
  term.parser.registerEscHandler({ final: 'c' }, () => {
    cursorVisible = true;
    return false;
  });

  const child: PtyProcess = spawnPty(pty, opts);
  let exitCode: number | null | undefined;
  let lastError: Error | undefined;
  // Without a listener the Windows terminal rethrows socket errors, which would crash the host.
  child.on?.('error', error => {
    // EIO is how a POSIX pty reports that the app closed it: a normal exit, not a failure.
    if ((error as NodeJS.ErrnoException).code !== 'EIO' && !/\bEIO\b/.test(error.message)) lastError = error;
  });
  const exited = new Promise<number | null>(resolve => {
    child.onExit(({ exitCode: code, signal }) => {
      exitCode = signal ? null : code;
      resolve(exitCode);
    });
  });
  const isRunning = (): boolean => exitCode === undefined;

  // After `close` the grid is final: output the PTY still delivers is dropped instead of drawn into a disposed
  // terminal. Reading the buffer once now keeps later reads from registering on a disposed terminal, which logs.
  let disposed = false;
  void term.buffer.active;
  child.onData(data => {
    if (!disposed) term.write(data);
  });
  // The app's terminal queries (DA1, DSR, cursor position) are answered by the headless xterm.
  term.onData(data => {
    if (isRunning()) child.write(data);
  });

  /** Resolves once everything the app printed so far has been parsed into the grid. */
  const flush = (): Promise<void> => (disposed ? Promise.resolve() : new Promise(resolve => term.write('', resolve)));

  const exitNote = (): string =>
    `exited (code ${String(exitCode)})${lastError ? ` with ${lastError.message}` : ''}`;

  const ensureRunning = (what: string): void => {
    if (!isRunning()) throw new ShowcaseError(`Cannot ${what}: the terminal app ${exitNote()}.\nScreen:\n${screenText()}`);
  };

  function screenText(): string {
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < term.rows; y++) lines.push(rowText(buffer.getLine(buffer.viewportY + y)));
    return lines.join('\n');
  }

  const write = async (strokes: string[], delayMs: number): Promise<void> => {
    for (const [i, stroke] of strokes.entries()) {
      ensureRunning(`send ${JSON.stringify(stroke)}`);
      child.write(stroke);
      if (i === strokes.length - 1) break;
      const gap = stroke === '\x1b' ? Math.max(delayMs, ESC_GAP_MS) : delayMs;
      if (gap > 0) await sleep(gap);
    }
  };

  let closing: Promise<void> | undefined;
  let ptyKilled = false;
  const killPty = (): void => {
    if (ptyKilled) return;
    ptyKilled = true;
    try {
      child.kill();
    } catch {
      // Already torn down.
    }
  };

  const session: TtySession = {
    // Read live: on Windows the PID is only known once ConPTY has connected the app, and the session is returned
    // before that so the caller can track it (and close it on Ctrl+C) from the start.
    get pid() {
      return child.pid;
    },
    exited,
    async press(keys) {
      await flush();
      await write(parseKeys(keys, { applicationCursor: term.modes.applicationCursorKeysMode }), 0);
    },
    async type(text, { delayMs = 0 } = {}) {
      await write(Array.from(text), delayMs);
    },
    async waitForText(pattern, { timeoutMs = 10_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await flush();
        const text = screenText();
        if (typeof pattern === 'string') {
          if (text.includes(pattern)) return;
        } else {
          pattern.lastIndex = 0;
          if (pattern.test(text)) return;
        }
        if (!isRunning()) {
          throw new ShowcaseError(`The terminal app ${exitNote()} before ${describe(pattern)} appeared.\nScreen:\n${text}`);
        }
        if (Date.now() >= deadline) {
          throw new ShowcaseError(
            `Timed out after ${String(timeoutMs)}ms waiting for ${describe(pattern)} on the terminal screen.\nScreen:\n${text}`,
          );
        }
        await sleep(POLL_MS);
      }
    },
    screenText,
    screen: () => snapshot(term, cursorVisible),
    async resize(cols, rows) {
      ensureRunning('resize');
      child.resize(cols, rows);
      term.resize(cols, rows);
      await flush();
    },
    sleep,
    /** Everything up to the first `await` runs at once, so a PID-less app is torn down even by a synchronous caller. */
    close({ quitKey = 'q' } = {}) {
      closing ??= (async () => {
        if (isRunning() && child.pid <= 0) {
          // ConPTY has not connected the app, so there is no tree to kill by PID and keys would only queue up. The
          // PTY's own kill runs once it connects, and node-pty reports an exit if it never does.
          log.warn(
            'The terminal app never reported a process ID; closing its terminal instead of killing its process ' +
              'tree, so programs it started may keep running.',
          );
          killPty();
          await settlesWithin(exited, KILL_WAIT_MS);
        } else if (isRunning() && quitKey !== false) {
          try {
            await write(parseKeys(quitKey), 0);
          } catch {
            // It may exit between the check and the write; the kill below covers every other case.
          }
          await settlesWithin(exited, QUIT_WAIT_MS);
        }
        // Until the exit is observed the PTY still holds the child, so its PID cannot belong to anyone else.
        // After that it may, so the tree is only killed while the app is still running.
        if (isRunning() && child.pid > 0) {
          killTreeSync(child.pid);
          await settlesWithin(exited, KILL_WAIT_MS);
        }
        // Windows keeps the pseudo console and its pipes open until `kill`, which would hold the host open.
        // On POSIX `kill` signals the PID, which is only safe while the child runs.
        if (process.platform === 'win32' || isRunning()) killPty();
        disposed = true;
        term.dispose();
      })();
      return closing;
    },
  };
  return session;
};
