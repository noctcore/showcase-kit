---
"@noctcore/showcase-kit": minor
---

In url mode, a path `nav` such as `'/docs/'` now resolves under the target url's path instead of its origin: with `url: 'https://x.io/app/'` it visits `https://x.io/app/docs/`. Configs that worked around this by repeating the base path (`'/app/docs/'` with `url: 'https://x.io/app/'`) should drop the prefix. A last url segment with a dot names a file and is dropped, like a relative link: with `url: 'http://localhost:5173/index.html'`, `'/about'` visits `http://localhost:5173/about`. Urls at the origin root (`http://localhost:5173`) behave as before.
