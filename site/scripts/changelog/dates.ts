/**
 * Release dates from git, offline and deterministic.
 *
 * A version's date is when its tag was created (the tagger date of an
 * annotated tag, the commit date of a lightweight one). The repo uses two tag
 * formats: `@noctcore/showcase-kit@0.1.0` (annotated, the first release was
 * published by hand) and `v0.1.1` (lightweight, what changesets writes for a
 * single-package repo). Without a tag, the date is that of the commit that
 * first added the version's `## <version>` heading to CHANGELOG.md.
 *
 * A version with neither is an error, never an undated section.
 */
import { execFileSync } from 'node:child_process';

/** Runs git with an argument array (no shell) and returns stdout. */
export type Git = (args: readonly string[]) => string;

export function gitIn(cwd: string): Git {
  return (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export interface ReleaseDate {
  /** UTC timestamp without milliseconds: `2026-09-26T21:49:07Z`. */
  timestamp: string;
  /** The UTC calendar day: `2026-09-26`. */
  day: string;
  /** The tag the date came from, or undefined when it came from CHANGELOG.md's history. */
  tag?: string;
}

/** The tag names a version may have been released under, in order of preference. */
export function tagCandidates(version: string, packageName: string): string[] {
  return [`v${version}`, `${packageName}@${version}`];
}

function utc(isoWithOffset: string): Pick<ReleaseDate, 'timestamp' | 'day'> {
  const date = new Date(isoWithOffset);
  if (Number.isNaN(date.getTime())) throw new Error(`git printed a date that does not parse: ${JSON.stringify(isoWithOffset)}`);
  const timestamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { timestamp, day: timestamp.slice(0, 10) };
}

/** Every tag with its creation date (`creatordate`: tagger date if annotated, else commit date). */
export function listTags(git: Git): Map<string, string> {
  const out = git(['for-each-ref', 'refs/tags', '--format=%(refname:strip=2)%09%(creatordate:iso-strict)']);
  const tags = new Map<string, string>();
  for (const line of out.split('\n')) {
    if (line === '') continue;
    const tab = line.lastIndexOf('\t');
    tags.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return tags;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface DateOptions {
  git: Git;
  packageName: string;
  /** CHANGELOG.md relative to the git working directory. */
  changelogPath: string;
}

/**
 * Date every version. Throws on a shallow clone (tags and old commits are
 * missing there, so a date could be wrong rather than absent) and on a version
 * nothing dates, naming the versions and how to fix it.
 */
export function releaseDates(versions: readonly string[], options: DateOptions): Map<string, ReleaseDate> {
  const { git, packageName, changelogPath } = options;
  const dates = new Map<string, ReleaseDate>();
  if (versions.length === 0) return dates;

  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error(
      `Cannot date ${versions.join(', ')}: this is a shallow clone, so tags and the commits that added ` +
        `each version to ${changelogPath} may be missing. Fetch the full history and the tags ` +
        '(`git fetch --unshallow --tags`; in GitHub Actions, actions/checkout with `fetch-depth: 0`).',
    );
  }

  const tags = listTags(git);
  const undated: string[] = [];
  for (const version of versions) {
    const tag = tagCandidates(version, packageName).find((name) => tags.has(name));
    if (tag) {
      dates.set(version, { ...utc(tags.get(tag)!), tag });
      continue;
    }
    // Oldest commit whose diff adds or removes the heading line: the one that added it.
    const heading = `^## ${escapeRegex(version)}$`;
    const log = git(['log', '--reverse', '--format=%cI', '-G', heading, '--', changelogPath]);
    const first = log.split('\n').find((line) => line !== '');
    if (first) dates.set(version, utc(first));
    else undated.push(version);
  }

  if (undated.length > 0) {
    throw new Error(
      `No release date for ${undated.join(', ')}: no tag (${undated
        .map((v) => tagCandidates(v, packageName).join(' or '))
        .join('; ')}) and no commit that adds the "## <version>" heading to ${changelogPath}. ` +
        'Fetch the tags and full history (`git fetch --unshallow --tags`), tag the release, or commit the CHANGELOG entry.',
    );
  }
  return dates;
}
