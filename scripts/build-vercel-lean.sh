#!/usr/bin/env bash
# Build a lean Vercel publish tree: shop shell + homepage category media + light JSON.
# Avoids Netlify for /media category covers and /data/spares-categories.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="${1:-/tmp/aa-vercel-lean}"
python3 - "$ROOT" "$PUB" <<'PY'
import json, re, shutil, sys
from pathlib import Path

ROOT = Path(sys.argv[1])
PUB = Path(sys.argv[2])
if PUB.exists():
    shutil.rmtree(PUB)
PUB.mkdir(parents=True)

ignore_dirs = {".git", "node_modules", ".netlify", ".vercel", "__pycache__", "media", "tmp", "scripts"}
for item in ROOT.iterdir():
    name = item.name
    if name in ignore_dirs:
        continue
    if item.is_file():
        if name.endswith(".log"):
            continue
        shutil.copy2(item, PUB / name)
    elif item.is_dir():
        if name == "data":
            (PUB / "data").mkdir()
            for f in ("spares-categories.json", "mobile-nav.json"):
                src = item / f
                if src.exists():
                    shutil.copy2(src, PUB / "data" / f)
            continue
        shutil.copytree(
            item,
            PUB / name,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
        )

sp = json.loads((ROOT / "data/spares-categories.json").read_text(encoding="utf-8"))
paths = set()

def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, str) and v.startswith("/media/") and not v.startswith("/media/s3/"):
                paths.add(v.split("?")[0])
            else:
                walk(v)
    elif isinstance(o, list):
        for i in o:
            walk(i)

walk(sp)
covers = ROOT / "media/category-covers"
if covers.is_dir():
    for p in covers.iterdir():
        if p.is_file():
            paths.add("/media/category-covers/" + p.name)
paths.add("/media/category-covers/vehicle-placeholder.svg")
# Header logos used on homepage
for rel in (
    "/media/d7/82/55/1767704607/logo-white-transparent-fr.svg",
    "/media/2d/bd/fa/1767978923/logo-white-transparent-de.svg",
):
    paths.add(rel)

# Homepage (and shell) media: category covers + bestsellers thumbs, not /media/s3
# index.html uses both "/media/..." and relative "media/..."
media_re = re.compile(
    r"""(?:src|srcset|data-src|url\()\s*=?\s*["']?(?:/)?(media/(?!s3/)[^"')\s]+)""",
    re.I,
)
bare_re = re.compile(
    r"""(?<![\w.-])(?:/)?(media/(?!s3/)[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{2}/[^"'\\\s)]+)""",
    re.I,
)
for name in ("index.html", "app.html", "404.html"):
    html = ROOT / name
    if not html.is_file():
        continue
    text = html.read_text(encoding="utf-8", errors="replace")
    for m in media_re.findall(text) + bare_re.findall(text):
        rel = "/" + m.lstrip("/").split("?")[0].split(" ")[0]
        if not rel.startswith("/media/s3/"):
            paths.add(rel)

missing = []
copied = 0
for rel in sorted(paths):
    src = ROOT / rel.lstrip("/")
    if not src.is_file():
        # try percent-decoded filesystem name
        from urllib.parse import unquote
        src2 = ROOT / unquote(rel.lstrip("/"))
        if src2.is_file():
            src = src2
        else:
            missing.append(rel)
            continue
    dst = PUB / rel.lstrip("/")
    # Prefer decoded path on disk for publish when file uses spaces
    from urllib.parse import unquote
    dst = PUB / unquote(rel.lstrip("/"))
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    copied += 1
print(f"media_paths={len(paths)} copied={copied} missing={len(missing)}")
if missing[:12]:
    print("missing_sample", missing[:12])

# Keep project link for vercel CLI
src_v = ROOT / ".vercel/project.json"
if src_v.exists():
    (PUB / ".vercel").mkdir(exist_ok=True)
    shutil.copy2(src_v, PUB / ".vercel/project.json")

print(f"LEAN_PUBLISH {PUB}")
print(f"media_files={sum(1 for _ in (PUB/'media').rglob('*') if _.is_file())}")
PY
