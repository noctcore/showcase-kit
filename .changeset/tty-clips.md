---
"@noctcore/showcase-kit": minor
---

Terminal clips: a tty config can list `clips`, short animated recordings that `showcase record` (and `showcase all`) writes to `outputs.clips` (default `assets/showcase/{lang}/{id}.{ext}`). Each clip starts a fresh app and runs its `steps` (`{ keys }`, `{ type, delayMs? }`, `{ waitFor }`, `{ sleep }`) on the kit's own frame clock at `fps` (default 10), merges frames that did not change, ends `tailMs` (default 1500) after the last step or at `durationMs`, and is framed like the README images with one frame render per clip. Formats default to lossless animated WebP plus GIF; `'mp4'` is opt-in and needs `ffmpeg` on PATH. `showcase readme` lists clips after the shots. Clips in url and cdp mode are refused until web clips arrive in v0.3. New exports: `record` and `encodeAnimation` (frames plus delays in, WebP, GIF or MP4 out).
