/**
 * Prebuild sync: writes the generated pages before Astro sees the content
 * collection. Each generator owns its output, lands it in a gitignored path
 * and rebuilds it from scratch every run.
 */
import { generateChangelog } from './gen/changelog';
import { generateReference } from './gen/reference';

await generateChangelog();
await generateReference();
