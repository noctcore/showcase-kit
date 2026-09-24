import type { Browser } from 'playwright';
import type { ResolvedConfig } from './config/types.js';
import { ShowcaseError } from './errors.js';

type Playwright = typeof import('playwright');

let cached: Playwright | undefined;

/** Import the consumer's Playwright lazily, so commands that never open a browser work without it. */
export async function loadPlaywright(): Promise<Playwright> {
  if (cached) return cached;
  try {
    cached = await import('playwright');
    return cached;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      throw new ShowcaseError(
        'showcase-kit needs Playwright. Install it next to the kit and download Chromium:\n' +
          '  pnpm add -D playwright   (or npm i -D / bun add -d)\n' +
          '  npx playwright install chromium',
      );
    }
    throw error;
  }
}

/** Launch the Chromium that renders frames and drives url-mode captures. */
export async function launchBrowser(config: ResolvedConfig): Promise<Browser> {
  const { chromium } = await loadPlaywright();
  const { channel, executablePath, headless = true, args } = config.browser;
  try {
    return await chromium.launch({ channel, executablePath, headless, args });
  } catch (error) {
    const message = (error as Error).message;
    if (/Executable doesn't exist|browserType\.launch: .*(not found|install)/i.test(message)) {
      throw new ShowcaseError(
        'Chromium for Playwright is not installed. Run `npx playwright install chromium`, ' +
          'or set `browser: { channel: "chrome" }` (or "msedge") in the config to use an installed browser.\n\n' +
          message,
      );
    }
    throw error;
  }
}
