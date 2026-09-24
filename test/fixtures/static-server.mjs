import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = resolve(dirname(fileURLToPath(import.meta.url)), 'app', 'index.html');

/** Serves the single-page fixture app for every path, like a dev server with history fallback. */
export function createStaticServer() {
  return createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(readFileSync(INDEX));
  });
}
