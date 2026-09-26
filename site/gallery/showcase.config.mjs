// The web half of the docs gallery: Nightjar, a static fixture app in app/, served by server.mjs.
// In your own project, wrap the object in `defineConfig` from '@noctcore/showcase-kit' for editor
// completion. This file sits inside the kit's repo, where the package cannot import itself, so it
// exports the plain object (defineConfig only returns what it is given).
export default {
  name: 'Nightjar',
  target: {
    mode: 'url',
    url: 'http://127.0.0.1:47219/',
    start: 'node server.mjs --port 47219',
    // Always start this copy, never a server something else left on the port.
    reuseExisting: false,
    readyTimeoutMs: 20000,
  },
  ready: '#app[data-ready]',
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  // The app reads navigator.language, and each language gets a browser context with that locale.
  langs: ['en', 'pl'],
  shots: [
    {
      id: 'tonight',
      title: 'Tonight',
      caption: 'Plan the night: conditions, targets and a sky chart.',
      alt: "Nightjar's Tonight view: four condition cards, a table of six targets with altitude bars, and a sky chart.",
      nav: '[data-view="tonight"]',
    },
    {
      id: 'log',
      title: 'Log',
      caption: 'Every session, with seeing and notes.',
      alt: "Nightjar's Log view: session totals and a table of eight observations with seeing dots, star ratings and notes.",
      nav: '[data-view="log"]',
    },
    {
      id: 'gear',
      title: 'Gear',
      caption: 'The kit that goes in the car.',
      alt: "Nightjar's Gear view: six equipment cards with their specs, and a packing checklist.",
      nav: '[data-view="gear"]',
    },
  ],
  frame: {
    style: 'window',
    theme: 'dark',
    title: '{name}: {title}',
    background: { type: 'gradient', from: '#2a1f6b', to: '#0b3b4c', angle: 135 },
    padding: 64,
    maxWidth: 1600,
    quality: 85,
  },
  outputs: {
    raw: 'showcase-out/raw/{lang}/{id}.png',
    readme: '../public/gallery/readme/{lang}/{id}.webp',
    portfolio: {
      dir: '../public/gallery/portfolio',
      size: [1600, 900],
      quality: 85,
      thumbnail: 'tonight',
      publicPath: '/showcase-kit/gallery/portfolio',
      // Next to this config, not in public/: the docs page imports it at build time.
      gallery: 'showcase.gallery.json',
    },
  },
  hero: {
    tagline: 'Plan the night, log what you saw.',
    logo: '../src/assets/mark.svg',
    shots: ['gear', 'log', 'tonight'],
    output: '../public/gallery/hero.webp',
    quality: 85,
  },
};
