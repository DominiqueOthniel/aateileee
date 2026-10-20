#!/usr/bin/env python3
"""Fill fitment for MERCEDES-BENZ 123 Coupe (C123) from official aateile.com.

Uses ALL catalog category paths (not only spares leaves) so Starter / Head gasket
and other deep categories are scraped. Merges into existing per-engine caches.
"""
from __future__ import annotations

import http.cookiejar
import importlib.util
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
_spec = importlib.util.spec_from_file_location(
    "vehicle_cat_fill", ROOT / "scripts" / "scrape-vehicle-category-fill.py"
)
_mod = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(_mod)

_mod.UA = "Mozilla/5.0 (compatible; aateile-clone-c123-fill/1.3)"


def fetch_raw(opener, url: str, data: bytes | None = None, headers: dict | None = None) -> str:
    h = {"User-Agent": _mod.UA, "Accept": "text/html,application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h)
    with opener.open(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


_mod.fetch_raw = fetch_raw

CACHE = _mod.CACHE
CATALOG = _mod.CATALOG
FITMENT_OUT = _mod.FITMENT_OUT
merge_into_catalog = _mod.merge_into_catalog
set_vehicle = _mod.set_vehicle
parse_products = _mod.parse_products
scrape_one_cat = _mod.scrape_one_cat

BRAND_ID = "0198e6ef1ed970239e0c4f3cb592c6be"
BRAND_NAME = "MERCEDES-BENZ"
MODEL_ID = "0198e6ef1ed970239e0c4f3cb68fdc0d"
MODEL_NAME = "123 Coupe (C123)"
TYPES = ROOT / f"stubs/vehicles/models/{MODEL_ID}/types.json"

PRIORITY_ENGINE_IDS = [
    "0198e6ef1ed970239e0c4f3cb6f71df9",
    "0198e6ef1ed970239e0c4f3cb789b6f4",
    "0198e6ef1ed970239e0c4f3cb888b4a4",
    "0198e6ef1ed970239e0c4f3cb939c17e",
    "0198e6ef1ed970239e0c4f3cb897c6b3",
    "0198e6ef1ed970239e0c4f3cb9f6e413",
    "0198e6ef1ed970239e0c4f3cba91ab9b",
    "0198e6ef1ed970239e0c4f3cb98462f7",
    "0198e6ef1ed970239e0c4f3cbb564239",
    "0198e6ef1ed970239e0c4f3cbb5b5ccf",
]

MUST_HAVE = [
    "/car-parts/starter-15051",
    "/car-parts/head-gasket-14819",
    "/car-parts/cylinder-head-gasket-set-14821",
    "/car-parts/rocker-cover-gasket-14818",
    "/car-parts/oil-filter-14843",
    "/car-parts/oil-filter-14739",
    "/car-parts/air-filter-14844",
    "/car-parts/fuel-filter-14845",
    "/car-parts/spark-plug-14901",
    "/car-parts/brake-pads-and-related-components-14672",
    "/car-parts/battery-15052",
]


def all_category_paths() -> list[str]:
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    paths = []
    seen = set()
    for c in cat.get("categories") or []:
        p = c.get("path")
        if p and p not in seen:
            seen.add(p)
            paths.append(p)
    # ensure must-haves first
    ordered = []
    for p in MUST_HAVE:
        if p in seen:
            ordered.append(p)
    for p in paths:
        if p not in ordered:
            ordered.append(p)
    return ordered


def engines_for_c123() -> list[dict]:
    types = json.loads(TYPES.read_text(encoding="utf-8"))
    out = []
    for rows in types.values():
        for e in rows:
            out.append(
                {
                    "brandId": BRAND_ID,
                    "brandName": BRAND_NAME,
                    "modelId": MODEL_ID,
                    "modelName": MODEL_NAME,
                    "engineId": e["id"],
                    "engineName": e["name"],
                }
            )
    rank = {eid: i for i, eid in enumerate(PRIORITY_ENGINE_IDS)}
    out.sort(key=lambda e: rank.get(e["engineId"], 100))
    return out


def build_model_aggregate(fitment: dict, engine_ids: list[str]) -> dict:
    by_cat: dict[str, list[str]] = {}
    products: list[str] = []
    seen_p = set()
    for eid in engine_ids:
        entry = fitment.get(eid) or {}
        if entry.get("aggregated"):
            continue
        for cat, paths in (entry.get("byCategory") or {}).items():
            bucket = by_cat.setdefault(cat, [])
            seen = set(bucket)
            for p in paths or []:
                if p not in seen:
                    bucket.append(p)
                    seen.add(p)
                if p not in seen_p:
                    products.append(p)
                    seen_p.add(p)
    return {
        "brandId": BRAND_ID,
        "brandName": BRAND_NAME,
        "modelId": MODEL_ID,
        "modelName": MODEL_NAME,
        "engineId": MODEL_ID,
        "engineName": "any",
        "products": products,
        "byCategory": by_cat,
        "ok": True,
        "aggregated": True,
    }


def save_fitment(fitment: dict, done_ids: list[str]):
    agg = build_model_aggregate(fitment, done_ids)
    fitment[MODEL_ID] = agg
    fitment[f"model:{MODEL_ID}"] = agg
    FITMENT_OUT.write_text(
        json.dumps(fitment, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def scrape_missing_for_engine(eng: dict, categories: list[str]) -> dict:
    """Resume: keep existing byCategory, scrape only missing / empty must-haves."""
    cache_file = CACHE / f"{eng['engineId']}.json"
    data = {
        "brandId": eng["brandId"],
        "brandName": eng["brandName"],
        "modelId": eng["modelId"],
        "modelName": eng["modelName"],
        "engineId": eng["engineId"],
        "engineName": eng["engineName"],
        "products": [],
        "productDetails": [],
        "byCategory": {},
        "ok": False,
    }
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    by_cat = dict(data.get("byCategory") or {})
    details = {r["path"]: r for r in (data.get("productDetails") or []) if r.get("path")}

    need = []
    for cat in categories:
        existing = by_cat.get(cat)
        # always refresh must-haves if empty/missing; scrape other missing keys
        if cat in MUST_HAVE:
            if not existing:
                need.append(cat)
        elif cat not in by_cat:
            need.append(cat)

    # Cap non-must scrape per run for runtime; must-haves always included
    must = [c for c in need if c in MUST_HAVE]
    other = [c for c in need if c not in MUST_HAVE]
    # scrape all missing for thoroughness (may take a while)
    todo = must + other

    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    ok = set_vehicle(opener, eng["engineId"])
    data["ok"] = ok
    if not ok:
        print(f"   set_vehicle failed {eng['engineName']}", flush=True)
        return data

    print(f"   scraping {len(todo)} missing cats ({len(must)} must-have)", flush=True)
    for i, cat in enumerate(todo, 1):
        try:
            html = fetch_raw(opener, "https://aateile.com" + cat)
            rows = parse_products(html, cat)
        except Exception as ex:
            if "404" not in str(ex):
                print(f"   cat err {cat}: {ex}", flush=True)
            rows = []
        by_cat[cat] = [r["path"] for r in rows]
        for r in rows:
            details[r["path"]] = r
        if i % 40 == 0:
            print(f"   … {i}/{len(todo)}", flush=True)
        time.sleep(0.02)

    products = list(details.keys())
    data.update(
        {
            "byCategory": by_cat,
            "productDetails": list(details.values()),
            "products": products,
            "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "ok": True,
        }
    )
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    cats = all_category_paths()
    engines = engines_for_c123()
    print(f"C123 fill: {len(engines)} engines × {len(cats)} catalog categories", flush=True)

    fitment = {}
    if FITMENT_OUT.exists():
        fitment = json.loads(FITMENT_OUT.read_text(encoding="utf-8"))

    details_by_engine: dict[str, list[dict]] = {}
    done_ids: list[str] = []

    for idx, eng in enumerate(engines, 1):
        t0 = time.time()
        data = scrape_missing_for_engine(eng, cats)
        fitment[eng["engineId"]] = {
            "brandId": data["brandId"],
            "brandName": data["brandName"],
            "modelId": data["modelId"],
            "modelName": data["modelName"],
            "engineId": data["engineId"],
            "engineName": data["engineName"],
            "products": data.get("products") or [],
            "byCategory": data.get("byCategory") or {},
            "ok": data.get("ok", False),
        }
        details_by_engine[eng["engineId"]] = data.get("productDetails") or []
        done_ids.append(eng["engineId"])
        bc = data.get("byCategory") or {}
        nonempty = sum(1 for v in bc.values() if v)
        starter = len(bc.get("/car-parts/starter-15051") or [])
        gasket = len(bc.get("/car-parts/head-gasket-14819") or [])
        print(
            f"  {idx}/{len(engines)} {eng['engineName'][:40]:40} "
            f"products={len(data.get('products') or []):4} nonempty={nonempty:3} "
            f"starter={starter} gasket={gasket} ({time.time()-t0:.1f}s)",
            flush=True,
        )
        save_fitment(fitment, done_ids)

    print("Merging products into catalog.json …", flush=True)
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog = merge_into_catalog(catalog, details_by_engine)
    catalog["fitment"] = fitment
    catalog["fitmentEngines"] = len(fitment)
    catalog["vehicleCategoryFill"] = {
        "focus": "MERCEDES-BENZ 123 Coupe (C123)",
        "engines": len(done_ids),
        "categories": len(cats),
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    CATALOG.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    save_fitment(fitment, done_ids)

    agg = fitment[MODEL_ID]
    print(
        "AGGREGATE any: products",
        len(agg["products"]),
        "starter",
        len(agg["byCategory"].get("/car-parts/starter-15051") or []),
        "gasket",
        len(agg["byCategory"].get("/car-parts/head-gasket-14819") or []),
        flush=True,
    )


if __name__ == "__main__":
    main()
