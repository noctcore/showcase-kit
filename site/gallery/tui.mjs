#!/usr/bin/env node
// nightjar queue: the terminal side of the gallery's fixture app, captured in tty mode.
//
// No dependencies. Every screen is drawn from the fixed data below: no clock (the header time is a constant), no
// randomness, no network, nothing that moves on its own. Keys: j/k or the arrows move, Tab switches between the
// queue and the session log, q or Ctrl+C quits.

const out = process.stdout;
const COLS = out.columns ?? 100;
const ROWS = out.rows ?? 28;

const QUEUE = [
  { id: 'M57', name: 'Ring Nebula', type: 'Planetary nebula', ra: '18h 53m 35s', dec: '+33° 01′ 45″', filter: 'OIII', exposure: '120 s', done: 24, total: 40, state: 'imaging', alt: [34, 42, 51, 60, 68, 74, 78, 77, 73, 66, 58, 49] },
  { id: 'M27', name: 'Dumbbell Nebula', type: 'Planetary nebula', ra: '19h 59m 36s', dec: '+22° 43′ 16″', filter: 'OIII', exposure: '120 s', done: 0, total: 36, state: 'next', alt: [22, 31, 40, 49, 57, 63, 66, 65, 61, 54, 46, 37] },
  { id: 'M13', name: 'Hercules Cluster', type: 'Globular cluster', ra: '16h 41m 41s', dec: '+36° 27′ 41″', filter: 'L', exposure: '60 s', done: 60, total: 60, state: 'done', alt: [62, 60, 56, 50, 44, 37, 30, 23, 17, 11, 6, 2] },
  { id: 'M31', name: 'Andromeda Galaxy', type: 'Galaxy', ra: '00h 42m 44s', dec: '+41° 16′ 09″', filter: 'L', exposure: '180 s', done: 0, total: 30, state: 'waiting', alt: [12, 16, 20, 24, 28, 32, 36, 40, 44, 47, 50, 52] },
  { id: 'M81', name: "Bode's Galaxy", type: 'Galaxy', ra: '09h 55m 33s', dec: '+69° 03′ 55″', filter: 'L', exposure: '180 s', done: 0, total: 24, state: 'waiting', alt: [24, 22, 21, 21, 22, 24, 26, 28, 31, 34, 38, 42] },
  { id: 'NGC7000', name: 'North America Nebula', type: 'Emission nebula', ra: '20h 59m 17s', dec: '+44° 31′ 44″', filter: 'Ha', exposure: '300 s', done: 8, total: 20, state: 'paused', alt: [52, 60, 67, 73, 78, 80, 79, 76, 71, 64, 57, 49] },
];

const LOG = [
  ['21:04', 'info', 'Dark window opened, dome at 0°'],
  ['21:06', 'info', 'Focus run: HFD 2.14 px at step 18420'],
  ['21:12', 'ok', 'M13: 60 of 60 frames, sequence complete'],
  ['22:02', 'info', 'Meridian flip for M13 skipped (sequence done)'],
  ['22:05', 'info', 'M57: slewing, plate solve 1.8″ off'],
  ['22:07', 'ok', 'M57: guiding RMS 0.62″'],
  ['22:31', 'warn', 'NGC7000: paused, altitude above the dome slit'],
  ['22:40', 'ok', 'M57: frame 24 of 40 saved'],
];

const esc = code => `\x1b[${code}`;
const rgb = (r, g, b) => esc(`38;2;${r};${g};${b}m`);
const bg = (r, g, b) => esc(`48;2;${r};${g};${b}m`);
const RESET = esc('0m');
const BOLD = esc('1m');
const C = {
  fg: rgb(230, 233, 245),
  muted: rgb(139, 147, 179),
  violet: rgb(139, 124, 255),
  cyan: rgb(77, 208, 225),
  green: rgb(94, 224, 160),
  amber: rgb(242, 196, 109),
  red: rgb(255, 128, 140),
  line: rgb(58, 70, 112),
};
const STATE = {
  imaging: [C.cyan, '● imaging'],
  next: [C.violet, '◆ next'],
  done: [C.green, '✓ done'],
  waiting: [C.muted, '○ waiting'],
  paused: [C.amber, '‖ paused'],
};
const LEVEL = { info: C.muted, ok: C.green, warn: C.amber };

const move = (row, col) => esc(`${row};${col}H`);

function box(row, col, width, height, title) {
  let s = C.line + move(row, col) + '╭' + '─'.repeat(width - 2) + '╮';
  for (let i = 1; i < height - 1; i++) s += move(row + i, col) + '│' + move(row + i, col + width - 1) + '│';
  s += move(row + height - 1, col) + '╰' + '─'.repeat(width - 2) + '╯';
  return s + move(row, col + 2) + RESET + BOLD + C.fg + ` ${title} ` + RESET;
}

function progress(done, total, width) {
  const filled = Math.round((done / total) * width);
  return C.cyan + '█'.repeat(filled) + C.line + '░'.repeat(width - filled) + RESET;
}

function sparkline(values) {
  const blocks = '▁▂▃▄▅▆▇█';
  return values.map(value => blocks[Math.min(7, Math.floor((value / 90) * 8))]).join('');
}

let selected = 0;
let tab = 'queue';

function header() {
  const left = ` nightjar ${C.muted}·${C.fg} ${tab === 'queue' ? 'imaging queue' : 'session log'}`;
  const right = 'Hilltop field  22:41 UTC ';
  const plain = left.replace(/\x1b\[[0-9;]*m/g, '');
  return move(1, 1) + bg(27, 24, 80) + C.fg + BOLD + left + ' '.repeat(Math.max(1, COLS - plain.length - right.length)) + right + RESET;
}

function tabs() {
  const label = (name, text) => (tab === name ? bg(58, 50, 140) + C.fg + BOLD + ` ${text} ` + RESET : C.muted + ` ${text} ` + RESET);
  return move(3, 3) + label('queue', `Queue (${QUEUE.length})`) + ' ' + label('log', `Log (${LOG.length})`);
}

function queueScreen() {
  const listWidth = 44;
  let s = box(5, 2, listWidth, QUEUE.length + 4, 'Targets');
  QUEUE.forEach((target, index) => {
    const [color, label] = STATE[target.state];
    const line = `${target.id.padEnd(9)}${`${target.done}/${target.total}`.padStart(6)}  `;
    s += move(7 + index, 4);
    s += index === selected ? bg(40, 44, 88) + C.fg + BOLD + '▌' : ' ';
    s += line + RESET + (index === selected ? bg(40, 44, 88) : '') + color + label.padEnd(listWidth - 6 - line.length) + RESET;
  });

  const target = QUEUE[selected];
  const col = listWidth + 4;
  const width = COLS - col - 1;
  s += box(5, col, width, 17, `${target.id}  ${target.name}`);
  const rows = [
    ['Type', target.type],
    ['RA / Dec', `${target.ra}   ${target.dec}`],
    ['Filter', `${target.filter}, ${target.exposure} subs`],
    ['State', STATE[target.state][0] + STATE[target.state][1] + RESET],
  ];
  rows.forEach(([key, value], index) => {
    s += move(7 + index, col + 2) + C.muted + key.padEnd(10) + RESET + C.fg + value + RESET;
  });
  s += move(12, col + 2) + C.muted + 'Frames'.padEnd(10) + RESET + progress(target.done, target.total, 24) + C.fg + `  ${target.done} of ${target.total}` + RESET;
  s += move(14, col + 2) + C.muted + 'Altitude, 21:00 to 03:00' + RESET;
  s += move(15, col + 2) + C.violet + sparkline(target.alt).replace(/./g, block => block + block) + RESET;
  s += move(16, col + 2) + C.muted + `peak ${Math.max(...target.alt)}°` + RESET;
  s += move(18, col + 2) + C.muted + 'Guiding' + RESET + '  ' + C.green + 'RMS 0.62″' + RESET + C.muted + '   Focus ' + RESET + C.fg + 'HFD 2.14 px' + RESET;
  s += move(19, col + 2) + C.muted + 'Camera ' + RESET + '  ' + C.fg + '-10.0 °C, gain 100, bin 1' + RESET;
  return s;
}

function logScreen() {
  let s = box(5, 2, COLS - 2, LOG.length + 4, 'Session log');
  LOG.forEach(([time, level, text], index) => {
    s += move(7 + index, 4) + C.muted + time + RESET + '  ' + LEVEL[level] + level.padEnd(5) + RESET + ' ' + C.fg + text + RESET;
  });
  return s;
}

function draw() {
  let s = esc('?25l') + esc('2J') + esc('H');
  s += header() + tabs();
  s += tab === 'queue' ? queueScreen() : logScreen();
  s += move(ROWS, 2) + C.muted + (tab === 'queue' ? 'j/k move   tab log   q quit' : 'tab queue   q quit') + RESET;
  out.write(s);
}

function quit() {
  out.write(esc('0m') + esc('2J') + esc('?25h') + esc('?1049l'));
  process.exit(0);
}

// Raw mode before the first draw, so a key sent as soon as the screen shows is not lost.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
  if (data === 'q' || data === '\x03') return quit();
  if (data === '\t') tab = tab === 'queue' ? 'log' : 'queue';
  else if (tab === 'queue' && (data === 'j' || data === '\x1b[B' || data === '\x1bOB')) selected = Math.min(QUEUE.length - 1, selected + 1);
  else if (tab === 'queue' && (data === 'k' || data === '\x1b[A' || data === '\x1bOA')) selected = Math.max(0, selected - 1);
  else return;
  draw();
});

out.write(esc('?1049h'));
draw();
