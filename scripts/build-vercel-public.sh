#!/usr/bin/env bash
# GitHub / Vercel build: write lean static assets into ./public
# (api/ stays at repo root for serverless). Safe to run in-checkout.
#
# Vercel Git clones often leave Git LFS pointer stubs for data/*.json.gz.
# Materialize real gz files before copying into public/, then fail hard if
# they are still missing (otherwise Production/Preview go READY without
# /data/fitment.json.gz and the SPA 404 page is served under that path).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MIN_GZ_BYTES=1000000

is_lfs_pointer() {
  local f="$1"
  [ -f "$f" ] || return 1
  local sz
  sz="$(wc -c < "$f")"
  [ "$sz" -lt 1000 ] || return 1
  head -c 80 "$f" | grep -q 'git-lfs.github.com/spec' 2>/dev/null
}

ensure_git_lfs() {
  if command -v git-lfs >/dev/null 2>&1 || git lfs version >/dev/null 2>&1; then
    return 0
  fi
  echo "git-lfs missing; trying install…"
  if command -v apt-get >/dev/null 2>&1; then
    (curl -fsSL https://packagecloud.io/install/repositories/github/git-lfs/script.deb.sh | sudo bash) || true
    sudo apt-get install -y git-lfs || true
  fi
  if ! command -v git-lfs >/dev/null 2>&1 && ! git lfs version >/dev/null 2>&1; then
    local ver="3.5.1"
    local tmp="/tmp/git-lfs-$$"
    mkdir -p "$tmp"
    curl -fsSL "https://github.com/git-lfs/git-lfs/releases/download/v${ver}/git-lfs-linux-amd64-v${ver}.tar.gz" \
      -o "$tmp/git-lfs.tgz"
    tar -xzf "$tmp/git-lfs.tgz" -C "$tmp"
    sudo "$tmp/git-lfs-${ver}/install.sh" || sudo cp "$tmp"/git-lfs-*/git-lfs /usr/local/bin/
    rm -rf "$tmp"
  fi
  git lfs version
}

materialize_lfs_gz() {
  local need=0
  local f
  for f in data/fitment.json.gz data/catalog.json.gz; do
    if [ ! -f "$f" ] || is_lfs_pointer "$f" || [ "$(wc -c < "$f")" -lt "$MIN_GZ_BYTES" ]; then
      need=1
      break
    fi
  done
  [ "$need" -eq 1 ] || return 0

  if [ -d .git ]; then
    ensure_git_lfs
    git lfs install --local >/dev/null 2>&1 || git lfs install || true
    echo "git lfs pull for data/*.json.gz…"
    git lfs pull --include="data/*.json.gz" || git lfs pull
  fi

  for f in data/fitment.json.gz data/catalog.json.gz; do
    if [ -f "$f" ] && ! is_lfs_pointer "$f" && [ "$(wc -c < "$f")" -ge "$MIN_GZ_BYTES" ]; then
      continue
    fi
    # Fallback: public GitHub LFS media URL (works even when .vercelignore stripped .git).
    local ref="${VERCEL_GIT_COMMIT_SHA:-${VERCEL_GIT_COMMIT_REF:-main}}"
    [ -n "$ref" ] || ref="main"
    local repo="${VERCEL_GIT_REPO_OWNER:-DominiqueOthniel}/${VERCEL_GIT_REPO_SLUG:-aateileee}"
    local url="https://media.githubusercontent.com/media/${repo}/${ref}/${f}"
    echo "Downloading $f from $url"
    mkdir -p "$(dirname "$f")"
    local tmp="${f}.tmp.$$"
    if ! curl -fsSL --retry 3 --retry-delay 2 -o "$tmp" "$url"; then
      # Commit SHA may not be on media CDN yet; try branch / main.
      local br="${VERCEL_GIT_COMMIT_REF:-main}"
      url="https://media.githubusercontent.com/media/${repo}/${br}/${f}"
      echo "Retry $f from $url"
      curl -fsSL --retry 3 --retry-delay 2 -o "$tmp" "$url" \
        || curl -fsSL --retry 3 --retry-delay 2 -o "$tmp" \
          "https://media.githubusercontent.com/media/${repo}/main/${f}"
    fi
    local sz
    sz="$(wc -c < "$tmp")"
    if [ "$sz" -lt "$MIN_GZ_BYTES" ]; then
      echo "ERROR: downloaded $f is only $sz bytes (want >= $MIN_GZ_BYTES)" >&2
      head -c 160 "$tmp" >&2 || true
      echo >&2
      rm -f "$tmp"
      exit 1
    fi
    mv -f "$tmp" "$f"
    echo "OK $f ($sz bytes)"
  done
}

materialize_lfs_gz

for f in data/fitment.json.gz data/catalog.json.gz; do
  if [ ! -f "$f" ]; then
    echo "ERROR: missing $f after LFS materialize" >&2
    exit 1
  fi
  sz="$(wc -c < "$f")"
  if [ "$sz" -lt "$MIN_GZ_BYTES" ] || is_lfs_pointer "$f"; then
    echo "ERROR: $f looks like a Git LFS pointer or is too small ($sz bytes)." >&2
    echo "Keep .git out of .vercelignore (or use media.githubusercontent.com fallback)." >&2
    head -c 160 "$f" >&2 || true
    echo >&2
    exit 1
  fi
  echo "SOURCE_OK $f ($sz bytes)"
done

# Browser-safe catalog (required for purchasable UI; full catalog.json.gz OOMs tabs).
if [ -f scripts/build-shop-catalog.py ]; then
  python3 scripts/build-shop-catalog.py
fi
if [ ! -f data/shop-catalog.json.gz ] || [ "$(wc -c < data/shop-catalog.json.gz)" -lt "$MIN_GZ_BYTES" ]; then
  echo "ERROR: data/shop-catalog.json.gz missing or too small after build-shop-catalog.py" >&2
  ls -la data/shop-catalog.json.gz 2>&1 || true
  exit 1
fi
echo "SOURCE_OK data/shop-catalog.json.gz ($(wc -c < data/shop-catalog.json.gz) bytes)"

python3 - "$ROOT" <<'PY'

import json, re, shutil, sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(sys.argv[1])
STATIC = ROOT / "public"
MIN_GZ = 1_000_000
if STATIC.exists():
    shutil.rmtree(STATIC)
STATIC.mkdir(parents=True)

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
    "public",
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
            for f in ("catalog.json.gz", "fitment.json.gz", "shop-catalog.json.gz"):
                copied = False
                for cand in (
                    item / f,
                    ROOT / "data" / f,
                    Path("/tmp/aa-gzip-data") / f,
                ):
                    if cand.is_file() and cand.stat().st_size >= MIN_GZ:
                        shutil.copy2(cand, STATIC / "data" / f)
                        copied = True
                        break
                if not copied:
                    raise SystemExit(
                        f"ERROR: could not copy data/{f} into public/ "
                        f"(need a real gz >= {MIN_GZ} bytes)"
                    )
            continue
        shutil.copytree(
            item,
            STATIC / name,
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

for f in ("fitment.json.gz", "catalog.json.gz", "shop-catalog.json.gz"):
    p = STATIC / "data" / f
    if not p.is_file() or p.stat().st_size < MIN_GZ:
        raise SystemExit(f"ERROR: public/data/{f} missing or too small after build")
    print(f"PUBLIC_OK data/{f} ({p.stat().st_size} bytes)")

print(f"PUBLIC_BUILD {STATIC}")
print(f"media_paths={len(paths)} copied={copied} missing={len(missing)}")
if missing[:12]:
    print("missing_sample", missing[:12])
media_root = STATIC / "media"
print(f"media_files={sum(1 for _ in media_root.rglob('*') if _.is_file()) if media_root.exists() else 0}")
print(f"public_files={sum(1 for _ in STATIC.rglob('*') if _.is_file())}")
PY
