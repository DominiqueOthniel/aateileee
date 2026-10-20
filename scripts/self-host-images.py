#!/usr/bin/env python3
"""Download aateile CDN/S3 product images to same-origin media/ and rewrite catalog.

Resumable: state in /tmp/aa-self-host-images/state.json
Local paths:
  https://aateile.com/media/X/...  → /media/X/...
  https://aateile.s3.../img/...    → /media/s3/img/...
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
CATALOG = ROOT / "data" / "catalog.json"
SPARES = ROOT / "data" / "spares-categories.json"
STATE_DIR = Path("/tmp/aa-self-host-images")
STATE_FILE = STATE_DIR / "state.json"
PROGRESS = STATE_DIR / "progress.log"
UA = {
    "User-Agent": "Mozilla/5.0 (compatible; aateile-clone-self-host-images/1.0)",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}

_lock = threading.Lock()


def log(msg: str):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {msg}"
    print(msg, flush=True)
    with open(PROGRESS, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def strip_qs(url: str) -> str:
    return url.split("?", 1)[0].split("#", 1)[0]


def remote_to_local(url: str) -> str | None:
    """Map remote CDN URL → same-origin /media/... path."""
    if not url or not url.startswith("http"):
        return None
    u = strip_qs(url)
    if "aateile.com/media/" in u:
        # https://aateile.com/media/ab/cd/... → /media/ab/cd/...
        idx = u.find("/media/")
        if idx >= 0:
            return u[idx:]
    if "aateile.s3." in u:
        try:
            path = urllib.parse.urlparse(u).path
        except Exception:
            return None
        if not path.startswith("/"):
            path = "/" + path
        return "/media/s3" + path
    return None


def local_fs_path(local_url: str) -> Path:
    return ROOT / local_url.lstrip("/")


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"done": {}, "failed": {}, "stats": {}}


def save_state(st: dict):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)


def collect_remote_urls() -> list[str]:
    urls: set[str] = set()
    text = CATALOG.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'"(?:image|imageRemote|imageLocal|images)"\s*:\s*"([^"]+)"', text):
        u = m.group(1)
        if u.startswith("http") and ("aateile.com" in u or "aateile.s3" in u):
            urls.add(strip_qs(u))
    # arrays of images
    for m in re.finditer(r'"(https://(?:aateile\.com|aateile\.s3)[^"]+)"', text):
        urls.add(strip_qs(m.group(1)))
    if SPARES.exists():
        sp = SPARES.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'"(https://(?:aateile\.com|aateile\.s3)[^"]+)"', sp):
            urls.add(strip_qs(m.group(1)))
    return sorted(urls)


def encode_fetch_url(url: str) -> str:
    """Percent-encode path (spaces etc.) while keeping a valid request URL."""
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(urllib.parse.unquote(parts.path), safe="/")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))


def download_one(url: str) -> tuple[str, str, str | None]:
    """Returns (url, status, local_path|error). status: ok|skip|fail"""
    local = remote_to_local(url)
    if not local:
        return url, "fail", "no_local_mapping"
    dest = local_fs_path(local)
    if dest.exists() and dest.stat().st_size > 200:
        return url, "skip", local
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err = ""
    for attempt in range(3):
        try:
            req = urllib.request.Request(encode_fetch_url(url), headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                data = r.read()
            if len(data) < 200:
                return url, "fail", "too_small"
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
            return url, "ok", local
        except Exception as ex:
            last_err = str(ex)[:200]
            time.sleep(0.3 * (attempt + 1))
    return url, "fail", last_err


def rewrite_url_in_obj(obj, mapping: dict[str, str]) -> int:
    """Replace remote image strings in nested JSON; return change count."""
    n = 0
    if isinstance(obj, dict):
        for k, v in list(obj.items()):
            if isinstance(v, str) and v.startswith("http") and ("aateile.com" in v or "aateile.s3" in v):
                key = strip_qs(v)
                local = mapping.get(key) or remote_to_local(v)
                if local and local_fs_path(local).exists():
                    # Keep original remote under imageRemote when rewriting image
                    if k == "image" and not obj.get("imageRemote"):
                        obj["imageRemote"] = v
                    obj[k] = local
                    if k == "image":
                        obj["imageLocal"] = local
                    n += 1
            else:
                n += rewrite_url_in_obj(v, mapping)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, str) and v.startswith("http") and ("aateile.com" in v or "aateile.s3" in v):
                key = strip_qs(v)
                local = mapping.get(key) or remote_to_local(v)
                if local and local_fs_path(local).exists():
                    obj[i] = local
                    n += 1
            else:
                n += rewrite_url_in_obj(v, mapping)
    return n


def rewrite_catalog_files(downloaded_map: dict[str, str]):
    """Rewrite catalog + spares to local paths for files that exist on disk."""
    log("Rewriting catalog.json image fields…")
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    n = rewrite_url_in_obj(catalog, downloaded_map)
    # Also: for any product still on remote, if local file exists via mapping, rewrite
    for p in catalog.get("products") or []:
        for key in ("image", "imageRemote", "imageLocal"):
            u = p.get(key)
            if not isinstance(u, str):
                continue
            local = remote_to_local(u) if u.startswith("http") else (u if u.startswith("/media/") else None)
            if local and local_fs_path(local).exists():
                if key == "image" and u.startswith("http") and not p.get("imageRemote"):
                    p["imageRemote"] = u
                if p.get(key) != local:
                    p[key] = local
                    n += 1
                if key == "image":
                    p["imageLocal"] = local
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"catalog rewrites≈{n}")

    if SPARES.exists():
        spares = json.loads(SPARES.read_text(encoding="utf-8"))
        n2 = rewrite_url_in_obj(spares, downloaded_map)
        SPARES.write_text(json.dumps(spares, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"spares-categories rewrites≈{n2}")


def run_download(workers: int, max_urls: int | None, rewrite_every: int):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    st = load_state()
    done = st.setdefault("done", {})
    failed = st.setdefault("failed", {})

    urls = collect_remote_urls()
    log(f"unique remote URLs={len(urls)}")
    pending = [u for u in urls if u not in done]
    if max_urls:
        pending = pending[:max_urls]
    log(f"pending={len(pending)} already_done={len(done)} workers={workers}")

    ok = skip = fail = 0
    t0 = time.time()
    mapping = dict(done)  # url → local

    def work(u):
        return download_one(u)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(work, u): u for u in pending}
        finished = 0
        for fut in as_completed(futs):
            url, status, info = fut.result()
            finished += 1
            with _lock:
                if status == "ok":
                    ok += 1
                    done[url] = info
                    mapping[url] = info
                elif status == "skip":
                    skip += 1
                    done[url] = info
                    mapping[url] = info
                else:
                    fail += 1
                    failed[url] = info or "fail"
                if finished % 200 == 0 or finished == len(pending):
                    st["done"] = done
                    st["failed"] = failed
                    st["stats"] = {
                        "ok": ok,
                        "skip": skip,
                        "fail": fail,
                        "finished": finished,
                        "pending": len(pending),
                        "doneTotal": len(done),
                        "rate": round(finished / max(1, time.time() - t0), 2),
                    }
                    save_state(st)
                    # disk usage of media
                    try:
                        import subprocess

                        du = subprocess.check_output(["du", "-sh", str(ROOT / "media")], text=True).split()[0]
                    except Exception:
                        du = "?"
                    log(
                        f"progress {finished}/{len(pending)} ok={ok} skip={skip} fail={fail} "
                        f"rate={st['stats']['rate']}/s media={du}"
                    )
                if rewrite_every and finished % rewrite_every == 0:
                    try:
                        rewrite_catalog_files(mapping)
                    except Exception as ex:
                        log(f"rewrite checkpoint failed: {ex}")

    st["done"] = done
    st["failed"] = failed
    save_state(st)
    rewrite_catalog_files(mapping)
    log(f"DONE ok={ok} skip={skip} fail={fail} doneTotal={len(done)}")
    return st["stats"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=int(os.environ.get("IMG_WORKERS", "40")))
    ap.add_argument("--max-urls", type=int, default=0)
    ap.add_argument("--rewrite-every", type=int, default=2000)
    ap.add_argument("--rewrite-only", action="store_true")
    args = ap.parse_args()
    if args.rewrite_only:
        st = load_state()
        rewrite_catalog_files(st.get("done") or {})
        return
    run_download(args.workers, args.max_urls or None, args.rewrite_every)


if __name__ == "__main__":
    main()
