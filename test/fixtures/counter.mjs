// A busy TUI for clip tests: a counter redrawn every 40 ms, faster than any clip frame rate, so every frame of a
// recording differs. The rest of the screen is text that changes with the counter, like a live dashboard. `q` quits.
const out = process.stdout;
if (process.stdin.isTTY) process.stdin.setRawMode(true);

const esc = s => `\x1b[${s}`;
let count = 0;

function draw() {
  const cols = out.columns ?? 80;
  const rows = out.rows ?? 24;
  let s = esc('H') + esc('48;2;30;34;48m') + ` counter ${String(count).padStart(6, '0')} `.padEnd(cols) + esc('0m');
  for (let row = 2; row < rows; row++) {
    const value = (count * 7919 + row * 104729) % 1000003;
    const bar = '█'.repeat(value % Math.max(1, cols - 24));
    s += `${esc(`${row};1H`)}${esc(`38;5;${String(16 + ((row + count) % 216))}m`)}${String(value).padStart(8)} ${bar}${esc('0m')}${esc('K')}`;
  }
  out.write(s);
  count++;
}

process.stdin.on('data', data => {
  if (data.toString().includes('q')) {
    out.write(esc('0m') + esc('2J') + esc('?1049l') + esc('?25h'));
    process.exit(0);
  }
});

out.write(esc('?1049h') + esc('?25l') + esc('2J'));
draw();
setInterval(draw, 40);
