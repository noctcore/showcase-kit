import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { isTtyConfig } from './config/resolve.js';
import type { ResolvedConfig } from './config/types.js';
import { ShowcaseError } from './errors.js';
import { escapeHtml } from './frame/template.js';
import { log } from './log.js';
import { outputPath, select } from './paths.js';
import { clipPath, selectClips, splitIds } from './record.js';

/**
 * How `showcase readme` lays out the images. Every layout uses only HTML that GitHub keeps in a README.
 *
 * - `table`: a table, a row of images and a row of `<sub>` captions under it, `cols` per row.
 * - `rows`: one small table per image, the image on one side and its title and caption on the other, alternating sides.
 * - `featured`: the first image full width with its caption, then the others in a table, `cols` per row.
 * - `details`: one collapsible `<details>` per image, the caption as its summary; the first starts open.
 * - `list`: every image full width, one under the other, each with its caption.
 */
export type ReadmeLayout = 'table' | 'rows' | 'featured' | 'details' | 'list';

export const README_LAYOUTS: readonly ReadmeLayout[] = ['table', 'rows', 'featured', 'details', 'list'];

export interface ReadmeOptions {
  lang?: string;
  /** How the images are laid out. Default `'table'`. */
  layout?: ReadmeLayout;
  /** Images per row in the `table` layout, thumbnails per row in `featured`. Default 2. */
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
  const layout = options.layout ?? 'table';
  if (!README_LAYOUTS.includes(layout)) {
    throw new ShowcaseError(`--layout must be one of ${README_LAYOUTS.join(', ')}, got ${String(options.layout)}`);
  }
  const cols = options.cols ?? 2;
  if (!Number.isInteger(cols) || cols < 1 || cols > 6) {
    throw new ShowcaseError(`--cols must be a whole number from 1 to 6, got ${String(options.cols)}`);
  }
  if (options.cols !== undefined && layout !== 'table' && layout !== 'featured') {
    throw new ShowcaseError(`--cols only applies to the table and featured layouts, not ${layout}`);
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
  const src = (path: string, command: string): string => {
    if (!existsSync(path)) log.warn(`warning: ${relative(process.cwd(), path)} does not exist yet (run \`showcase ${command}\`).`);
    return escapeHtml(relative(base, path).split(sep).join('/'));
  };

  const cells: Cell[] = [];
  if (template !== false && only.shots?.length !== 0) {
    for (const shot of select(config, only.shots, [lang]).shots) {
      cells.push({
        media: `<img src="${src(outputPath(config, template, lang, shot.id), 'frame')}" alt="${escapeHtml(shot.alt)}" />`,
        title: escapeHtml(shot.title),
        caption: escapeHtml(shot.caption ?? shot.title),
      });
    }
  }
  if (isTtyConfig(config) && clips.length > 0 && only.clips?.length !== 0) {
    for (const clip of selectClips(config, only.clips, [lang]).clips) {
      const image = clip.formats.find(format => format !== 'mp4');
      const video = clip.formats.includes('mp4') ? src(clipPath(config, lang, clip.id, 'mp4'), 'record') : undefined;
      const caption = escapeHtml(clip.caption ?? clip.title);
      const title = escapeHtml(clip.title);
      if (image) {
        cells.push({
          media: `<img src="${src(clipPath(config, lang, clip.id, image), 'record')}" alt="${escapeHtml(clip.alt)}" />`,
          title,
          caption: video ? `${caption} (<a href="${video}">MP4</a>)` : caption,
        });
      } else {
        // GitHub does not play a repository MP4 inline, so an MP4-only clip is a link.
        cells.push({ media: `<a href="${video ?? ''}">${escapeHtml(clip.alt)} (MP4)</a>`, title, caption, link: true });
      }
    }
  }
  return LAYOUTS[layout](cells, cols).join('\n');
}

/** One image (or clip link) of the snippet, every field already HTML. */
interface Cell {
  media: string;
  title: string;
  caption: string;
  /** An MP4-only clip: `media` is a link, not an image. */
  link?: boolean;
}

/** `media` stretched to the full width of what holds it; a link stays a link. */
function fullWidth(cell: Cell): string {
  return cell.link ? cell.media : cell.media.replace('<img ', '<img width="100%" ');
}

/** The table layout: images in one row, `<sub>` captions in the next, `cols` per row. */
function table(cells: Cell[], cols: number): string[] {
  const width = `${String(Math.floor(100 / cols))}%`;
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
  return lines;
}

// GitHub keeps no CSS in a README, only a short list of tags and attributes: tables with `width` and `align`,
// `<details>`, `<summary>`, `<p align>`, `<h3>`, `<sub>`, `<br>`. Each layout is built from those.
const LAYOUTS: Record<ReadmeLayout, (cells: Cell[], cols: number) => string[]> = {
  table,
  // One table per row: in a single table the columns are shared, so alternating 60% and 40% cells would fight.
  rows: cells =>
    cells.flatMap((cell, index) => {
      const image = `    <td width="60%">${cell.media}</td>`;
      const text = `    <td width="40%"><h3>${cell.title}</h3>${cell.caption === cell.title ? '' : `<p>${cell.caption}</p>`}</td>`;
      return ['<table>', '  <tr>', ...(index % 2 === 0 ? [image, text] : [text, image]), '  </tr>', '</table>'];
    }),
  featured: (cells, cols) => {
    const [first, ...rest] = cells;
    if (!first) return [];
    const lines = ['<p align="center">', `  ${fullWidth(first)}`, `  <br /><sub>${first.caption}</sub>`, '</p>'];
    return rest.length > 0 ? [...lines, ...table(rest, cols)] : lines;
  },
  details: cells =>
    cells.flatMap((cell, index) => [
      index === 0 ? '<details open>' : '<details>',
      `  <summary><b>${cell.title}</b>${cell.caption === cell.title ? '' : `: ${cell.caption}`}</summary>`,
      `  <p align="center">${fullWidth(cell)}</p>`,
      '</details>',
    ]),
  list: cells =>
    cells.flatMap(cell => ['<p align="center">', `  ${fullWidth(cell)}`, `  <br /><sub>${cell.caption}</sub>`, '</p>']),
};
