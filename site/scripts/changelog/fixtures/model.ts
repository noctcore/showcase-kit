/** A changelog model from the fixtures, with fixed dates: 1.0.0 tagged v1.0.0, 0.9.0 tagged in the scoped format. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ChangelogModel } from '../model';
import { parseChangelog } from '../parse';
import { readPendingChangesets, type PendingChangeset } from '../pending';

export function fixtureModel(options: { pending?: boolean } = {}): ChangelogModel {
  const parsed = parseChangelog(readFileSync(join(import.meta.dir, 'CHANGELOG.md'), 'utf8'));
  const dates = {
    '1.0.0': { timestamp: '2026-03-02T08:00:00Z', day: '2026-03-02', tag: 'v1.0.0' },
    '0.9.0': { timestamp: '2026-02-01T23:59:59Z', day: '2026-02-01', tag: '@scope/pkg@0.9.0' },
  } as const;
  const pending: PendingChangeset[] = options.pending ? readPendingChangesets(join(import.meta.dir, 'pending'), '@scope/pkg') : [];
  return {
    packageName: '@scope/pkg',
    repo: 'o/r',
    maintainer: 'maint',
    releases: parsed.releases.map((release) => ({ ...release, date: { ...dates[release.version as keyof typeof dates] } })),
    pending,
  };
}
