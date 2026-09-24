#!/usr/bin/env node
// Static server for the fixture app, used as a `target.start` command in tests.
//   node serve.mjs --port <n> [--pid-file <path>] [--delay-ms <n>]
// With --pid-file it also spawns a long-lived grandchild and records both PIDs, so a test can
// check that the kit tore down the whole process tree and not just the shell it started.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createStaticServer } from './static-server.mjs';

const { values } = parseArgs({
  options: { port: { type: 'string' }, 'pid-file': { type: 'string' }, 'delay-ms': { type: 'string', default: '300' } },
});

let grandchild;
if (values['pid-file']) {
  grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(values['pid-file'], JSON.stringify({ server: process.pid, grandchild: grandchild.pid }));
}

setTimeout(() => {
  createStaticServer().listen(Number(values.port), '127.0.0.1', () => {
    console.log(`fixture app on http://127.0.0.1:${values.port}`);
  });
}, Number(values['delay-ms']));
