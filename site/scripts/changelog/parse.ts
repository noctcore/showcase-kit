/**
 * Parses the root CHANGELOG.md as changesets writes it with
 * @changesets/changelog-github:
 *
 *   # @noctcore/showcase-kit
 *   ## 0.2.0
 *   ### Minor Changes
 *   - [#12](pr) [`33abe38`](commit) Thanks [@user](profile)! - Summary line
 *     Follow-on paragraphs, indented two spaces.
 *
 * Every link and the author are optional (a hand-written entry has none). An
 * entry may be followed by an unindented GitHub alert (see alerts.ts). A
 * line the parser does not expect throws with its line number instead of
 * being dropped, so the page can never silently lose part of a release.
 */

export type BumpType = 'major' | 'minor' | 'patch';

export const BUMP_TYPES: readonly BumpType[] = ['major', 'minor', 'patch'];

export interface Link {
  /** The link text without its brackets or backticks: `#12`, `33abe38`, `@user`. */
  label: string;
  url: string;
}

export interface Entry {
  pr?: Link;
  commit?: Link;
  /** Everyone thanked, in order. Empty for an entry without "Thanks". */
  authors: Link[];
  /** The summary as Markdown: first line plus follow-on lines, dedented. */
  body: string;
}

export interface Group {
  type: BumpType;
  entries: Entry[];
}

export interface Release {
  version: string;
  /** In CHANGELOG order (changesets writes Major, Minor, Patch). */
  groups: Group[];
}

export interface ParsedChangelog {
  /** The `#` heading: the package name. */
  title: string;
  /** Newest first, as in the file. */
  releases: Release[];
}

const GROUP_HEADINGS: Record<string, BumpType> = {
  'Major Changes': 'major',
  'Minor Changes': 'minor',
  'Patch Changes': 'patch',
};

// A semver version: 1.2.3, optionally with a prerelease and build suffix.
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const PR = /^\[#(\d+)\]\(([^)\s]+)\) /;
const COMMIT = /^\[`([0-9a-f]{7,40})`\]\(([^)\s]+)\) /;
const THANKS = /^Thanks ((?:\[@[^\]]+\]\([^)\s]+\)(?:, )?)+)! - /;
const AUTHOR = /\[@([^\]]+)\]\(([^)\s]+)\)/g;
/** The first line of a GitHub alert (the type is checked when it is rendered). */
const ALERT_MARKER = /^>[ \t]*\[![A-Za-z]+\]/;

/** Split an entry's first line into its links, its authors and the summary. */
export function parseEntryLine(line: string): Omit<Entry, 'body'> & { summary: string } {
  let rest = line;
  const entry: Omit<Entry, 'body'> & { summary: string } = { authors: [], summary: '' };
  let prefixed = false;

  const pr = PR.exec(rest);
  if (pr) {
    entry.pr = { label: `#${pr[1]!}`, url: pr[2]! };
    rest = rest.slice(pr[0].length);
    prefixed = true;
  }
  const commit = COMMIT.exec(rest);
  if (commit) {
    entry.commit = { label: commit[1]!, url: commit[2]! };
    rest = rest.slice(commit[0].length);
    prefixed = true;
  }
  const thanks = THANKS.exec(rest);
  if (thanks) {
    entry.authors = [...thanks[1]!.matchAll(AUTHOR)].map((m) => ({ label: m[1]!, url: m[2]! }));
    rest = rest.slice(thanks[0].length);
  } else if (prefixed && rest.startsWith('- ')) {
    // Links but no author: changelog-github still separates them with " - ".
    rest = rest.slice(2);
  }
  entry.summary = rest;
  return entry;
}

export function parseChangelog(text: string, file = 'CHANGELOG.md'): ParsedChangelog {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const result: ParsedChangelog = { title: '', releases: [] };
  let release: Release | undefined;
  let group: Group | undefined;
  /** The entry being read and its raw lines. */
  let open: { entry: Entry; lines: string[] } | undefined;
  /** Inside an unindented alert block that follows an entry. */
  let inAlert = false;

  const fail = (index: number, message: string): never => {
    throw new Error(`${file}:${String(index + 1)}: ${message}: ${JSON.stringify(lines[index])}`);
  };
  const close = () => {
    inAlert = false;
    if (!open) return;
    while (open.lines.length > 0 && open.lines.at(-1) === '') open.lines.pop();
    open.entry.body = open.lines.join('\n');
    open = undefined;
  };

  lines.forEach((line, index) => {
    if (line.startsWith('# ')) {
      if (result.title !== '' || release) fail(index, 'a second "#" heading');
      result.title = line.slice(2).trim();
      return;
    }
    if (line.startsWith('## ')) {
      close();
      const version = line.slice(3).trim();
      if (!VERSION.test(version)) fail(index, 'a "##" heading that is not a version');
      if (result.releases.some((r) => r.version === version)) fail(index, `version ${version} appears twice`);
      release = { version, groups: [] };
      group = undefined;
      result.releases.push(release);
      return;
    }
    if (line.startsWith('### ')) {
      close();
      const type = GROUP_HEADINGS[line.slice(4).trim()];
      if (!release) fail(index, 'a group heading before any version');
      if (!type) fail(index, 'an unknown group (expected Major Changes, Minor Changes or Patch Changes)');
      group = { type: type!, entries: [] };
      release!.groups.push(group);
      return;
    }
    if (line.startsWith('- ')) {
      close();
      if (!group) fail(index, 'an entry outside a Major/Minor/Patch Changes group');
      const { summary, ...links } = parseEntryLine(line.slice(2));
      const entry: Entry = { ...links, body: '' };
      group!.entries.push(entry);
      open = { entry, lines: [summary] };
      return;
    }
    if (line.trim() === '') {
      inAlert = false;
      open?.lines.push('');
      return;
    }
    if (open && line.startsWith('  ')) {
      inAlert = false;
      open.lines.push(line.slice(2));
      return;
    }
    // GitHub renders an alert only outside a list, so an alert added to a
    // released entry sits at column 0 right after it and belongs to it.
    if (open && line.startsWith('>') && (inAlert || ALERT_MARKER.test(line))) {
      inAlert = true;
      open.lines.push(line);
      return;
    }
    fail(index, 'an unexpected line (entry text must be indented two spaces; only an alert may follow an entry unindented)');
  });
  close();

  if (result.title === '') throw new Error(`${file}: no "#" heading`);
  for (const r of result.releases) {
    if (r.groups.length === 0) throw new Error(`${file}: ${r.version} has no Major/Minor/Patch Changes group`);
    for (const g of r.groups) {
      if (g.entries.length === 0) throw new Error(`${file}: ${r.version} has an empty ${g.type} group`);
    }
  }
  return result;
}
