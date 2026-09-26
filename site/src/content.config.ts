import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// src/content/docs/changelog.md is written by scripts/sync.ts from the root
// CHANGELOG.md and is gitignored; everything else is authored.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
