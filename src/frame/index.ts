import { launchBrowser } from '../browser.js';
import type { ResolvedConfig } from '../config/types.js';
import { ShowcaseError } from '../errors.js';
import { log } from '../log.js';
import { outputPath, select } from '../paths.js';
import { formatOf, frameTitle, logWritten, readRaw, renderFrame, writeImage } from './render.js';
import { readmeLayout } from './template.js';

export interface FrameRunOptions {
  only?: string[];
  langs?: string[];
}

export interface FramedFile {
  lang: string;
  id: string;
  path: string;
  width: number;
  height: number;
}

/** Turn raw captures into framed README images at `outputs.readme`. */
export async function frame(config: ResolvedConfig, options: FrameRunOptions = {}): Promise<FramedFile[]> {
  const { shots, langs } = select(config, options.only, options.langs);
  const format = formatOf(config.outputs.readme);
  // Read everything first: a missing capture should fail before a browser starts.
  const jobs = [];
  for (const lang of langs) {
    for (const shot of shots) jobs.push({ lang, shot, raw: await readRaw(config, lang, shot) });
  }

  const browser = await launchBrowser(config);
  const files: FramedFile[] = [];
  try {
    log.info(`Framing ${String(jobs.length)} image(s)`);
    for (const { lang, shot, raw } of jobs) {
      const layout = readmeLayout(config.frame, { width: raw.cssWidth, height: raw.cssHeight });
      const png = await renderFrame(browser, config, {
        raw,
        layout,
        title: frameTitle(config, shot, lang),
        deviceScaleFactor: config.deviceScaleFactor,
      });
      const path = outputPath(config, config.outputs.readme, lang, shot.id);
      const size = await writeImage(png, path, {
        format,
        quality: config.frame.quality,
        maxWidth: config.frame.maxWidth,
      });
      files.push({ lang, id: shot.id, path, ...size });
      logWritten(`${lang}/${shot.id}`, path, size);
    }
  } finally {
    await browser.close();
  }
  if (files.length === 0) throw new ShowcaseError('Nothing to frame.');
  return files;
}
