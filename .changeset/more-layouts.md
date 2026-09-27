---
"@noctcore/showcase-kit": minor
---

More looks for the hero, the frames and the README snippet. Every new option defaults to the look you have today, so an existing config renders the same images byte for byte.

- **Hero layouts**: `hero.layout` picks the composition: `stack` (the default, as before), `spotlight` (one large straight window running off the edges), `split` (one window in perspective), `row` (up to four windows under centered text), `mosaic` (a tilted wall of windows) and `centered` (text first, one window rising from the bottom). `hero.shots` takes as many shots as the layout shows and defaults to that many of the first shots.
- **Frame styles**: `frame.style` also takes `browser` (a toolbar with an address bar, whose text is the new `frame.address`, `'{url}'` by default), `windows` (a Windows title bar) and `terminal` (a terminal tab; in tty mode the bar takes the terminal background). tty mode refuses `browser`, and cdp mode needs an `address` without `{url}`.
- **Backgrounds**: `frame.background` and `hero.background` also take `{ type: 'mesh', colors }`, `{ type: 'dots', color, dot, spacing }` and `{ type: 'noise', from, to, angle, amount }`, a gradient with a film grain that is the same on every run.
- **README layouts**: `showcase readme --layout <name>` prints `table` (the default, as before), `rows`, `featured`, `details` or `list`, all built from HTML that GitHub keeps in a README. `--cols` applies to `table` and `featured`. The library's `readmeSnippet` takes the same `layout` option.
