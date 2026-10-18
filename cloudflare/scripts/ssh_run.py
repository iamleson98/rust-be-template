#!/usr/bin/env python3
"""SSH helper for server ops. Usage: ssh_run.py "command" [--timeout N]"""
import sys, json

import paramiko

HOST = "169.58.249.26"
USER = "root"
KEY_PATH = "/home/z/.ssh/id_ed25519"


def run(cmd: str, timeout: int = 60) -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        username=USER,
        key_filename=KEY_PATH,
        timeout=15,
        banner_timeout=15,
        auth_timeout=15,
    )
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        rc = stdout.channel.recv_exit_status()
        if out:
            print(out, end="" if out.endswith("\n") else "\n")
        if err:
            print("[STDERR]", err, file=sys.stderr)
        return rc
    finally:
        client.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: ssh_run.py 'command' [timeout]", file=sys.stderr)
        sys.exit(2)
    cmd = sys.argv[1]
    tmo = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    sys.exit(run(cmd, tmo))
