/**
 * Pending changesets: the `.changeset/*.md` files merged but not yet released.
 * Each one is YAML frontmatter mapping package names to a bump type, then the
 * summary that `changeset version` will copy into CHANGELOG.md:
 *
 *   ---
 *   "@noctcore/showcase-kit": minor
 *   ---
 *
 *   Summary line.
 *
 * `.changeset/README.md` is not a changeset (changesets skips it too).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BUMP_TYPES, type BumpType } from './parse';

export interface PendingChangeset {
  /** The file name without `.md`, for example `brave-lions-dance`. */
  id: string;
  type: BumpType;
  /** The summary as Markdown. */
  body: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/;
const RELEASE_LINE = /^\s*(["']?)(.+?)\1\s*:\s*(\S+)\s*$/;

/** Parse one changeset; undefined when it does not bump `packageName`. */
export function parseChangeset(id: string, text: string, packageName: string): PendingChangeset | undefined {
  const match = FRONTMATTER.exec(text.replace(/\r\n?/g, '\n'));
  if (!match) throw new Error(`.changeset/${id}.md: no frontmatter (it must start with ---)`);
  let type: BumpType | undefined;
  for (const line of match[1]!.split('\n')) {
    if (line.trim() === '') continue;
    const release = RELEASE_LINE.exec(line);
    if (!release) throw new Error(`.changeset/${id}.md: cannot read the frontmatter line ${JSON.stringify(line)}`);
    const bump = release[3]!;
    if (!(BUMP_TYPES as readonly string[]).includes(bump)) {
      throw new Error(`.changeset/${id}.md: unknown bump type ${JSON.stringify(bump)} (expected major, minor or patch)`);
    }
    if (release[2] === packageName) type = bump as BumpType;
  }
  // An empty changeset (`---\n---`) releases nothing.
  if (!type) return undefined;
  return { id, type, body: match[2]!.trim() };
}

/** Every pending changeset for `packageName` in `dir`, sorted by file name. */
export function readPendingChangesets(dir: string, packageName: string): PendingChangeset[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => parseChangeset(name.slice(0, -3), readFileSync(join(dir, name), 'utf8'), packageName))
    .filter((changeset): changeset is PendingChangeset => changeset !== undefined);
}

/** The bump the pending changesets add up to: the largest of them. */
export function nextBump(changesets: readonly PendingChangeset[]): BumpType | undefined {
  return BUMP_TYPES.find((type) => changesets.some((c) => c.type === type));
}
