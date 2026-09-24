import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  sourcemap: false,
  splitting: true,
  // The terminal renderer reads its bundled fonts from `./fonts/` next to the chunk that holds it.
  onSuccess: async () => {
    cpSync('src/tty/fonts', 'dist/fonts', { recursive: true });
  },
});
