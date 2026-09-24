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

  it('resolves a hash or a query against the target url itself, keeping its file', () => {
    expect(navUrl('#/settings', 'http://h/app/index.html')).toBe('http://h/app/index.html#/settings');
    expect(navUrl('?tab=2', 'http://h/app/index.html?lang=en')).toBe('http://h/app/index.html?tab=2');
    expect(navUrl('#x', 'http://h/app')).toBe('http://h/app#x');
    expect(navUrl('#x', 'http://h/app/?lang=en')).toBe('http://h/app/?lang=en#x');
  });

  it('resolves a relative path like a browser link, from the url as written', () => {
    expect(navUrl('docs/', 'https://x.io/app/')).toBe('https://x.io/app/docs/');
    // Without a trailing slash `app` is the file a relative link replaces.
    expect(navUrl('docs/', 'https://x.io/app')).toBe('https://x.io/docs/');
    expect(navUrl('../x', 'https://x.io/app/sub/')).toBe('https://x.io/app/x');
    expect(navUrl('./about', 'http://localhost:5173/index.html')).toBe('http://localhost:5173/about');
  });

  it('leaves absolute urls alone', () => {
    expect(navUrl('https://other.dev/page', 'https://x.io/app/')).toBe('https://other.dev/page');
    expect(navUrl('http://other.dev/?q=1#h', 'https://x.io/app/')).toBe('http://other.dev/?q=1#h');
  });

  it('keeps a protocol-relative nav on the target origin, in every spelling the url parser accepts', () => {
    expect(navUrl('//host/x', 'https://x.io/app/')).toBe('https://x.io/app//host/x');
    expect(navUrl('//host/x', 'http://localhost:5173')).toBe('http://localhost:5173//host/x');
    for (const nav of ['\\\\host/x', '/\\host/x', '\\/host/x', ' //host/x', '\u0001//host/x', '/\t/host/x', '/\n/host/x']) {
      // `new URL(nav, base)` would visit https://host/x for each of these.
      expect(new URL(navUrl(nav, 'https://x.io/app/')).origin, JSON.stringify(nav)).toBe('https://x.io');
    }
    expect(navUrl('\\docs', 'https://x.io/app/')).toBe('https://x.io/app/docs');
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
