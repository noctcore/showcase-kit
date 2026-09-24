import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../src/config/resolve.js';
import type { ResolvedConfig, ShowcaseConfig } from '../src/config/types.js';
import { createStaticServer } from './fixtures/static-server.mjs';

export const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function tempDir(prefix = 'showcase-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

export interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

/** Serve the fixture app in-process on a free port. */
export async function serveFixture(): Promise<FixtureServer> {
  const server: Server = createStaticServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/`,
    close: () =>
      new Promise<void>(done => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** A small viewport keeps the e2e tests fast while still exercising DPR scaling. */
export function fixtureConfig(
  root: string,
  overrides: Partial<ShowcaseConfig> & Pick<ShowcaseConfig, 'target'>,
): ResolvedConfig {
  return resolveConfig(
    {
      name: 'Fixture App',
      ready: '[data-testid="app-ready"]',
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 2,
      shots: [
        { id: 'home', title: 'Home', caption: 'The home view.', nav: '[data-view="home"]' },
        { id: 'settings', title: 'Settings', caption: 'Settings grid.', nav: '[data-view="settings"]' },
        { id: 'about', title: 'About', nav: '/about', waitFor: '[data-testid="about-page"]' },
      ],
      ...overrides,
    },
    root,
  );
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
