#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { capture } from './capture.js';
import { loadConfig } from './config/load.js';
import type { ResolvedConfig } from './config/types.js';
import { ShowcaseError } from './errors.js';
import { frame } from './frame/index.js';
import { hero } from './hero.js';
import { generateIcons, ICON_PRESETS, type IconPreset } from './icons.js';
import { init } from './init.js';
import { log } from './log.js';
import { exportPortfolio } from './portfolio.js';
import { readmeSnippet } from './readme.js';

const HELP = `showcase: capture, frame and export showcase images of your app

Usage: showcase <command> [options]

Commands:
  capture     Screenshot every shot in every language (raw PNGs)
  frame       Turn raw captures into framed README images
  portfolio   Export fixed-size portfolio images, thumbnail and gallery JSON
  readme      Print an HTML table of the framed images for a README
  all         capture, then frame, then portfolio (if configured)
  hero        Render a README banner: logo, name, tagline and stacked shots
  icons       Generate an app icon set from one square image (no config needed)
  init        Write a starter showcase.config.mjs

Options:
  -c, --config <file>   Config file (default: showcase.config.{ts,mts,mjs,js} in the
                        current directory or a parent, up to the project root)
      --only <ids>      Comma-separated shot ids (capture, frame, portfolio, readme, all)
      --langs <codes>   Comma-separated languages (capture, frame, all)
      --lang <code>     Language for readme (default: the first in langs)
      --cols <n>        Images per row for readme (default 2)
      --base <dir>      Directory the README is in, for relative image paths (readme)
      --source <png>    Square source image, 1024px or larger (icons)
      --preset <name>   web, electron or tauri (icons)
      --out <dir>       Output directory (icons, default: icons)
      --ts              Write showcase.config.ts instead (init)
      --force           Overwrite an existing config (init)
      --verbose         Show the start command's output and debug detail
      --quiet           Only print warnings and errors
  -h, --help            Show this help
  -v, --version         Show the version

Needs Playwright with Chromium: \`npx playwright install chromium\`.`;

function list(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      only: { type: 'string' },
      langs: { type: 'string' },
      lang: { type: 'string' },
      cols: { type: 'string' },
      base: { type: 'string' },
      source: { type: 'string' },
      preset: { type: 'string' },
      out: { type: 'string' },
      ts: { type: 'boolean' },
      force: { type: 'boolean' },
      verbose: { type: 'boolean' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.version) {
    console.log(version());
    return;
  }
  const [command, ...extra] = positionals;
  if (values.help || !command || command === 'help') {
    console.log(HELP);
    return;
  }
  if (extra.length > 0) throw new ShowcaseError(`Unexpected argument(s): ${extra.join(' ')}`);
  log.setVerbose(values.verbose ?? false);
  log.setQuiet(values.quiet ?? false);

  if (command === 'init') {
    const path = init(process.cwd(), { typescript: values.ts, force: values.force });
    log.info(`Wrote ${relative(process.cwd(), path)}. Edit the target and shots, then run \`showcase all\`.`);
    return;
  }

  if (command === 'icons') {
    if (!values.source || !values.preset) {
      throw new ShowcaseError(
        `icons needs --source <png> and --preset <${Object.keys(ICON_PRESETS).join('|')}>`,
      );
    }
    await generateIcons(values.source, values.preset as IconPreset, values.out ?? 'icons');
    return;
  }

  const commands: Record<string, (config: ResolvedConfig) => Promise<void>> = {
    capture: async config => {
      await capture(config, { only: list(values.only), langs: list(values.langs) });
    },
    frame: async config => {
      await frame(config, { only: list(values.only), langs: list(values.langs) });
    },
    portfolio: async config => {
      await exportPortfolio(config, { only: list(values.only) });
    },
    hero: async config => {
      await hero(config);
    },
    readme: async config => {
      const cols = values.cols === undefined ? undefined : Number(values.cols);
      console.log(readmeSnippet(config, { lang: values.lang, cols, base: values.base, only: list(values.only) }));
    },
    all: async config => {
      const only = list(values.only);
      log.info('Capturing');
      await capture(config, { only, langs: list(values.langs) });
      await frame(config, { only, langs: list(values.langs) });
      if (config.outputs.portfolio) {
        await exportPortfolio(config, { only });
      } else {
        log.info('No outputs.portfolio configured, skipping the portfolio export.');
      }
    },
  };
  const run = commands[command];
  if (!run) throw new ShowcaseError(`Unknown command "${command}". Run \`showcase --help\` for the list.`);
  const config = await loadConfig(values.config);
  await run(config);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof ShowcaseError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
    log.error(`showcase: ${(error as Error).message}`);
  } else {
    log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  process.exitCode = 1;
});
