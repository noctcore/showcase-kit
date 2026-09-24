import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture } from '../src/capture.js';
import { navUrl } from '../src/paths.js';
import { FIXTURES, fixtureConfig, tempDir } from './helpers.js';

describe('navUrl', () => {
  it('resolves a root-relative path under the target url path', () => {
    expect(navUrl('/docs/', 'https://x.io/app/')).toBe('https://x.io/app/docs/');
    expect(navUrl('/docs/intro?tab=2#top', 'https://x.io/app/')).toBe('https://x.io/app/docs/intro?tab=2#top');
  });

  it('treats a target url without a trailing slash as a directory', () => {
    expect(navUrl('/docs/', 'https://x.io/app')).toBe('https://x.io/app/docs/');
  });

  it('maps "/" to the target url itself', () => {
    expect(navUrl('/', 'https://x.io/app/')).toBe('https://x.io/app/');
    expect(navUrl('/', 'http://localhost:5173')).toBe('http://localhost:5173/');
  });

  it('keeps plain origin urls working as before', () => {
    expect(navUrl('/about', 'http://localhost:5173/')).toBe('http://localhost:5173/about');
  });

  it('drops the target url query and hash', () => {
    expect(navUrl('/about', 'http://localhost:3000/?showcase=1#x')).toBe('http://localhost:3000/about');
  });

  it('drops a file-shaped last segment of the target url, like a relative link', () => {
    expect(navUrl('/about', 'http://localhost:5173/index.html')).toBe('http://localhost:5173/about');
    expect(navUrl('/docs/', 'https://x.io/app/index.html?x=1')).toBe('https://x.io/app/docs/');
    expect(navUrl('/', 'https://x.io/app/app.php')).toBe('https://x.io/app/');
    expect(navUrl('about', 'http://localhost:5173/index.html')).toBe('http://localhost:5173/about');
  });

  it('keeps a dotted segment with a trailing slash as a directory', () => {
    expect(navUrl('/docs', 'https://x.io/v1.2/')).toBe('https://x.io/v1.2/docs');
    // Without the slash it reads as a file.
    expect(navUrl('/docs', 'https://x.io/v1.2')).toBe('https://x.io/docs');
  });

  it('resolves a relative path under the target url path too', () => {
    expect(navUrl('docs/', 'https://x.io/app')).toBe('https://x.io/app/docs/');
  });

  it('leaves absolute urls alone', () => {
    expect(navUrl('https://other.dev/page', 'https://x.io/app/')).toBe('https://other.dev/page');
  });
});

describe('capture, url mode under a base path', () => {
  let server: Server;
  let base: string;
  const requested: string[] = [];
  beforeAll(async () => {
    const index = readFileSync(join(FIXTURES, 'app', 'index.html'));
    server = createServer((request, response) => {
      requested.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(index);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/app/`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  });

  it('visits path navs under the target url path, not the origin', async () => {
    const config = fixtureConfig(tempDir(), {
      target: { mode: 'url', url: base },
      shots: [
        { id: 'docs', nav: '/docs/' },
        { id: 'guide', nav: { goto: '/guide' } },
      ],
    });
    await capture(config);
    expect(requested).toEqual(expect.arrayContaining(['/app/', '/app/docs/', '/app/guide']));
    expect(requested).not.toContain('/docs/');
    expect(requested).not.toContain('/guide');
  });
});
