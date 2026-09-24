---
"@noctcore/showcase-kit": minor
---

New `outputs.readme: false` for portfolio-only configs (`frame` and `all` skip the README images; portfolio and hero still render from the raw captures) and `outputs.portfolio.gallery: false | '<path>.json'` to skip or relocate `showcase.gallery.json`, for example out of a web root. `PortfolioResult.galleryFile` is now `undefined` when the gallery is skipped.
