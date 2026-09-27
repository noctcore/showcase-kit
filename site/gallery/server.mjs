#!/usr/bin/env node
// Static server for the gallery's fixture app, started by showcase-kit through `target.start`.
//   node server.mjs --port <n>
// It binds to 127.0.0.1 only and serves app/ plus the site's mark, with no caching.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, 'app');
// The app's logo is the docs site's own mark, served from where the site keeps it.
const EXTRA = { '/mark.svg': join(HERE, '..', 'src', 'assets', 'mark.svg') };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const { values } = parseArgs({ options: { port: { type: 'string' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port <= 0) {
  console.error('usage: node server.mjs --port <n>');
  process.exit(1);
}

/** The file for a request path, or undefined when there is none (or the path leaves app/). */
function fileFor(pathname) {
  if (EXTRA[pathname]) return EXTRA[pathname];
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape such as `/%E0%A4%A` is a bad request, not a reason to stop the server mid-capture.
    return undefined;
  }
  const path = normalize(join(APP, decoded));
  if (path !== APP && !path.startsWith(APP + sep)) return undefined;
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
  return existsSync(file) ? file : undefined;
}

createServer((request, response) => {
  const file = fileFor(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  response.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => {
  console.log(`nightjar on http://127.0.0.1:${port}/`);
});
