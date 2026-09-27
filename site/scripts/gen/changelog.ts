/**
 * Owner: L4 (changelog and feed).
 *
 * Generates src/content/docs/changelog.md from the root CHANGELOG.md, git's
 * release dates and the pending changesets (see scripts/changelog/), plus
 * src/generated/changelog-feed.json, which src/pages/changelog.xml.ts turns
 * into the Atom feed. The page's editUrl points at the root CHANGELOG.md, the
 * file a reader would actually edit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { feedData } from '../changelog/feed';
import { loadChangelog } from '../changelog/model';
import { renderChangelogPage } from '../changelog/page';
import { DOCS_DIR, SITE_DIR } from '../site';

export const CHANGELOG_OUT = join(DOCS_DIR, 'changelog.md');
export const FEED_DATA_OUT = join(SITE_DIR, 'src', 'generated', 'changelog-feed.json');

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export async function generateChangelog(): Promise<void> {
  const model = loadChangelog();
  write(CHANGELOG_OUT, renderChangelogPage(model));
  write(FEED_DATA_OUT, `${JSON.stringify(feedData(model), null, 2)}\n`);
}
