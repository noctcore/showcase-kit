import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { ResolvedConfig } from './config/types.js';
import { ShowcaseError } from './errors.js';
import { escapeHtml } from './frame/template.js';
import { log } from './log.js';
import { outputPath, select } from './paths.js';

export interface ReadmeOptions {
  lang?: string;
  /** Images per row. Default 2. */
  cols?: number;
  /** Directory the README lives in; image paths are relative to it. Default: the config root. */
  base?: string;
  only?: string[];
}

/**
 * An HTML table of the framed images, images in one row and `<sub>` captions in the next,
 * ready to paste into a README.
 */
export function readmeSnippet(config: ResolvedConfig, options: ReadmeOptions = {}): string {
  const cols = options.cols ?? 2;
  if (!Number.isInteger(cols) || cols < 1 || cols > 6) {
    throw new ShowcaseError(`--cols must be a whole number from 1 to 6, got ${String(options.cols)}`);
  }
  const lang = options.lang ?? config.langs[0] ?? 'en';
  const { shots } = select(config, options.only, [lang]);
  const base = resolve(config.root, options.base ?? '.');
  const width = `${String(Math.floor(100 / cols))}%`;

  const cells = shots.map(shot => {
    const path = outputPath(config, config.outputs.readme, lang, shot.id);
    if (!existsSync(path)) log.warn(`warning: ${relative(process.cwd(), path)} does not exist yet (run \`showcase frame\`).`);
    return {
      src: relative(base, path).split(sep).join('/'),
      alt: shot.alt,
      caption: shot.caption ?? shot.title,
    };
  });

  const lines = ['<table>'];
  for (let start = 0; start < cells.length; start += cols) {
    const row = cells.slice(start, start + cols);
    lines.push('  <tr>');
    for (const cell of row) {
      lines.push(`    <td width="${width}"><img src="${escapeHtml(cell.src)}" alt="${escapeHtml(cell.alt)}" /></td>`);
    }
    lines.push('  </tr>', '  <tr>');
    for (const cell of row) {
      lines.push(`    <td align="center"><sub>${escapeHtml(cell.caption)}</sub></td>`);
    }
    lines.push('  </tr>');
  }
  lines.push('</table>');
  return lines.join('\n');
}
