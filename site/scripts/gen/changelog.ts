/**
 * Owner: L4 (changelog and feed).
 *
 * Generates src/content/docs/changelog.md from the root CHANGELOG.md, git's
 * release dates and the pending changesets (see scripts/changelog/). The
 * page's editUrl points at the root CHANGELOG.md, the file a reader would
 * actually edit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadChangelog } from '../changelog/model';
import { renderChangelogPage } from '../changelog/page';
import { DOCS_DIR } from '../site';

export const CHANGELOG_OUT = join(DOCS_DIR, 'changelog.md');

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export async function generateChangelog(): Promise<void> {
  const model = loadChangelog();
  write(CHANGELOG_OUT, renderChangelogPage(model));
}
