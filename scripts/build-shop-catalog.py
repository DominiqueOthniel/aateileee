#!/usr/bin/env python3
"""Build a browser-safe shop catalog from data/catalog.json.gz.

Full catalog.json.gz inflates to ~600MB+ (embedded fitment map + per-product
fitment id lists). Browsers OOM before products paint, so the live shop looks
empty even when the gz file is present on Vercel.

Writes data/shop-catalog.json.gz with:
  - slim product rows (no fitment / images[])
  - byCategory index (path -> product indexes) so we can drop bulky
    product.categories arrays and still fill every category page
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_GZ = ROOT / "data" / "catalog.json.gz"
SRC_JSON = ROOT / "data" / "catalog.json"
OUT_GZ = ROOT / "data" / "shop-catalog.json.gz"
OUT_JSON = ROOT / "data" / "shop-catalog.json"


def load_catalog() -> dict:
    if SRC_GZ.is_file() and SRC_GZ.stat().st_size > 1000:
        with gzip.open(SRC_GZ, "rb") as f:
            return json.load(f)
    if SRC_JSON.is_file() and SRC_JSON.stat().st_size > 1000:
        return json.loads(SRC_JSON.read_text(encoding="utf-8"))
    raise SystemExit(f"missing catalog source ({SRC_GZ} / {SRC_JSON})")


def cat_path(v) -> str | None:
    if isinstance(v, str) and v.startswith("/"):
        return v
    if isinstance(v, dict):
        p = v.get("path")
        if isinstance(p, str) and p.startswith("/"):
            return p
    return None


def slim_product(p: dict) -> dict:
    image = p.get("image") or p.get("imageLocal") or p.get("imageRemote") or ""
    if not image:
        imgs = p.get("images")
        if isinstance(imgs, list) and imgs:
            image = imgs[0]
    primary = cat_path(p.get("category")) or ""
    out = {
        "path": p.get("path"),
        "name": p.get("name") or "",
        "brand": p.get("brand") or "",
        "sku": p.get("sku") or p.get("articleNumber") or "",
        "price": p.get("price"),
        "currency": p.get("currency") or "EUR",
        "image": image,
        "category": primary,
    }
    if p.get("articleNumber") and p.get("articleNumber") != out["sku"]:
        out["articleNumber"] = p["articleNumber"]
    return out


def main() -> None:
    data = load_catalog()
    products_in = data.get("products") or []
    if not isinstance(products_in, list) or len(products_in) < 100:
        raise SystemExit(
            f"catalog products too small: {len(products_in) if isinstance(products_in, list) else type(products_in)}"
        )

    slim: list[dict] = []
    by_category: dict[str, list[int]] = defaultdict(list)
    for p in products_in:
        if not isinstance(p, dict) or not p.get("path"):
            continue
        idx = len(slim)
        row = slim_product(p)
        slim.append(row)
        paths = set()
        primary = cat_path(p.get("category"))
        if primary:
            paths.add(primary)
        for c in p.get("categories") or []:
            cp = cat_path(c)
            if cp:
                paths.add(cp)
        for cp in paths:
            by_category[cp].append(idx)

    priced = sum(
        1 for p in slim if isinstance(p.get("price"), (int, float)) and float(p["price"]) > 0
    )
    out = {
        "siteName": data.get("siteName") or "AATEILE",
        "baseUrl": data.get("baseUrl") or "",
        "categories": data.get("categories") or [],
        "topCategories": data.get("topCategories") or [],
        "products": slim,
        "byCategory": dict(by_category),
        "cms": data.get("cms") or {},
        "locales": data.get("locales") or ["en-GB", "fr-FR", "de-DE"],
        "shopCatalog": {
            "source": "build-shop-catalog.py",
            "productCount": len(slim),
            "pricedCount": priced,
            "categoryBuckets": len(by_category),
            "omitted": ["fitment", "fitmentEngines", "product.fitment", "product.images", "product.categories"],
        },
    }
    raw = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    OUT_JSON.write_bytes(raw)
    with gzip.open(OUT_GZ, "wb", compresslevel=9) as f:
        f.write(raw)
    print(
        f"SHOP_CATALOG products={len(slim)} priced={priced} cats={len(by_category)} "
        f"json_mb={len(raw)/1e6:.1f} gz_mb={OUT_GZ.stat().st_size/1e6:.2f} -> {OUT_GZ}"
    )
    if priced < 1000:
        raise SystemExit("too few priced products in shop catalog")
    if len(by_category) < 50:
        raise SystemExit("byCategory too small")


if __name__ == "__main__":
    main()
