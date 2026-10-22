#!/usr/bin/env bash
# Vercel Git install: deps + materialize LFS data/*.json.gz.
# Kept out of vercel.json because installCommand max length is 256 chars.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm install

if ! command -v git-lfs >/dev/null 2>&1 && ! git lfs version >/dev/null 2>&1; then
  echo "git-lfs missing; attempting install…"
  if command -v apt-get >/dev/null 2>&1; then
    (curl -fsSL https://packagecloud.io/install/repositories/github/git-lfs/script.deb.sh | sudo bash) || true
    sudo apt-get install -y git-lfs || true
  fi
  if ! command -v git-lfs >/dev/null 2>&1 && ! git lfs version >/dev/null 2>&1; then
    ver="3.5.1"
    tmp="/tmp/git-lfs-$$"
    mkdir -p "$tmp"
    curl -fsSL "https://github.com/git-lfs/git-lfs/releases/download/v${ver}/git-lfs-linux-amd64-v${ver}.tar.gz" \
      -o "$tmp/git-lfs.tgz" || true
    if [ -f "$tmp/git-lfs.tgz" ]; then
      tar -xzf "$tmp/git-lfs.tgz" -C "$tmp"
      sudo "$tmp/git-lfs-${ver}/install.sh" 2>/dev/null \
        || sudo cp "$tmp"/git-lfs-*/git-lfs /usr/local/bin/ 2>/dev/null \
        || true
    fi
    rm -rf "$tmp"
  fi
fi

if command -v git-lfs >/dev/null 2>&1 || git lfs version >/dev/null 2>&1; then
  git lfs install || true
  if ! git lfs pull --include="data/*.json.gz"; then
    echo "WARN: git lfs pull skipped or failed; build-vercel-public.sh will materialize gz"
  fi
else
  echo "WARN: git-lfs unavailable; build-vercel-public.sh will materialize gz via media.githubusercontent.com"
fi
