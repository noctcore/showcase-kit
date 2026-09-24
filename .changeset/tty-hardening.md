---
"@noctcore/showcase-kit": patch
---

Terminal apps: `target.inheritEnv` controls which of your environment variables the app gets (`true` by default; `false` or a list of names keeps tokens and home paths out of an app whose screen becomes a committed image, while `PATH` and on Windows `PATHEXT`, `SystemRoot` and `ComSpec` are still inherited so it can start). A CLI that prints its screen and exits at once is now captured instead of failing with "exited before". Arguments passed through a Windows `.cmd` or `.bat` shim that contain `"` or `%` are refused with a clear error (cmd.exe cannot pass them), and trailing backslashes arrive intact. `renderTtyScreen` checks the theme of the look it is given. `openTtySession` returns before Windows reports the app's PID, so Ctrl+C requests the terminal's teardown even that early.
