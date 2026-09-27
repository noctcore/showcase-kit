// The web config's hero in another look, for the gallery's hero section. `hero` renders from the raw
// captures `showcase all` wrote for showcase.config.mjs, so nothing is captured again; `root: '..'` keeps
// every path resolving from site/gallery/, like that config.
import web from '../showcase.config.mjs';

export default {
  ...web,
  root: '..',
  hero: {
    ...web.hero,
    background: { type: 'mesh', colors: ['#0b1026', '#6d28d9', '#0e7490', '#1e3a8a', '#be185d'] },
    output: '../public/gallery/layouts/hero-mesh.webp',
  },
};
