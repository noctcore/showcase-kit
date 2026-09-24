import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { isTtyConfig } from './config/resolve.js';
import type { ResolvedConfig } from './config/types.js';
import { ShowcaseError } from './errors.js';
import { escapeHtml } from './frame/template.js';
import { log } from './log.js';
import { outputPath, select } from './paths.js';
import { clipPath, selectClips, splitIds } from './record.js';

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
 * ready to paste into a README. Clips follow the shots: an `<img>` of the WebP (or GIF), with a link to the MP4
 * when there is one, or only a link for an MP4-only clip.
 */
export function readmeSnippet(config: ResolvedConfig, options: ReadmeOptions = {}): string {
  const cols = options.cols ?? 2;
  if (!Number.isInteger(cols) || cols < 1 || cols > 6) {
    throw new ShowcaseError(`--cols must be a whole number from 1 to 6, got ${String(options.cols)}`);
  }
  const template = config.outputs.readme;
  const clips = isTtyConfig(config) ? config.clips : [];
  if (template === false && clips.length === 0) {
    throw new ShowcaseError('outputs.readme is false, so there are no README images to list.');
  }
  const lang = options.lang ?? config.langs[0] ?? 'en';
  const only = splitIds(config, options.only);
  // An empty list means `--only` named clips and no shots, or the other way round.
  if (template === false && only.clips?.length === 0) {
    throw new ShowcaseError(
      `outputs.readme is false, so shots have no README images, and --only names only shots ` +
        `(${only.shots?.join(', ') ?? ''}). Name a clip too, or leave out --only to list every clip.`,
    );
  }
  const base = resolve(config.root, options.base ?? '.');
  const width = `${String(Math.floor(100 / cols))}%`;
  const src = (path: string, command: string): string => {
    if (!existsSync(path)) log.warn(`warning: ${relative(process.cwd(), path)} does not exist yet (run \`showcase ${command}\`).`);
    return escapeHtml(relative(base, path).split(sep).join('/'));
  };

  /** Cell contents as HTML. */
  const cells: { media: string; caption: string }[] = [];
  if (template !== false && only.shots?.length !== 0) {
    for (const shot of select(config, only.shots, [lang]).shots) {
      cells.push({
        media: `<img src="${src(outputPath(config, template, lang, shot.id), 'frame')}" alt="${escapeHtml(shot.alt)}" />`,
        caption: escapeHtml(shot.caption ?? shot.title),
      });
    }
  }
  if (isTtyConfig(config) && clips.length > 0 && only.clips?.length !== 0) {
    for (const clip of selectClips(config, only.clips, [lang]).clips) {
      const image = clip.formats.find(format => format !== 'mp4');
      const video = clip.formats.includes('mp4') ? src(clipPath(config, lang, clip.id, 'mp4'), 'record') : undefined;
      const caption = escapeHtml(clip.caption ?? clip.title);
      if (image) {
        cells.push({
          media: `<img src="${src(clipPath(config, lang, clip.id, image), 'record')}" alt="${escapeHtml(clip.alt)}" />`,
          caption: video ? `${caption} (<a href="${video}">MP4</a>)` : caption,
        });
      } else {
        // GitHub does not play a repository MP4 inline, so an MP4-only clip is a link.
        cells.push({ media: `<a href="${video ?? ''}">${escapeHtml(clip.alt)} (MP4)</a>`, caption });
      }
    }
  }

  const lines = ['<table>'];
  for (let start = 0; start < cells.length; start += cols) {
    const row = cells.slice(start, start + cols);
    lines.push('  <tr>');
    for (const cell of row) {
      lines.push(`    <td width="${width}">${cell.media}</td>`);
    }
    lines.push('  </tr>', '  <tr>');
    for (const cell of row) {
      lines.push(`    <td align="center"><sub>${cell.caption}</sub></td>`);
    }
    lines.push('  </tr>');
  }
  lines.push('</table>');
  return lines.join('\n');
}
