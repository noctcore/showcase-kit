/**
 * Post-build check of the changelog page and the feed, called from
 * scripts/check-build.ts. It reads what was emitted, not what sync meant to
 * write:
 *
 * 1. /changelog/ has exactly one section per released version, each with a
 *    release date, and no id twice.
 * 2. Every GitHub tag or compare link on it names a tag that exists in git.
 * 3. /changelog.xml exists, is well-formed XML, is an Atom feed and has one
 *    complete entry per released version, linking to that version's section.
 * 4. No emitted page has an empty id: `{...}` at the end of a Markdown heading
 *    is read as heading attributes (astro.config.mjs), and `{not an id}`
 *    would leave `id=""` behind.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { attributesOf } from '../checks';
import { DIST_DIR, REPO_ROOT, SITE_BASE } from '../site';
import { gitIn, listTags } from './dates';
import { parseChangelog } from './parse';
import { FEED_PATH, versionId } from './page';
import { xmlProblems } from './xml';

export interface ChangelogCheckInput {
  base: string;
  /** Released versions, newest first. */
  versions: readonly string[];
  /** Every tag in the repo. */
  tags: ReadonlySet<string>;
}

export interface ChangelogCheckResult {
  failures: string[];
  sections: number;
  tagLinks: number;
  feedEntries: number;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return path.endsWith('.html') ? [path] : [];
  });
}

const TAG_LINK = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:releases\/tag\/([^#?]+)|compare\/([^#?]+?)\.\.\.([^#?]+))/;
const DATE = /<time datetime="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z">\d{4}-\d{2}-\d{2}<\/time>/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function checkChangelogDist(dist: string, input: ChangelogCheckInput): ChangelogCheckResult {
  const result: ChangelogCheckResult = { failures: [], sections: 0, tagLinks: 0, feedEntries: 0 };
  const fail = (message: string) => result.failures.push(message);
  const pageRoute = `${input.base}/changelog/`;
  const page = join(dist, 'changelog', 'index.html');

  let ids = new Set<string>();
  if (!existsSync(page)) {
    fail(`no changelog page emitted at ${pageRoute}`);
  } else {
    const html = readFileSync(page, 'utf8');
    const attributes = attributesOf(html);
    const allIds = attributes.flatMap(([name, value]) => (name === 'id' ? [value] : []));
    ids = new Set(allIds);
    for (const id of new Set(allIds.filter((id, i) => allIds.indexOf(id) !== i))) {
      fail(`${pageRoute}: the id "${id}" appears more than once`);
    }

    // (1) One dated section per released version, and none for anything else.
    const headings = [...html.matchAll(/<h2 id="(v[^"]*)"/g)];
    const known = new Set(input.versions.map(versionId));
    for (const heading of headings) {
      if (!known.has(heading[1]!)) fail(`${pageRoute}: a section #${heading[1]!} for a version CHANGELOG.md does not list`);
    }
    for (const version of input.versions) {
      const id = versionId(version);
      const at = headings.find((h) => h[1] === id);
      if (!at) {
        fail(`${pageRoute}: no section #${id} for ${version}`);
        continue;
      }
      result.sections++;
      const start = at.index;
      const next = html.indexOf('<h2 ', start + 1);
      if (!DATE.test(html.slice(start, next === -1 ? undefined : next))) {
        fail(`${pageRoute}: the ${version} section has no release date`);
      }
    }

    // (2) Tag and compare links name tags that exist.
    for (const [name, href] of attributes) {
      const match = name === 'href' ? TAG_LINK.exec(href) : null;
      for (const encoded of match?.slice(1) ?? []) {
        if (encoded === undefined) continue;
        result.tagLinks++;
        let tag: string;
        try {
          tag = decodeURIComponent(encoded);
        } catch {
          tag = encoded;
        }
        if (!input.tags.has(tag)) fail(`${pageRoute}: ${href} names the tag "${tag}", which does not exist`);
      }
    }
  }

  // (3) The feed.
  const feedFile = join(dist, FEED_PATH);
  if (!existsSync(feedFile)) {
    fail(`no feed emitted at ${input.base}/${FEED_PATH}`);
  } else {
    const xml = readFileSync(feedFile, 'utf8');
    const problems = xmlProblems(xml);
    for (const problem of problems) fail(`${input.base}/${FEED_PATH} is not well-formed XML: ${problem}`);
    if (problems.length === 0) {
      if (!/<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(xml)) fail(`${input.base}/${FEED_PATH} is not an Atom feed`);
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]!);
      result.feedEntries = entries.length;
      if (entries.length !== input.versions.length) {
        fail(`${input.base}/${FEED_PATH} has ${String(entries.length)} entries for ${String(input.versions.length)} releases`);
      }
      entries.forEach((entry, index) => {
        const where = `${input.base}/${FEED_PATH} entry ${String(index + 1)}`;
        for (const element of ['id', 'title', 'updated']) {
          if (!new RegExp(`<${element}>[^<]+</${element}>`).test(entry)) fail(`${where} has no <${element}>`);
        }
        const updated = /<updated>([^<]*)<\/updated>/.exec(entry)?.[1];
        if (updated !== undefined && !TIMESTAMP.test(updated)) fail(`${where}: <updated> ${updated} is not a UTC timestamp`);
        if (!/<content type="html">[^<]+<\/content>/.test(entry)) fail(`${where} has no HTML content`);
        const href = /<link rel="alternate" type="text\/html" href="([^"]*)"\/>/.exec(entry)?.[1];
        const fragment = href ? decodeEntities(href).split('#')[1] : undefined;
        const expected = input.versions[index] === undefined ? undefined : versionId(input.versions[index]!);
        if (fragment === undefined || fragment !== expected || !ids.has(fragment)) {
          fail(`${where} should link to ${pageRoute}#${expected ?? '?'}, got ${href ?? 'no link'}`);
        }
      });
    }
  }

  // (4) No empty ids anywhere.
  if (existsSync(dist)) {
    for (const file of htmlFiles(dist)) {
      if (attributesOf(readFileSync(file, 'utf8')).some(([name, value]) => name === 'id' && value === '')) {
        fail(`${input.base}/${relative(dist, file).split(sep).join('/')} has an empty id (a Markdown heading ending in {...}?)`);
      }
    }
  }
  return result;
}

/** The check against the real repo and dist/, for check-build.ts: prints a summary and returns the failures. */
export function checkChangelog(dist: string = DIST_DIR): string[] {
  const versions = parseChangelog(readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')).releases.map((r) => r.version);
  const tags = new Set(listTags(gitIn(REPO_ROOT)).keys());
  const result = checkChangelogDist(dist, { base: SITE_BASE, versions, tags });
  console.log(
    `check-build: changelog: ${String(result.sections)} dated release sections, ${String(result.tagLinks)} tag links ` +
      `and ${String(result.feedEntries)} feed entries checked`,
  );
  return result.failures;
}
