/**
 * The Atom 1.0 feed of releases (RFC 4287), one entry per released version.
 *
 * sync renders each release's entries to HTML here (satteri, the Markdown
 * engine Astro itself uses) and writes the result as JSON; the endpoint
 * src/pages/changelog.xml.ts only serialises it with renderAtomFeed, so the
 * feed and the page come from the same read of the repo.
 */
import { markdownToHtml } from 'satteri';

import { SITE_BASE, SITE_ORIGIN } from '../site';
import { toLabelledQuote } from './alerts';
import type { ChangelogModel, DatedRelease } from './model';
import { GROUP_TITLES, entryMarkdown, versionId } from './page';
import { escapeXml } from './xml';

export interface FeedEntry {
  id: string;
  title: string;
  /** RFC 3339 UTC timestamp. */
  updated: string;
  /** The release's section on the changelog page. */
  url: string;
  /** The release's entries as HTML (escaped when serialised). */
  html: string;
}

export interface FeedData {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  /** The changelog page. */
  pageUrl: string;
  /** The feed itself. */
  selfUrl: string;
  /** The newest release's timestamp. */
  updated: string;
  /** Newest first. */
  entries: FeedEntry[];
}

/** A release's groups and entries as HTML, alerts as labelled blockquotes. */
export function releaseHtml(release: DatedRelease, maintainer: string): string {
  const markdown = release.groups
    .flatMap((group) => [
      `### ${GROUP_TITLES[group.type]}`,
      '',
      ...group.entries.map((entry) =>
        entryMarkdown(entry, { maintainer, where: `CHANGELOG.md ${release.version}`, alert: toLabelledQuote }),
      ),
      '',
    ])
    .join('\n');
  return markdownToHtml(markdown, { features: { gfm: true } }).html.trim();
}

export function feedData(model: ChangelogModel): FeedData {
  const pageUrl = `${SITE_ORIGIN}${SITE_BASE}/changelog/`;
  const entries = model.releases.map(
    (release): FeedEntry => ({
      // A tag URI (RFC 4151): stable even if the page's anchors or URL change.
      id: `tag:${new URL(SITE_ORIGIN).host},2026-09-24:${SITE_BASE.slice(1)}/changelog/${release.version}`,
      title: `${model.packageName} ${release.version}`,
      updated: release.date.timestamp,
      url: `${pageUrl}#${versionId(release.version)}`,
      html: releaseHtml(release, model.maintainer),
    }),
  );
  return {
    id: pageUrl,
    title: `${model.packageName} releases`,
    subtitle: `Every release of ${model.packageName}, from its CHANGELOG.md.`,
    author: model.maintainer,
    pageUrl,
    selfUrl: `${SITE_ORIGIN}${SITE_BASE}/changelog.xml`,
    updated: entries[0]?.updated ?? '1970-01-01T00:00:00Z',
    entries,
  };
}

export function renderAtomFeed(feed: FeedData): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(feed.id)}</id>`,
    `  <title>${escapeXml(feed.title)}</title>`,
    `  <subtitle>${escapeXml(feed.subtitle)}</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(feed.selfUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(feed.pageUrl)}"/>`,
    `  <updated>${escapeXml(feed.updated)}</updated>`,
    `  <author><name>${escapeXml(feed.author)}</name></author>`,
    ...feed.entries.flatMap((entry) => [
      '  <entry>',
      `    <id>${escapeXml(entry.id)}</id>`,
      `    <title>${escapeXml(entry.title)}</title>`,
      `    <updated>${escapeXml(entry.updated)}</updated>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(entry.url)}"/>`,
      `    <content type="html">${escapeXml(entry.html)}</content>`,
      '  </entry>',
    ]),
    '</feed>',
  ];
  return `${lines.join('\n')}\n`;
}
