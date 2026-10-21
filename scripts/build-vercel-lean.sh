#!/usr/bin/env bash
# Build a lean Vercel publish tree:
#   public/  = shop shell + homepage media + light JSON
#   api/     = Vercel serverless (analytics/settings)
# Large media/s3 + catalog/fitment stay on Vercel Blob (rewrites in vercel.json).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="${1:-/tmp/aa-vercel-lean}"
python3 - "$ROOT" "$PUB" <<'PY'
import json, re, shutil, sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(sys.argv[1])
PUB = Path(sys.argv[2])
if PUB.exists():
    shutil.rmtree(PUB)
PUB.mkdir(parents=True)
STATIC = PUB / "public"
STATIC.mkdir()

ignore_dirs = {
    ".git",
    "node_modules",
    ".netlify",
    ".vercel",
    "__pycache__",
    "media",
    "tmp",
    "scripts",
    "netlify",
    "api",
}
skip_files = {
    "netlify.toml",
    ".netlifyignore",
    "package.json",
    "package-lock.json",
    "vercel.json",
    ".vercelignore",
}

for item in ROOT.iterdir():
    name = item.name
    if name in ignore_dirs:
        continue
    if item.is_file():
        if name.endswith(".log") or name in skip_files:
            continue
        shutil.copy2(item, STATIC / name)
    elif item.is_dir():
        if name == "data":
            (STATIC / "data").mkdir()
            for f in ("spares-categories.json", "mobile-nav.json"):
                src = item / f
                if src.exists():
                    shutil.copy2(src, STATIC / "data" / f)
            # Prefer prebuilt gzip snapshots (Blob Hobby cannot hold 1.3GB JSON)
            for f in ("catalog.json.gz", "fitment.json.gz"):
                for cand in (
                    Path("/tmp/aa-gzip-data") / f,
                    item / f,
                    ROOT / "data" / f,
                ):
                    if cand.is_file() and cand.stat().st_size > 1000:
                        shutil.copy2(cand, STATIC / "data" / f)
                        break
            continue
        shutil.copytree(
            item,
            STATIC / name,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
        )

# Serverless + package metadata at publish root (not inside public/)
for name in ("package.json", "package-lock.json", "vercel.json", ".vercelignore"):
    src = ROOT / name
    if src.exists():
        shutil.copy2(src, PUB / name)
if (ROOT / "api").is_dir():
    shutil.copytree(
        ROOT / "api",
        PUB / "api",
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
for rel in (
    "/media/d7/82/55/1767704607/logo-white-transparent-fr.svg",
    "/media/2d/bd/fa/1767978923/logo-white-transparent-de.svg",
):
    paths.add(rel)

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
        src2 = ROOT / unquote(rel.lstrip("/"))
        if src2.is_file():
            src = src2
        else:
            missing.append(rel)
            continue
    dst = STATIC / unquote(rel.lstrip("/"))
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    copied += 1

# Force outputDirectory public in published vercel.json
vj = json.loads((PUB / "vercel.json").read_text(encoding="utf-8"))
vj["outputDirectory"] = "public"
# Keep build trivial; serverless api/ stays at project root beside public/
(PUB / "vercel.json").write_text(json.dumps(vj, indent=2) + "\n", encoding="utf-8")

src_v = ROOT / ".vercel/project.json"
if src_v.exists():
    (PUB / ".vercel").mkdir(exist_ok=True)
    shutil.copy2(src_v, PUB / ".vercel/project.json")

print(f"LEAN_PUBLISH {PUB}")
print(f"media_paths={len(paths)} copied={copied} missing={len(missing)}")
if missing[:12]:
    print("missing_sample", missing[:12])
media_root = STATIC / "media"
print(f"media_files={sum(1 for _ in media_root.rglob('*') if _.is_file()) if media_root.exists() else 0}")
print(f"api_files={sum(1 for _ in (PUB/'api').rglob('*') if _.is_file())}")
PY
