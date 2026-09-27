import { satteri } from '@astrojs/markdown-satteri';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// Project Pages for github.com/noctcore/showcase-kit serve from
// https://noctcore.github.io/showcase-kit/. A wrong `base` still builds green
// and 404s every asset, which is why scripts/check-build.ts reads the emitted
// HTML rather than trusting the exit code.
//
// This site runs no remark plugins: the generated pages (changelog, reference)
// are shaped by scripts/sync.ts before Astro sees them.
export default defineConfig({
  site: 'https://noctcore.github.io',
  base: '/showcase-kit',
  trailingSlash: 'always',
  markdown: {
    // Astro 7's default processor, plus heading attributes (`## 0.2.0 {#v0.2.0}`)
    // so the generated changelog gets readable, collision-free version anchors.
    // Without them `## 0.2.0` slugs to `#020`, and 0.1.10 and 0.11.0 would both
    // slug to `#0110`. Starlight still adds its asides and heading links on top.
    processor: satteri({ features: { headingAttributes: true } }),
  },
  integrations: [
    starlight({
      title: 'showcase-kit',
      description:
        'Capture, frame and export showcase images of desktop and web apps for READMEs and portfolios.',
      favicon: '/favicon.svg',
      logo: { src: './src/assets/mark.svg', alt: '' },
      customCss: ['./src/styles/theme.css'],
      components: {
        Head: './src/components/Head.astro',
        Footer: './src/components/Footer.astro',
        SiteTitle: './src/components/SiteTitle.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/noctcore/showcase-kit' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/@noctcore/showcase-kit' },
      ],
      // The generated changelog page carries its own editUrl (the root
      // CHANGELOG.md); this base covers the hand-written pages under site/.
      editLink: { baseUrl: 'https://github.com/noctcore/showcase-kit/edit/main/site/' },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Getting started', link: '/getting-started/' },
            { label: 'Gallery', link: '/gallery/' },
          ],
        },
        {
          label: 'Capture',
          items: [
            { label: 'Web apps', link: '/guides/web-apps/' },
            { label: 'Electron', link: '/guides/electron/' },
            { label: 'Tauri', link: '/guides/tauri/' },
            { label: 'Terminal apps', link: '/guides/terminal-apps/' },
            { label: 'Terminal determinism', link: '/guides/terminal-determinism/' },
            { label: 'Clips', link: '/guides/clips/' },
          ],
        },
        {
          label: 'Output',
          items: [
            { label: 'Frames', link: '/guides/frames/' },
            { label: 'README table', link: '/guides/readme-table/' },
            { label: 'Portfolio', link: '/guides/portfolio/' },
            { label: 'Hero banner', link: '/guides/hero/' },
            { label: 'Icons', link: '/guides/icons/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Config', link: '/reference/config/' },
            { label: 'CLI', link: '/reference/cli/' },
            { label: 'Programmatic API', link: '/reference/api/' },
          ],
        },
        { label: 'Changelog', link: '/changelog/' },
      ],
    }),
  ],
});
