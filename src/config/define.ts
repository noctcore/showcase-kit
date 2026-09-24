import type { ShowcaseConfig } from './types.js';

/** Identity helper that gives a config file full type checking and editor completion. */
export function defineConfig(config: ShowcaseConfig): ShowcaseConfig {
  return config;
}
