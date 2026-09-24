// A CLI that prints one known screen and exits 0 at once, like `mytool --version` or a one-shot report. Its
// arguments are shown as JSON, so tests can check what a `.cmd` shim passed through.
process.stdout.write(`print-exit done\r\nargs ${JSON.stringify(process.argv.slice(2))}\r\n`);
