#!/usr/bin/env python3
"""Redeploy to Netlify when fitment coverage crosses milestones."""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
STATE = Path("/tmp/aa-fitment-all/state.json")
DEPLOY_LOG = Path("/tmp/aa-fitment-all/deploys.log")
SITE_ID = "a6f5c299-d877-4105-b278-6d06d1d24f10"
# Redeploy when engines covered crosses these thresholds
MILESTONES = [100, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, 18390]
POLL_SEC = 90


def log(msg: str):
    DEPLOY_LOG.parent.mkdir(parents=True, exist_ok=True)
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {msg}"
    print(msg, flush=True)
    with open(DEPLOY_LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def engines_covered() -> int:
    if not STATE.exists():
        return 0
    try:
        st = json.loads(STATE.read_text(encoding="utf-8"))
        return int((st.get("stats") or {}).get("engines") or 0)
    except Exception:
        return 0


def deploy(tag: str) -> bool:
    token = os.environ.get("NETLIFY_AUTH_TOKEN")
    if not token:
        log("NETLIFY_AUTH_TOKEN missing; skip deploy")
        return False
    env = os.environ.copy()
    cmd = [
        "npx",
        "--yes",
        "netlify-cli",
        "deploy",
        "--prod",
        "--dir=.",
        f"--site={SITE_ID}",
        f"--message=fitment-wave-{tag}",
    ]
    log(f"deploy start tag={tag}")
    try:
        r = subprocess.run(
            cmd,
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=900,
        )
        out = (r.stdout or "")[-800:]
        err = (r.stderr or "")[-400:]
        log(f"deploy exit={r.returncode} tag={tag}\n{out}\n{err}")
        return r.returncode == 0
    except Exception as ex:
        log(f"deploy failed: {ex}")
        return False


def main():
    hit = set()
    marker = Path("/tmp/aa-fitment-all/deployed-milestones.json")
    if marker.exists():
        try:
            hit = set(json.loads(marker.read_text(encoding="utf-8")))
        except Exception:
            hit = set()
    log(f"watcher start hit={sorted(hit)}")
    idle_rounds = 0
    while True:
        n = engines_covered()
        for m in MILESTONES:
            if n >= m and m not in hit:
                ok = deploy(f"engines-{m}")
                if ok:
                    hit.add(m)
                    marker.write_text(json.dumps(sorted(hit)), encoding="utf-8")
        # stop when Wave A done and final milestone hit, or scraper gone + idle
        scraper_alive = (
            subprocess.call(["pgrep", "-f", "fill-all-brands-fitment.py"], stdout=subprocess.DEVNULL)
            == 0
        )
        if not scraper_alive:
            idle_rounds += 1
            if idle_rounds >= 3 and n > 0:
                if "final" not in hit:
                    deploy(f"final-{n}")
                    hit.add("final")
                    marker.write_text(json.dumps(sorted(hit), default=str), encoding="utf-8")
                log("watcher exit: scraper stopped")
                break
        else:
            idle_rounds = 0
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
