// The web config's README image in another frame, for the gallery's frame section. `frame` renders from the
// raw captures `showcase all` wrote for showcase.config.mjs, so nothing is captured again; `root: '..'`
// keeps every path resolving from site/gallery/. One language, sized for a docs tile rather than a README.
import web from '../showcase.config.mjs';

export default {
  ...web,
  root: '..',
  langs: ['en'],
  frame: {
    ...web.frame,
    background: { type: 'dots', color: '#0d1224' },
    maxWidth: 1200,
    quality: 80,
  },
  outputs: {
    raw: web.outputs.raw,
    readme: '../public/gallery/layouts/{id}-dots.webp',
  },
};
