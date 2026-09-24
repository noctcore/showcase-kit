import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ShowcaseError } from '../src/errors.js';
import { startCommand } from '../src/process.js';
import { tempDir } from './helpers.js';

describe('startCommand', () => {
  it('turns a failed spawn into a ShowcaseError, not an uncaught exception', async () => {
    const missing = join(tempDir(), 'does-not-exist');
    expect(() => startCommand('node -v', { cwd: missing })).toThrow(ShowcaseError);
    // The spawn error event fires on a later tick; without a listener it would crash the run here.
    await new Promise(resolve => setTimeout(resolve, 200));
  });
});
