# Changesets

This folder holds pending [changesets](https://github.com/changesets/changesets): one Markdown file per
change that should reach npm. Add one with `bunx changeset`, pick the bump (`patch`, `minor`, `major`)
and write the summary. When a release is cut, `changeset version` moves every summary into
`CHANGELOG.md` and deletes the files. Changesets skips this `README.md`, and so does the docs site.

Until then, the [changelog page](https://noctcore.github.io/showcase-kit/changelog/) lists pending
changesets at the top under "Unreleased", with the bump they add up to.

## Writing the summary

The summary is what a user reads on the changelog page, in the Atom feed, on GitHub and on npm. Write
it for someone upgrading: what changed, what it looks like in a config, and what they have to do.
Paragraphs after the first are fine.

## Calling out changes that need action

When a change needs action from a user (a config that has to change, code that stops compiling, a
default that moved), add a GitHub alert to the summary:

```md
---
'@noctcore/showcase-kit': minor
---

In url mode, a `nav` path that starts with `/` now resolves under the url's path.

> [!WARNING]
> Configs that repeat the base path (`'/app/docs/'` with `url: 'https://x.io/app/'`) must drop it.
```

The five types and what the site renders them as:

| Alert | Use it for | Site aside |
| --- | --- | --- |
| `[!NOTE]` | Something to be aware of, usually a small type or output change | note, "Note" |
| `[!TIP]` | A better way to use the change | tip, "Tip" |
| `[!IMPORTANT]` | Something you have to do to keep building | note, "Important" |
| `[!WARNING]` | Behaviour that changes under an existing config | caution, "Warning" |
| `[!CAUTION]` | Risk of losing data or publishing something you did not mean to | danger, "Caution" |

Rules the site build enforces (it fails rather than guess):

- The marker is the first line of the blockquote and stands alone on it: `> [!WARNING]`, then the text on
  the next `> ` lines.
- Only these five types. `[!DANGER]` or a typo fails the build and names the release.
- An alert needs text.

### Where GitHub shows it

GitHub renders an alert only at the top level of a document, not inside a list item. `changeset version`
indents each summary into a list item, so in `CHANGELOG.md` on GitHub an alert from a changeset shows as a
plain quote with the `[!WARNING]` marker. The site and the feed render it either way.

For GitHub to render it too, move the alert block to column 0 right after its entry when you review the
version PR (only the `>` lines, keep a blank line before them):

```md
- [`33abe38`](https://github.com/noctcore/showcase-kit/commit/33abe38) Thanks [@Shironex](https://github.com/Shironex)! - In url mode, ...

> [!WARNING]
> Configs that repeat the base path must drop it.

- [`3274ec3`](https://github.com/noctcore/showcase-kit/commit/3274ec3) ...
```

The site reads an unindented alert as part of the entry above it. To call out a change that is already
released, add an alert the same way: add the block, never rewrite the entry's text.
