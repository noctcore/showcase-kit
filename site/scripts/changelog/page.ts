/**
 * Renders the changelog model as the Markdown of the /changelog/ page.
 *
 * Every version gets an explicit, readable heading id (`## 0.2.0 {#v0.2.0}`,
 * see the markdown block in astro.config.mjs), so a link to a release keeps
 * working however the heading text changes, and 0.1.10 and 0.11.0 can never
 * collide the way their slugs (`0110`) would.
 */
import { SITE_BASE } from '../site';
import { replaceAlerts, toAside, type Alert } from './alerts';
import type { ChangelogModel, DatedRelease } from './model';
import type { BumpType, Entry, Link } from './parse';
import { nextBump, type PendingChangeset } from './pending';

export const GROUP_TITLES: Readonly<Record<BumpType, string>> = {
  major: 'Major changes',
  minor: 'Minor changes',
  patch: 'Patch changes',
};

/** The one-line legend under each group heading. */
export const GROUP_LEGENDS: Readonly<Record<BumpType, string>> = {
  major: 'Breaking changes: read these before you upgrade.',
  minor:
    'New features. Before 1.0 a minor release can also change how existing options work; an entry that needs action from you carries a callout.',
  patch: 'Fixes and small improvements that need no change on your side.',
};

/** The heading id of a release: `v0.2.0`. */
export const versionId = (version: string) => `v${version}`;
export const UNRELEASED_ID = 'unreleased';
/** The feed, relative to the base: src/pages/changelog.xml.ts. */
export const FEED_PATH = 'changelog.xml';

export const npmVersionUrl = (packageName: string, version: string) =>
  `https://www.npmjs.com/package/${packageName}/v/${version}`;
export const tagUrl = (repo: string, tag: string) =>
  `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
export const compareUrl = (repo: string, from: string, to: string) =>
  `https://github.com/${repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;

const link = (text: string, url: string) => `[${text}](${url})`;

/** The first line of an entry: links, thanks for anyone but the maintainer, the summary. */
function entryPrefix(entry: Entry, maintainer: string): string {
  const parts: string[] = [];
  if (entry.pr) parts.push(link(entry.pr.label, entry.pr.url));
  if (entry.commit) parts.push(link(`\`${entry.commit.label}\``, entry.commit.url));
  const thanked = entry.authors.filter((author: Link) => author.label !== maintainer);
  if (thanked.length > 0) parts.push(`Thanks ${thanked.map((a) => link(`@${a.label}`, a.url)).join(', ')}!`);
  return parts.map((part) => `${part} `).join('');
}

/**
 * One entry as a Markdown list item, alerts turned into whatever `alert`
 * renders. Follow-on lines are indented two spaces to stay in the item.
 */
export function entryMarkdown(
  entry: Entry,
  options: { maintainer: string; where: string; alert: (alert: Alert) => string[] },
): string {
  const body = replaceAlerts(entry.body, options.alert, options.where);
  const [first = '', ...rest] = body.split('\n');
  return [`- ${entryPrefix(entry, options.maintainer)}${first}`, ...rest.map((line) => (line === '' ? '' : `  ${line}`))].join(
    '\n',
  );
}

function groupsMarkdown(
  idPrefix: string,
  groups: readonly { type: BumpType; entries: readonly Entry[] }[],
  maintainer: string,
  where: string,
): string[] {
  return groups.flatMap((group) => [
    `### ${GROUP_TITLES[group.type]} {#${idPrefix}-${group.type}}`,
    '',
    GROUP_LEGENDS[group.type],
    '',
    ...group.entries.flatMap((entry) => [entryMarkdown(entry, { maintainer, where, alert: toAside }), '']),
  ]);
}

/** Date, npm, tag and compare links under a version heading. */
function metaLine(model: ChangelogModel, release: DatedRelease, previous: DatedRelease | undefined): string {
  const parts = [
    `Released <time datetime="${release.date.timestamp}">${release.date.day}</time>`,
    link('npm', npmVersionUrl(model.packageName, release.version)),
  ];
  const { tag } = release.date;
  if (tag) {
    parts.push(link(`tag \`${tag}\``, tagUrl(model.repo, tag)));
    const from = previous?.date.tag;
    if (from) parts.push(link(`changes since ${previous.version}`, compareUrl(model.repo, from, tag)));
  } else {
    parts.push('not tagged yet');
  }
  return parts.join(' · ');
}

function unreleasedMarkdown(pending: readonly PendingChangeset[], maintainer: string): string[] {
  const bump = nextBump(pending);
  if (!bump) return [];
  const groups = (['major', 'minor', 'patch'] as const)
    .map((type) => ({
      type,
      entries: pending.filter((c) => c.type === type).map((c): Entry => ({ authors: [], body: c.body })),
    }))
    .filter((group) => group.entries.length > 0);
  return [
    `## Unreleased {#${UNRELEASED_ID}}`,
    '',
    `Merged into \`main\` but not on npm yet. Together these make the next release a **${bump}** one.`,
    '',
    ...groupsMarkdown(UNRELEASED_ID, groups, maintainer, 'Unreleased changeset'),
  ];
}

export function renderChangelogPage(model: ChangelogModel): string {
  const repoUrl = `https://github.com/${model.repo}`;
  const lines = [
    '---',
    'title: Changelog',
    `description: Every release of ${model.packageName}, generated from CHANGELOG.md.`,
    `editUrl: ${repoUrl}/edit/main/CHANGELOG.md`,
    'tableOfContents:',
    '  maxHeadingLevel: 2',
    '---',
    '',
    `Every release of \`${model.packageName}\`, newest first, generated from ${link('`CHANGELOG.md`', `${repoUrl}/blob/main/CHANGELOG.md`)}.`,
    'The kit follows [semantic versioning](https://semver.org/). Until 1.0, a minor release (0.2.0 to 0.3.0) adds',
    'features and can also change how existing options work, while a patch release only fixes. An entry that',
    'needs action from you when you upgrade carries a callout.',
    '',
    `Follow new releases with the ${link('Atom feed', `${SITE_BASE}/${FEED_PATH}`)}, on ${link('GitHub releases', `${repoUrl}/releases`)}`,
    `or in the ${link('npm version list', `https://www.npmjs.com/package/${model.packageName}?activeTab=versions`)}.`,
    '',
    ...unreleasedMarkdown(model.pending, model.maintainer),
  ];
  model.releases.forEach((release, index) => {
    lines.push(
      `## ${release.version} {#${versionId(release.version)}}`,
      '',
      metaLine(model, release, model.releases[index + 1]),
      '',
      ...groupsMarkdown(versionId(release.version), release.groups, model.maintainer, `CHANGELOG.md ${release.version}`),
    );
  });
  return `${lines.join('\n').trimEnd()}\n`;
}
