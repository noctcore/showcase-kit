// The terminal shot in another frame, for the gallery's frame section. `frame` renders from the raw capture
// `showcase all` wrote for showcase.tty.config.mjs, so the app does not run again; `root: '..'` keeps every
// path resolving from site/gallery/.
import tty from '../showcase.tty.config.mjs';

export default {
  ...tty,
  root: '..',
  frame: {
    ...tty.frame,
    style: 'windows',
  },
  outputs: {
    raw: tty.outputs.raw,
    readme: '../public/gallery/layouts/{id}-windows.webp',
  },
};
