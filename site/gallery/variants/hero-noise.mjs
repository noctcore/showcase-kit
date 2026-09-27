// The web config's hero in another look, for the gallery's hero section. `hero` renders from the raw
// captures `showcase all` wrote for showcase.config.mjs, so nothing is captured again; `root: '..'` keeps
// every path resolving from site/gallery/, like that config.
import web from '../showcase.config.mjs';

export default {
  ...web,
  root: '..',
  hero: {
    ...web.hero,
    background: { type: 'noise', from: '#2a1f6b', to: '#0b3b4c' },
    output: '../public/gallery/layouts/hero-noise.webp',
  },
};
