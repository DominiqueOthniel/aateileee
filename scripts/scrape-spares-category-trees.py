#!/usr/bin/env python3
"""Scrape full nested subcategory trees from official aateile.com /spares.

Official expand-in-place panels nest mid-level groups under each top category:

  spare-parts-subcategory__item
    a.spare-parts-category__category   → mid-level header (link)
    .spare-parts-subcategory__list
      a.spare-parts-subcategory__category → leaf links

Writes data/spares-categories.json with children[].children[] for leaves.
"""
from __future__ import annotations

import html as HTML
import http.cookiejar
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
OUT = ROOT / "data/spares-categories.json"
EXISTING = OUT
CACHE = Path("/tmp/aa-spares-trees")
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

# Any vehicle session unlocks the full spare-parts category markup.
SEED_ENGINE = "0198e6ef07537023bc2f34f4aaaa47de"  # AUDI 50 0.8


def fetch(opener, url: str, data: bytes | None = None, headers: dict | None = None) -> str:
    h = {"User-Agent": UA, "Accept": "text/html,application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h)
    with opener.open(req, timeout=90) as r:
        return r.read().decode("utf-8", "replace")


def set_vehicle(opener, engine_id: str) -> bool:
    body = json.dumps({"vehicleId": engine_id}).encode()
    try:
        text = fetch(
            opener,
            "https://aateile.com/customer/vehicle",
            data=body,
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        return "success" in text and "true" in text
    except Exception as ex:
        print("set_vehicle fail", ex, flush=True)
        return False


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub("<[^>]+>", "", HTML.unescape(s or ""))).strip()


def base_cat_path(href: str) -> str:
    """Strip vehicle suffix: /car-parts/foo-123/audi/... → /car-parts/foo-123"""
    href = (href or "").split("?")[0].rstrip("/")
    m = re.match(r"^(https://aateile\.com)?(/car-parts/[^/]+)", href)
    return m.group(2) if m else href


def parse_spares_html(html: str) -> list[dict]:
    # Prefer the catalog grid (spare-parts-category__items), not the top slider.
    m = re.search(r'class="spare-parts-category__items"(.*)$', html, re.S)
    grid = m.group(1) if m else html
    parts = re.split(r'(?=<div class="spare-parts-category__item">)', grid)
    cats: list[dict] = []

    for block in parts:
        if "spare-parts-category__item" not in block[:80] and 'class="spare-parts-category__item"' not in block[:120]:
            if not block.lstrip().startswith("<div"):
                # split kept delimiter only when pattern matched start
                pass
        name_m = re.search(
            r'class="spare-parts-category__name"[^>]*>(.*?)</a>',
            block,
            re.S,
        )
        if not name_m:
            continue
        name = clean_text(name_m.group(1))
        href_m = re.search(
            r'href="([^"]+)"[^>]*class="spare-parts-category__name"|class="spare-parts-category__name"[^>]*href="([^"]+)"',
            block,
        )
        if not href_m:
            href_m = re.search(r'class="spare-parts-category__name"[^>]*href="([^"]+)"|href="([^"]+/car-parts/[^"]+)"[^>]*class="spare-parts-category__name"', block)
        # name link is usually: <a href="..." class="spare-parts-category__name">
        href_m = re.search(
            r'<a[^>]+href="([^"]+)"[^>]*class="spare-parts-category__name"[^>]*>|'
            r'<a[^>]+class="spare-parts-category__name"[^>]*href="([^"]+)"[^>]*>',
            block,
        )
        path = base_cat_path((href_m.group(1) or href_m.group(2)) if href_m else "")
        if not name or not path:
            continue

        # Image
        img_m = re.search(r'class="spare-parts-category__img"[^>]+src="([^"]+)"|spare-parts-category__media[^>]*>\s*<img[^>]+src="([^"]+)"', block, re.S)
        image = ""
        if img_m:
            image = img_m.group(1) or img_m.group(2) or ""
            if image.startswith("//"):
                image = "https:" + image

        children: list[dict] = []
        # Mid-level groups
        for mid_block in re.finditer(
            r'<div class="spare-parts-subcategory__item">(.*?)</div>\s*</div>',
            block,
            re.S,
        ):
            mb = mid_block.group(1)
            mid_m = re.search(
                r'<a[^>]+href="([^"]+)"[^>]*class="spare-parts-category__category"[^>]*>(.*?)</a>|'
                r'<a[^>]+class="spare-parts-category__category"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
                mb,
                re.S,
            )
            if not mid_m:
                continue
            mid_path = base_cat_path(mid_m.group(1) or mid_m.group(3) or "")
            mid_name = clean_text(mid_m.group(2) or mid_m.group(4) or "")
            leaves: list[dict] = []
            list_m = re.search(r'class="spare-parts-subcategory__list"(.*?)$', mb, re.S)
            list_html = list_m.group(1) if list_m else mb
            for lm in re.finditer(
                r'<a[^>]+href="([^"]+)"[^>]*class="spare-parts-subcategory__category"[^>]*>(.*?)</a>|'
                r'<a[^>]+class="spare-parts-subcategory__category"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
                list_html,
                re.S,
            ):
                lp = base_cat_path(lm.group(1) or lm.group(3) or "")
                ln = clean_text(lm.group(2) or lm.group(4) or "")
                if lp and ln:
                    leaves.append({"name": ln, "path": lp})
            if mid_path and mid_name:
                node = {"name": mid_name, "path": mid_path}
                if leaves:
                    node["children"] = leaves
                children.append(node)

        # Fallback: flat leaves directly under category (no mid groups)
        if not children:
            for lm in re.finditer(
                r'<a[^>]+href="([^"]+)"[^>]*class="spare-parts-subcategory__category"[^>]*>(.*?)</a>',
                block,
                re.S,
            ):
                lp = base_cat_path(lm.group(1))
                ln = clean_text(lm.group(2))
                if lp and ln:
                    children.append({"name": ln, "path": lp})

        cat = {"name": name, "path": path, "children": children}
        if image:
            cat["image"] = image
        cats.append(cat)
    return cats


def merge_images(new_cats: list[dict], old: dict) -> list[dict]:
    by_path = {}
    for key in ("topCategories", "allCategories"):
        for c in old.get(key) or []:
            by_path[c.get("path")] = c
    for c in new_cats:
        prev = by_path.get(c["path"]) or {}
        if prev.get("imageLocal") and not c.get("imageLocal"):
            c["imageLocal"] = prev["imageLocal"]
        if prev.get("image") and not c.get("image"):
            c["image"] = prev["image"]
    return new_cats


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE / "spares.html"
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    ok = set_vehicle(opener, SEED_ENGINE)
    print("vehicle ok", ok, flush=True)
    html = fetch(opener, "https://aateile.com/spares")
    cache_file.write_text(html, encoding="utf-8")
    cats = parse_spares_html(html)
    print(f"parsed {len(cats)} top categories", flush=True)

    old = {}
    if EXISTING.exists():
        old = json.loads(EXISTING.read_text(encoding="utf-8"))
    cats = merge_images(cats, old)

    nested = 0
    leaves = 0
    for c in cats:
        for mid in c.get("children") or []:
            ch = mid.get("children") or []
            if ch:
                nested += 1
                leaves += len(ch)
            else:
                leaves += 1
        print(
            f"  {c['name']}: mids={len(c.get('children') or [])} "
            f"deepLeaves={sum(len(m.get('children') or []) for m in c.get('children') or [])}",
            flush=True,
        )

    lighting = next((c for c in cats if c["name"] == "Lighting"), None)
    if lighting:
        print("LIGHTING tree:", flush=True)
        for mid in lighting.get("children") or []:
            print(f"  {mid['name']} ({len(mid.get('children') or [])})", flush=True)
            for leaf in mid.get("children") or []:
                print(f"    - {leaf['name']}", flush=True)

    out = {
        "topCategories": cats,
        "allCategories": cats,
        "vehiclePlaceholder": old.get("vehiclePlaceholder")
        or "/media/category-covers/vehicle-placeholder.svg",
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "aateile.com/spares",
        "stats": {"top": len(cats), "midWithLeaves": nested, "leafCount": leaves},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", OUT, "leafCount", leaves, flush=True)


if __name__ == "__main__":
    main()
