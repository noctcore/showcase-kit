/**
 * Owner: L4 (changelog and feed).
 *
 * Generates src/content/docs/changelog.md from the root CHANGELOG.md. For now
 * it writes a stub page so the route, the sidebar link and the version pill
 * resolve. The page's editUrl points at the root CHANGELOG.md, the file a
 * reader would actually edit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DOCS_DIR, STUB_MARKER } from '../site';

export const CHANGELOG_OUT = join(DOCS_DIR, 'changelog.md');

export async function generateChangelog(): Promise<void> {
  mkdirSync(dirname(CHANGELOG_OUT), { recursive: true });
  writeFileSync(
    CHANGELOG_OUT,
    [
      '---',
      'title: Changelog',
      'description: Every release of @noctcore/showcase-kit, generated from CHANGELOG.md.',
      'editUrl: https://github.com/noctcore/showcase-kit/edit/main/CHANGELOG.md',
      '---',
      '',
      `${STUB_MARKER}: this page will hold every release from CHANGELOG.md, with dates, links and an Atom feed.`,
      '',
    ].join('\n'),
  );
}
