/**
 * Emits dist/changelog.xml: an Atom feed with one entry per release. The
 * entries are rendered by scripts/sync.ts (scripts/changelog/feed.ts) into
 * src/generated/changelog-feed.json; this only serialises them.
 */
import type { APIRoute } from 'astro';

import { renderAtomFeed } from '../../scripts/changelog/feed';
import feed from '../generated/changelog-feed.json';

export const GET: APIRoute = () =>
  new Response(renderAtomFeed(feed), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
