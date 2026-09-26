/**
 * Post-build check of dist/ (see scripts/checks.ts for what and why):
 *
 * 1. Every route in the page map was emitted.
 * 2. The contract anchors on the reference pages exist.
 * 3. Every root-relative href/src/srcset sits under the deploy base and
 *    resolves to an emitted file; relative internal links fail.
 * 4. Every internal link with a #fragment, same-page or cross-page, points at
 *    an id that exists on the target page.
 * 5. No page contains the stub marker, unless ALLOW_STUBS=1 (lane builds
 *    only; CI never sets it).
 */
import { checkBuild } from './checks';
import { CONTRACT_ANCHORS, DIST_DIR, PAGE_ROUTES, SITE_BASE, STUB_MARKER } from './site';

const allowStubs = process.env.ALLOW_STUBS === '1';
const result = checkBuild(DIST_DIR, {
  base: SITE_BASE,
  routes: PAGE_ROUTES,
  anchors: CONTRACT_ANCHORS,
  stubMarker: STUB_MARKER,
  allowStubs,
});

console.log(
  `check-build: ${result.pages} HTML pages, ${result.routes} page-map routes, ${result.anchors} contract anchors, ` +
    `${result.links} internal links and ${result.fragments} fragments checked, ${result.stubPages.length} stub pages` +
    (allowStubs && result.stubPages.length > 0 ? ' (allowed by ALLOW_STUBS=1)' : ''),
);
if (result.failures.length > 0) {
  console.error(`check-build: ${result.failures.length} failure(s)\n  ${result.failures.join('\n  ')}`);
  process.exit(1);
}
