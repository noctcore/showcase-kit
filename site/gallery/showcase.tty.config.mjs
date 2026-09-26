// The terminal half of the docs gallery: tui.mjs, a dependency-free TUI with fixed data and a frozen clock.
// A tty config is its own file (a config captures either a browser page or a terminal), so the gallery
// script passes it with --config. As in showcase.config.mjs, wrap it in `defineConfig` in your own project.
export default {
  name: 'nightjar queue',
  target: {
    mode: 'tty',
    command: ['node', 'tui.mjs'],
    // Only what a program needs to start: nothing from your environment can end up in the images.
    inheritEnv: false,
    cols: 100,
    rows: 22,
  },
  ready: /Queue \(\d+\)/,
  deviceScaleFactor: 2,
  terminal: { theme: 'dark', font: { size: 15 } },
  shots: [
    {
      id: 'queue',
      title: 'Imaging queue',
      caption: 'The imaging queue, one target selected.',
      alt: 'A terminal showing the nightjar imaging queue: six targets with their progress, M27 selected, and its details with an altitude graph.',
      keys: 'j',
      waitFor: 'M27  Dumbbell',
    },
  ],
  clips: [
    {
      id: 'tour',
      title: 'Queue tour',
      caption: 'Moving down the queue, then over to the session log.',
      alt: 'An animation of the nightjar queue: the selection moves down three targets, then the view switches to the session log.',
      steps: [
        { sleep: 700 },
        { keys: 'j' },
        { sleep: 500 },
        { keys: 'j' },
        { sleep: 500 },
        { keys: 'j' },
        { sleep: 900 },
        { keys: '{Tab}' },
        { waitFor: 'Session log' },
      ],
      tailMs: 1800,
      durationMs: 10000,
      // formats defaults to WebP and GIF.
    },
  ],
  frame: {
    style: 'window',
    theme: 'dark',
    title: '{name}',
    // A solid background keeps a lossless clip small; a gradient does not compress.
    background: '#141a3a',
    padding: 48,
    // No maxWidth: downscaling blends pixels, and this clip came out three times larger with maxWidth: 1600.
  },
  outputs: {
    raw: 'showcase-out/raw-tty/{lang}/{id}.png',
    readme: '../public/gallery/terminal/{id}.webp',
    clips: '../public/gallery/terminal/{id}.{ext}',
  },
};
