// Not a capture config: the kit's own README shows a few gallery images, and `showcase readme` prints the table
// for them. That command only reads `shots` and `outputs.readme`, so each shot here names an image one of the
// configs in variants/ wrote, and its title doubles as the caption. Nothing is captured with this file and its
// target never starts.
export default {
  name: 'Nightjar',
  target: { mode: 'url', url: 'http://127.0.0.1:47219/' },
  shots: [
    {
      id: 'hero-spotlight',
      title: 'Hero: spotlight',
      alt: "A banner for Nightjar, the made-up app in showcase-kit's docs gallery, in the spotlight layout: the logo, name and tagline on the left, one large Tonight window running off the right edge.",
    },
    {
      id: 'hero-row',
      title: 'Hero: row',
      alt: "The Nightjar banner in the row layout: the logo, name and tagline centered at the top, the Gear, Log and Tonight windows side by side under them.",
    },
    {
      id: 'hero-mosaic',
      title: 'Hero: mosaic',
      alt: 'The Nightjar banner in the mosaic layout: the text on the left, a tilted wall of Nightjar windows fading out towards it.',
    },
    {
      id: 'tonight-browser',
      title: 'Frame: browser',
      alt: "Nightjar's Tonight view in the browser frame: a toolbar with back, forward and reload, and nightjar.app/tonight in the address bar.",
    },
  ],
  outputs: { readme: '../public/gallery/layouts/{id}.webp' },
};
