import { existsSync } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { launchBrowser } from './browser.js';
import type { ResolvedConfig, ResolvedPortfolio } from './config/types.js';
import { ShowcaseError } from './errors.js';
import { frameTitle, logWritten, readRaw, renderFrame, writeImage } from './frame/render.js';
import { containLayout } from './frame/template.js';
import { log } from './log.js';
import { select } from './paths.js';
import { fillTemplate } from './template.js';

/** Matches the portfolio's `GalleryItem` type. */
export interface GalleryItem {
  src: string;
  alt: string;
  caption: string;
}

export interface PortfolioResult {
  dir: string;
  files: string[];
  thumbnail: string | undefined;
  gallery: GalleryItem[];
  galleryFile: string;
}

export const GALLERY_FILE = 'showcase.gallery.json';

export function portfolioSettings(config: ResolvedConfig): ResolvedPortfolio {
  const portfolio = config.outputs.portfolio;
  if (!portfolio) {
    throw new ShowcaseError(
      'No portfolio output configured. Add outputs.portfolio: { dir: "../portfolio/public/projects/{slug}" } to the config.',
    );
  }
  return portfolio;
}

/**
 * Export 16:9 (or any `size`) portfolio images: the framed window contained on the background at exactly
 * `size` pixels, a thumbnail copy, and a gallery JSON the portfolio can import.
 */
export async function exportPortfolio(config: ResolvedConfig, options: { only?: string[] } = {}): Promise<PortfolioResult> {
  const portfolio = portfolioSettings(config);
  const { shots } = select(config, options.only);
  const lang = portfolio.lang;
  const dir = resolve(config.root, fillTemplate(portfolio.dir, { slug: config.slug }));
  const publicPath = fillTemplate(portfolio.publicPath, { slug: config.slug });
  const [width, height] = portfolio.size;
  const extension = portfolio.format;

  const jobs = [];
  for (const shot of shots) jobs.push({ shot, raw: await readRaw(config, lang, shot) });

  const browser = await launchBrowser(config);
  const files: string[] = [];
  try {
    log.info(`Exporting ${String(jobs.length)} portfolio image(s) (${String(width)}x${String(height)}, ${lang})`);
    for (const { shot, raw } of jobs) {
      const layout = containLayout(
        config.frame,
        { width: raw.cssWidth, height: raw.cssHeight },
        { width, height },
        portfolio.padding,
      );
      const png = await renderFrame(browser, config, {
        raw,
        layout,
        title: frameTitle(config, shot, lang),
        deviceScaleFactor: 1,
      });
      const path = join(dir, `${shot.id}.${extension}`);
      const size = await writeImage(png, path, { format: portfolio.format, quality: portfolio.quality });
      if (size.width !== width || size.height !== height) {
        throw new ShowcaseError(
          `Portfolio image ${path} came out ${String(size.width)}x${String(size.height)}, expected ${String(width)}x${String(height)}.`,
        );
      }
      files.push(path);
      logWritten(shot.id, path, size);
    }
  } finally {
    await browser.close();
  }

  let thumbnail: string | undefined;
  const thumbnailSource = join(dir, `${portfolio.thumbnail}.${extension}`);
  if (existsSync(thumbnailSource)) {
    thumbnail = join(dir, `thumbnail.${extension}`);
    await copyFile(thumbnailSource, thumbnail);
    logWritten(`thumbnail (${portfolio.thumbnail})`, thumbnail, { width, height });
  }

  // Config order, and only images that exist: an --only run keeps earlier exports and never lists a missing file.
  const gallery: GalleryItem[] = config.shots
    .filter(shot => existsSync(join(dir, `${shot.id}.${extension}`)))
    .map(shot => ({
      src: `${publicPath}/${shot.id}.${extension}`,
      alt: shot.alt,
      caption: shot.caption ?? shot.title,
    }));
  const galleryFile = join(dir, GALLERY_FILE);
  await writeFile(galleryFile, `${JSON.stringify(gallery, null, 2)}\n`);
  log.info(`  ok    gallery  ${String(gallery.length)} item(s)  ${relative(process.cwd(), galleryFile)}`);

  return { dir, files, thumbnail, gallery, galleryFile };
}
