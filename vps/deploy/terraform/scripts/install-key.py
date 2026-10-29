#!/usr/bin/env python3
"""Install the SSH key on a just-ordered VPS and print the image id.

The OVHcloud API lists VPS images only for an existing VPS, so the first
`tofu apply` orders the VPS without a key. Then:

    python3 -I scripts/install-key.py <service_name> ~/.ssh/datxevui-vps.pub

rebuilds that VPS with the image named like var.os (default "Ubuntu
24.04") and the key, waits until it runs, and prints the image id to set
as `image_id`. Rebuilding wipes the disk: only for a VPS that was just
ordered. Without the key argument it only prints the id.

Credentials, as the OVH provider reads them: OVH_ENDPOINT,
OVH_APPLICATION_KEY, OVH_APPLICATION_SECRET, OVH_CONSUMER_KEY, or the
[<endpoint>] section of ~/.ovh.conf. (Adapted from class-management's
deploy/terraform/ovh/scripts/vps-image-id.py.)
"""

import argparse
import configparser
import hashlib
import json
import os
import pathlib
import ssl
import sys
import time
import urllib.parse
import urllib.request

ENDPOINTS = {
    "ovh-ca": "https://ca.api.ovh.com/1.0",
    "ovh-eu": "https://eu.api.ovh.com/1.0",
    "ovh-us": "https://api.us.ovhcloud.com/1.0",
}


def tls_context():
    """The default store, or the system bundle when Python ships without one (python.org macOS builds)."""
    ctx = ssl.create_default_context()
    if not ctx.get_ca_certs() and os.path.exists("/etc/ssl/cert.pem"):
        ctx.load_verify_locations("/etc/ssl/cert.pem")
    return ctx


def credentials():
    conf = configparser.ConfigParser()
    conf.read(pathlib.Path("~/.ovh.conf").expanduser())
    endpoint = os.environ.get("OVH_ENDPOINT") or conf.get("default", "endpoint", fallback="ovh-ca")
    section = conf[endpoint] if conf.has_section(endpoint) else {}

    def value(env, key):
        found = os.environ.get(env) or section.get(key)
        if not found:
            sys.exit(f"missing {env} (or {key} in ~/.ovh.conf [{endpoint}])")
        return found

    return (
        ENDPOINTS[endpoint],
        value("OVH_APPLICATION_KEY", "application_key"),
        value("OVH_APPLICATION_SECRET", "application_secret"),
        value("OVH_CONSUMER_KEY", "consumer_key"),
    )


class Client:
    def __init__(self):
        self.base, self.ak, self.secret, self.ck = credentials()
        self.ctx = tls_context()
        with urllib.request.urlopen(f"{self.base}/auth/time", context=self.ctx) as r:
            self.delta = int(r.read()) - int(time.time())

    def call(self, method, path, body=None):
        url = self.base + path
        data = json.dumps(body) if body is not None else ""
        stamp = str(int(time.time()) + self.delta)
        sig = hashlib.sha1("+".join([self.secret, self.ck, method, url, data, stamp]).encode()).hexdigest()
        req = urllib.request.Request(url, data=data.encode() or None, method=method, headers={
            "Content-Type": "application/json",
            "X-Ovh-Application": self.ak,
            "X-Ovh-Consumer": self.ck,
            "X-Ovh-Timestamp": stamp,
            "X-Ovh-Signature": "$1$" + sig,
        })
        with urllib.request.urlopen(req, context=self.ctx) as r:
            raw = r.read()
            return json.loads(raw) if raw else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("service_name", help="the VPS, e.g. vps-1a2b3c4d.vps.ovh.ca")
    parser.add_argument("public_key", nargs="?", help="rebuild the VPS with the image and this public key")
    parser.add_argument("--os", default="Ubuntu 24.04", help="image name (var.os)")
    args = parser.parse_args()

    api = Client()
    svc = urllib.parse.quote(args.service_name, safe="")
    images = [
        api.call("GET", f"/vps/{svc}/images/available/{urllib.parse.quote(i, safe='')}")
        for i in api.call("GET", f"/vps/{svc}/images/available")
    ]
    matches = [i for i in images if i.get("name") == args.os]
    if len(matches) != 1:
        names = ", ".join(sorted(i.get("name", "?") for i in images))
        sys.exit(f"no single image named {args.os!r}; available: {names}")
    image_id = matches[0]["id"]

    if args.public_key:
        key = pathlib.Path(args.public_key).expanduser().read_text().strip()
        api.call("POST", f"/vps/{svc}/rebuild", {"imageId": image_id, "publicSshKey": key, "doNotSendPassword": True})
        print(f"rebuilding {args.service_name} with the key ...", file=sys.stderr)
        time.sleep(30)
        for _ in range(60):
            if api.call("GET", f"/vps/{svc}").get("state") == "running":
                print("running", file=sys.stderr)
                break
            time.sleep(10)
        else:
            sys.exit("the VPS did not come back within 10 minutes; check the Control Panel")
    print(image_id)


if __name__ == "__main__":
    main()
