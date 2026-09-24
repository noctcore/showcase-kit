import type { Mode, ShowcaseConfig, WebTarget } from './types.js';

/**
 * Identity helper that gives a config file full type checking and editor completion. The mode comes from
 * `target.mode`, so in tty mode `setup` and function `nav`s get the terminal session instead of a page.
 */
export function defineConfig<M extends Mode = WebTarget['mode']>(
  config: ShowcaseConfig<M> & { target: { mode: M } },
): ShowcaseConfig<M> {
  return config;
}
