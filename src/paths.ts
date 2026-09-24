import { resolve } from 'node:path';
import type { ResolvedConfig, ResolvedShot } from './config/types.js';
import { ShowcaseError } from './errors.js';
import { fillTemplate } from './template.js';

/** Absolute path of an output file for one shot in one language. */
export function outputPath(config: ResolvedConfig, template: string, lang: string, id: string): string {
  return resolve(config.root, fillTemplate(template, { lang, id, slug: config.slug }));
}

export interface Selection {
  shots: ResolvedShot[];
  langs: string[];
}

/** Apply `--only` and `--langs`, refusing names the config does not know so typos do not silently do nothing. */
export function select(config: ResolvedConfig, only?: string[], langs?: string[]): Selection {
  const unknownShots = (only ?? []).filter(id => !config.shots.some(shot => shot.id === id));
  if (unknownShots.length > 0) {
    throw new ShowcaseError(
      `Unknown shot id(s): ${unknownShots.join(', ')}. Known: ${config.shots.map(shot => shot.id).join(', ')}`,
    );
  }
  const unknownLangs = (langs ?? []).filter(lang => !config.langs.includes(lang));
  if (unknownLangs.length > 0) {
    throw new ShowcaseError(`Unknown lang(s): ${unknownLangs.join(', ')}. Known: ${config.langs.join(', ')}`);
  }
  return {
    shots: only?.length ? config.shots.filter(shot => only.includes(shot.id)) : config.shots,
    langs: langs?.length ? config.langs.filter(lang => langs.includes(lang)) : config.langs,
  };
}
