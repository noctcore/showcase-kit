---
"@noctcore/showcase-kit": patch
---

Terminal apps: a shot no longer catches a frame the app is still drawing. A terminal can hand one write over in pieces (a macOS pty passes 1024 bytes at a time), so the `waitFor` text could be on screen before the rest of its frame, and the shot came out cut off, with different bytes from run to run. Before every shot the kit now waits until the screen has not changed for 100 ms, which adds about 100 ms to each shot. An app that redraws the same frame on a timer settles at once. An app whose screen never stops changing (a clock, a spinner) is shot after at most 1 s, or sooner when the shot's `timeouts.shotMs` runs out, with a warning; give it a frozen mode for captures, as the terminal determinism guide describes. Trailing separators in a CDP url, `outputs.portfolio` and shim arguments are now trimmed in linear time, with the same results as before.
