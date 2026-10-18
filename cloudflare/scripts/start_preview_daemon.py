#!/usr/bin/env python3
import os, sys, time
LOG = "/home/z/my-project/preview-daemon.log"
pid = os.fork()
if pid == 0:
    os.setsid()
    pid2 = os.fork()
    if pid2 == 0:
        with open(LOG, "ab") as log, open(os.devnull, "rb") as dn:
            os.dup2(dn.fileno(), 0); os.dup2(log.fileno(), 1); os.dup2(log.fileno(), 2)
            os.chdir("/home/z/my-project")
            os.execvp("bunx", ["bunx", "wrangler", "dev", "--config", "wrangler.preview.jsonc", "--port", "3000"])
        os._exit(1)
    os._exit(0)
os.waitpid(pid, 0)
print("preview daemon spawned")
