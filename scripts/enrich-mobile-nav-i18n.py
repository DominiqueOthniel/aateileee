#!/usr/bin/env python3
"""Refresh FR/DE category labels on data/mobile-nav.json from aateile offcanvas."""
from __future__ import annotations

import html as HTML
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
OUT = ROOT / "data" / "mobile-nav.json"
UA = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Accept": "text/html",
}
URLS = {
    "en": "https://aateile.com/widgets/menu/offcanvas",
    "fr": "https://aateile.com/fr/widgets/menu/offcanvas",
    "de": "https://aateile.com/de/widgets/menu/offcanvas",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read().decode("utf-8", "replace")


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub("<[^>]+>", "", HTML.unescape(s or ""))).strip()


def cat_id(path_or_href: str) -> str | None:
    m = re.search(r"(\d{4,})/?$", (path_or_href or "").split("?")[0].rstrip("/"))
    return m.group(1) if m else None


def parse_offcanvas(html: str) -> dict[str, str]:
    by_id: dict[str, str] = {}
    for block in re.split(r'<li[^>]*class="[^"]*navigation-offcanvas-list-item', html)[1:]:
        m = re.search(
            r'<a class="navigation-offcanvas-link[^"]*" href="([^"]+)"[^>]*>[\s\S]*?<span class="navigation-offcanvas-name"[^>]*>(.*?)</span>',
            block,
        )
        if m:
            cid = cat_id(m.group(1))
            name = clean(m.group(2))
            if cid and name:
                by_id[cid] = name
    for m in re.finditer(
        r'<a href="([^"]*car-parts[^"]*)" class="navigation-offcanvas-children__list-title">(.*?)</a>|'
        r'<a class="navigation-offcanvas-children__list-title" href="([^"]*car-parts[^"]*)">(.*?)</a>',
        html,
        re.S | re.I,
    ):
        href = m.group(1) or m.group(3)
        name = clean(m.group(2) or m.group(4))
        cid = cat_id(href)
        if cid and name:
            by_id.setdefault(cid, name)
    return by_id


def enrich(items: list, maps: dict[str, dict[str, str]]) -> None:
    for it in items:
        cid = cat_id(it.get("path") or "")
        en = (maps["en"].get(cid) if cid else None) or (it.get("names") or {}).get("en") or it.get("name")
        it["name"] = en
        it["names"] = {
            "en": en,
            "fr": (maps["fr"].get(cid) if cid else None) or en,
            "de": (maps["de"].get(cid) if cid else None) or en,
        }
        if it.get("children"):
            enrich(it["children"], maps)


def main() -> None:
    maps = {lang: parse_offcanvas(fetch(url)) for lang, url in URLS.items()}
    nav = json.loads(OUT.read_text(encoding="utf-8"))
    enrich(nav.get("items") or [], maps)
    nav["i18nSource"] = "aateile.com/widgets/menu/offcanvas"
    OUT.write_text(json.dumps(nav, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print({lang: len(mp) for lang, mp in maps.items()}, "->", OUT)


if __name__ == "__main__":
    main()
