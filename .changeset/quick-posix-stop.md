---
'@noctcore/showcase-kit': patch
---

Stopping a started command on Linux and macOS no longer waits the full two second grace period and then sends a needless SIGKILL: it now returns as soon as the process tree has exited on SIGTERM. When the host exits without calling `stop()`, the process group is killed with SIGKILL right away instead of blocking the exit for two seconds.
