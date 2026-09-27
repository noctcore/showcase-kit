// A tiny dependency-free TUI for the terminal engine tests.
//
// Alternate screen, raw mode, 16/256/truecolor, styles, wide and fallback glyphs, a list moved with the arrows
// (or j/k), a second screen on Tab, and `q` or Ctrl+C to quit. The last input is shown escaped, so tests can
// check the exact bytes a key sent.
//
// Env: TUI_GRANDCHILD=1 starts a sleeping grandchild and shows its PID; TUI_IGNORE_QUIT=1 ignores q and Ctrl+C;
// TUI_APP_CURSOR=1 turns on application cursor keys (arrows then arrive as ESC O A); TUI_SPLIT_MS=<ms> writes each
// frame in two parts, the bottom three rows <ms> later, like one write a pty delivers in two reads;
// TUI_REDRAW_MS=<ms> redraws the same frame every <ms>, like an app that renders on a timer.
import { spawn } from 'node:child_process';

const out = process.stdout;
const items = ['api-gateway', 'billing-worker', 'postgres-main', 'redis-cache', 'web-frontend', 'cron-jobs'];
const appCursor = process.env.TUI_APP_CURSOR === '1';
const splitMs = Number(process.env.TUI_SPLIT_MS ?? 0);
const redrawMs = Number(process.env.TUI_REDRAW_MS ?? 0);
let selected = 0;
let screen = 'services';
let lastKey = '';

// Raw mode before the first draw: a key sent as soon as the screen shows must not be lost.
if (process.stdin.isTTY) process.stdin.setRawMode(true);

let grandchild;
if (process.env.TUI_GRANDCHILD === '1') {
  // It must outlive a plain teardown of the terminal, so only a real tree kill reaches it: on POSIX it ignores the
  // SIGHUP the session leader's exit sends (and stays in the process group), on Windows it has no console of its own.
  grandchild = spawn(process.execPath, ['-e', "process.on('SIGHUP', () => {}); setInterval(() => {}, 1e9)"], {
    stdio: 'ignore',
    detached: process.platform === 'win32',
    windowsHide: true,
  });
}

const esc = s => `\x1b[${s}`;
const move = (row, col) => esc(`${row};${col}H`);
const visible = s => s.replace(/[\x00-\x1f\x7f]/g, c => (c === '\x1b' ? '^[' : `^${String.fromCharCode(c.charCodeAt(0) ^ 0x40)}`));

function box(row, col, width, height, title) {
  let s = move(row, col) + '┌' + '─'.repeat(width - 2) + '┐';
  for (let i = 1; i < height - 1; i++) s += move(row + i, col) + '│' + ' '.repeat(width - 2) + '│';
  s += move(row + height - 1, col) + '└' + '─'.repeat(width - 2) + '┘';
  return s + move(row, col + 2) + esc('1m') + ` ${title} ` + esc('0m');
}

function draw() {
  const cols = out.columns ?? 80;
  const rows = out.rows ?? 24;
  let s = esc('?25l') + esc('2J') + esc('H');
  s += esc('48;2;30;34;48m') + esc('38;2;180;190;254m') + ` fixture-tui · ${screen} `.padEnd(cols) + esc('0m');
  if (screen === 'services') {
    s += box(3, 2, 34, items.length + 2, 'Services');
    items.forEach((name, i) => {
      const status = [esc('32m') + '● running', esc('33m') + '● deploying', esc('31m') + '● exited'][i % 3];
      s += move(4 + i, 4) + (i === selected ? esc('7m') : '') + name.padEnd(16) + esc('27m') + ' ' + status + esc('0m');
    });
    s += move(4, 38) + esc('1m') + 'bold' + esc('0m') + ' ' + esc('2m') + 'dim' + esc('0m') + ' ' + esc('3m') + 'italic';
    s += esc('0m') + ' ' + esc('4m') + 'underline' + esc('0m') + ' ' + esc('9m') + 'strike' + esc('0m');
    s += move(5, 38);
    for (let i = 0; i < 16; i++) s += esc(`48;5;${i}m`) + '  ';
    s += esc('0m') + move(6, 38);
    for (let i = 0; i < 32; i++) s += esc(`48;5;${16 + i * 7}m`) + ' ';
    s += esc('0m') + move(7, 38);
    for (let i = 0; i < 32; i++) s += esc(`48;2;${i * 8};${255 - i * 8};160m`) + ' ';
    s += esc('0m') + move(8, 38) + 'wide: 日本語 ✔ █▓▒░ ▲▼';
    s += move(10, 38) + esc('36m') + '⠋' + esc('0m') + ` selected ${items[selected]}`;
  } else {
    s += box(3, 2, cols - 3, 6, 'Details');
    s += move(4, 4) + `name: ${items[selected]}`;
    s += move(5, 4) + esc('38;5;208m') + 'orange 256' + esc('0m') + ' ' + esc('38;2;255;0;128m') + 'pink truecolor' + esc('0m');
  }
  let bottom = move(rows - 2, 1) + `size ${cols}x${rows}` + (grandchild ? `  grandchild ${grandchild.pid}` : '');
  bottom += move(rows - 1, 1) + `last key: ${visible(lastKey)}`;
  bottom += move(rows, 1) + esc('48;2;30;34;48m') + ' ↑/↓ move  tab switch  q quit '.padEnd(cols) + esc('0m');
  if (splitMs > 0) {
    out.write(s);
    setTimeout(() => out.write(bottom), splitMs);
  } else out.write(s + bottom);
}

function quit() {
  grandchild?.kill();
  out.write(esc('0m') + esc('2J') + esc('?1049l') + esc('?25h'));
  process.exit(0);
}

// Split one read into keys: terminals deliver `jj` or two arrow sequences as a single chunk.
function* keys(chunk) {
  let i = 0;
  while (i < chunk.length) {
    const rest = chunk.slice(i);
    const match = /^\x1b\[[0-9;?]*[\x40-\x7e]/.exec(rest) ?? /^\x1bO./.exec(rest) ?? /^\x1b./su.exec(rest);
    const key = match ? match[0] : String.fromCodePoint(rest.codePointAt(0));
    yield key;
    i += key.length;
  }
}

const UP = appCursor ? '\x1bOA' : '\x1b[A';
const DOWN = appCursor ? '\x1bOB' : '\x1b[B';

process.stdin.on('data', data => {
  for (const key of keys(data.toString())) {
    lastKey = key;
    if ((key === 'q' || key === '\x03') && process.env.TUI_IGNORE_QUIT !== '1') quit();
    if (key === 'j' || key === DOWN) selected = Math.min(items.length - 1, selected + 1);
    if (key === 'k' || key === UP) selected = Math.max(0, selected - 1);
    if (key === '\t') screen = screen === 'services' ? 'details' : 'services';
  }
  draw();
});
out.on('resize', draw);

out.write(esc('?1049h') + (appCursor ? esc('?1h') : ''));
draw();
if (redrawMs > 0) setInterval(draw, redrawMs);
