/**
 * Everything the changelog page, the feed and the post-build check need,
 * read from the repo once: the parsed CHANGELOG.md, a date per release and
 * the pending changesets.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../site';
import { gitIn, releaseDates, type Git, type ReleaseDate } from './dates';
import { parseChangelog, type Release } from './parse';
import { readPendingChangesets, type PendingChangeset } from './pending';

/** Entries by this GitHub user are not thanked on the site: it is the maintainer's own work. */
export const MAINTAINER = 'Shironex';

export interface DatedRelease extends Release {
  date: ReleaseDate;
}

export interface ChangelogModel {
  packageName: string;
  /** `owner/name` on GitHub. */
  repo: string;
  maintainer: string;
  /** Newest first. */
  releases: DatedRelease[];
  pending: PendingChangeset[];
}

/** `owner/name` from a package.json `repository` field. */
export function githubRepo(repository: unknown): string {
  const url = typeof repository === 'string' ? repository : (repository as { url?: unknown } | undefined)?.url;
  const match = typeof url === 'string' ? /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(url) : null;
  if (!match) throw new Error(`package.json: cannot read a GitHub repository from ${JSON.stringify(repository)}`);
  return match[1]!;
}

export interface LoadOptions {
  repoRoot?: string;
  git?: Git;
}

export function loadChangelog(options: LoadOptions = {}): ChangelogModel {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { name: string; repository?: unknown };
  const parsed = parseChangelog(readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8'));
  if (parsed.title !== pkg.name) {
    throw new Error(`CHANGELOG.md is titled ${JSON.stringify(parsed.title)} but package.json names ${JSON.stringify(pkg.name)}`);
  }
  const dates = releaseDates(
    parsed.releases.map((r) => r.version),
    { git: options.git ?? gitIn(repoRoot), packageName: pkg.name, changelogPath: 'CHANGELOG.md' },
  );
  return {
    packageName: pkg.name,
    repo: githubRepo(pkg.repository),
    maintainer: MAINTAINER,
    releases: parsed.releases.map((release) => ({ ...release, date: dates.get(release.version)! })),
    pending: readPendingChangesets(join(repoRoot, '.changeset'), pkg.name),
  };
}
