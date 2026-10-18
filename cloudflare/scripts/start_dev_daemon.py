#!/usr/bin/env python3
"""Start the Next.js dev server as a true daemon (double-fork + setsid),
detached from the Bash tool's process group so it survives between
tool invocations."""
import os
import sys
import subprocess
import time

LOG = "/home/z/my-project/daemon-dev.log"

if os.path.exists("/tmp/dev-daemon.pid"):
    try:
        old = int(open("/tmp/dev-daemon.pid").read().strip())
        os.kill(old, 0)
        print("daemon already running, pid", old)
        sys.exit(0)
    except (ProcessLookupError, ValueError):
        pass

# Double-fork: child detaches from this process group entirely.
pid = os.fork()
if pid == 0:
    os.setsid()
    pid2 = os.fork()
    if pid2 == 0:
        with open(LOG, "ab") as log, open(os.devnull, "rb") as dn:
            os.dup2(dn.fileno(), 0)
            os.dup2(log.fileno(), 1)
            os.dup2(log.fileno(), 2)
            os.chdir("/home/z/my-project")
            os.execvp("bun", ["bun", "run", "dev"])
        os._exit(1)
    os._exit(0)
os.waitpid(pid, 0)

time.sleep(1)
# Find the actual bun pid from our own tree is hard after double fork;
# record the intermediate child via pgrep instead.
print("daemon spawned; waiting for port 3000...")
