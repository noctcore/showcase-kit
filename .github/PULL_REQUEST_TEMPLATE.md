<!-- Keep this short. CONTRIBUTING.md has the long version. -->

## What

<!-- One or two sentences: what changes for someone using the kit, or why it does not. -->

## Checklist

- [ ] A changeset in `.changeset/` (`bun run changeset`), written for someone reading the changelog before they upgrade: what changed, the new default, and what they have to do. Skip only if nothing that ships in the package changed.
- [ ] Gates I ran locally: `bun run typecheck` and `bun run test` (it builds first). Name the OS. If the change touches paths, processes, the PTY or shims, say whether it ran on Windows.
- [ ] A new or changed config key has its JSDoc in `src/config/types.ts`, its validation and the key lists in `src/config/`, tests for the default and every rejected form, and `bun run --cwd site test` passes (the config reference is generated from that JSDoc).
- [ ] New tests are deterministic: local fixtures only, files in a temp dir, no golden images, loose time bounds, and each one failed once against broken code before it passed.
