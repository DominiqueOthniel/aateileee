#!/usr/bin/env python3
"""Fill missing catalog product images from aateile.com listings and PDPs."""
from __future__ import annotations

import html as HTML
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import importlib.util

ROOT = Path("/agent/aateile-clone")
CATALOG = ROOT / "data" / "catalog.json"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
}

# Reuse helpers from full-catalog scraper
_spec = importlib.util.spec_from_file_location(
    "fullcat", ROOT / "scripts" / "scrape-full-catalog.py"
)
_full = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_full)
normalize_image_url = _full.normalize_image_url
parse_products = _full.parse_products
fetch = _full.fetch


def is_chrome_logo(url: str) -> bool:
    low = (url or "").lower()
    return bool(re.search(r"logo-white|logo-black|header-logo|transparent-fr\.svg", low))


def pick_pdp_image(html: str) -> str:
    candidates: list[str] = []
    for tag in re.findall(r"<img\b[^>]*>", html, re.I):
        if "product-image" not in tag and "gallery-slider" not in tag and "magnifier" not in tag:
            continue
        m = re.search(r'\bsrc="([^"]+)"', tag, re.I) or re.search(
            r'\bdata-src="([^"]+)"', tag, re.I
        )
        if not m:
            continue
        url = normalize_image_url(m.group(1))
        if url and not is_chrome_logo(url):
            # Prefer real product art over brand wordmarks
            if re.search(r"logo\.png|logo\.jpg|logo\.webp", url, re.I) and "s3" in url:
                candidates.append(url)  # keep as weak fallback
            else:
                candidates.insert(0, url)
    og = re.search(
        r'property="og:image"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:image"',
        html,
        re.I,
    )
    if og:
        url = normalize_image_url(og.group(1) or og.group(2))
        if url and not is_chrome_logo(url):
            candidates.append(url)
    # Prefer non-LOGO filenames
    for c in candidates:
        if not re.search(r"logo\.(png|jpe?g|webp)", c, re.I):
            return c
    return candidates[0] if candidates else ""


def normalize_existing(p: dict) -> None:
    img = p.get("image") or ""
    if img and not img.startswith("http"):
        p["image"] = normalize_image_url(img) or img
    imgs = p.get("images")
    if isinstance(imgs, list) and imgs and (not p.get("image") or is_chrome_logo(p.get("image") or "")):
        for u in imgs:
            nu = normalize_image_url(u) if isinstance(u, str) else ""
            if nu and not is_chrome_logo(nu) and not re.search(r"logo\.(png|jpe?g|webp)", nu, re.I):
                p["image"] = nu
                break


def enrich_from_listings(catalog: dict) -> int:
    by_cat: dict[str, list[dict]] = {}
    for p in catalog.get("products") or []:
        if p.get("image") and not is_chrome_logo(p["image"]):
            continue
        cat = p.get("category")
        if cat:
            by_cat.setdefault(cat, []).append(p)
    if not by_cat:
        return 0
    filled = 0
    cats = list(by_cat.keys())
    print(f"Listing enrich: {len(cats)} categories with missing images", flush=True)

    def one(cat: str):
        # page 1 is enough to refill many; also grab a few more pages when still missing
        got = {}
        for page in range(1, 6):
            url = "https://aateile.com" + cat + (f"?p={page}" if page > 1 else "")
            try:
                html = fetch(url)
            except Exception as e:
                return cat, got, str(e)
            for prod in parse_products(html, cat):
                if prod.get("image"):
                    got[prod["path"]] = prod["image"]
            if page == 1 and len(got) == 0:
                break
        return cat, got, None

    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = [ex.submit(one, c) for c in cats]
        done = 0
        for fut in as_completed(futs):
            cat, got, err = fut.result()
            done += 1
            for p in by_cat.get(cat, []):
                if got.get(p["path"]):
                    p["image"] = got[p["path"]]
                    filled += 1
            if done % 25 == 0 or done == len(cats):
                print(f"  listings {done}/{len(cats)} filled={filled} err={err}", flush=True)
    return filled


def enrich_from_pdps(catalog: dict) -> int:
    missing = [
        p
        for p in catalog.get("products") or []
        if not p.get("image") or is_chrome_logo(p.get("image") or "")
    ]
    if not missing:
        return 0
    print(f"PDP enrich: {len(missing)} products", flush=True)
    filled = 0

    def one(p: dict):
        url = "https://aateile.com" + p["path"]
        try:
            html = fetch(url)
            return p["path"], pick_pdp_image(html), None
        except Exception as e:
            return p["path"], "", str(e)

    by_path = {p["path"]: p for p in catalog["products"]}
    with ThreadPoolExecutor(max_workers=20) as ex:
        futs = [ex.submit(one, p) for p in missing]
        done = 0
        for fut in as_completed(futs):
            path, img, err = fut.result()
            done += 1
            if img and path in by_path:
                by_path[path]["image"] = img
                filled += 1
            if done % 50 == 0 or done == len(missing):
                print(f"  pdps {done}/{len(missing)} filled={filled}", flush=True)
    return filled


def main():
    t0 = time.time()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    before = sum(1 for p in catalog["products"] if p.get("image") and not is_chrome_logo(p["image"]))
    for p in catalog["products"]:
        normalize_existing(p)
    after_norm = sum(1 for p in catalog["products"] if p.get("image") and not is_chrome_logo(p["image"]))
    print(f"Normalized relative images: {before} -> {after_norm}", flush=True)
    listing_filled = enrich_from_listings(catalog)
    pdp_filled = enrich_from_pdps(catalog)
    # Final normalize
    for p in catalog["products"]:
        normalize_existing(p)
    with_img = sum(1 for p in catalog["products"] if p.get("image") and not is_chrome_logo(p["image"]))
    empty = len(catalog["products"]) - with_img
    catalog["imageEnrichment"] = {
        "withImage": with_img,
        "empty": empty,
        "listingFilled": listing_filled,
        "pdpFilled": pdp_filled,
        "elapsedSec": round(time.time() - t0, 1),
        "enrichedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(catalog["imageEnrichment"], indent=2))
    # samples
    samples = [p["image"] for p in catalog["products"] if p.get("image")][:5]
    print("samples", samples)


if __name__ == "__main__":
    main()
