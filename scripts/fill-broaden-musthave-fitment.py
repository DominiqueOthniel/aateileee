#!/usr/bin/env python3
"""Broaden vehicle fitment: scrape deep must-have categories for more models.

Targets engines already in fitment.json that lack Starter/Head gasket keys,
plus a few extra popular models from stubs. Builds model-level "any" aggregates.
"""
from __future__ import annotations

import http.cookiejar
import importlib.util
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
spec = importlib.util.spec_from_file_location(
    "vehicle_cat_fill", ROOT / "scripts" / "scrape-vehicle-category-fill.py"
)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)

CACHE = mod.CACHE
CATALOG = mod.CATALOG
FITMENT_OUT = mod.FITMENT_OUT
merge_into_catalog = mod.merge_into_catalog
set_vehicle = mod.set_vehicle
parse_products = mod.parse_products

MUST = [
    "/car-parts/starter-15051",
    "/car-parts/head-gasket-14819",
    "/car-parts/cylinder-head-gasket-set-14821",
    "/car-parts/rocker-cover-gasket-14818",
    "/car-parts/alternator-15050",
    "/car-parts/radiator-14884",
    "/car-parts/water-pump-14881",
    "/car-parts/thermostat-14882",
    "/car-parts/ignition-coil-14902",
    "/car-parts/shock-absorber-15178",
    "/car-parts/oil-filter-14843",
    "/car-parts/air-filter-14844",
    "/car-parts/fuel-filter-14845",
    "/car-parts/spark-plug-14901",
    "/car-parts/battery-15052",
    "/car-parts/brake-pads-and-related-components-14672",
    "/car-parts/brake-discs-and-related-components-14677",
    "/car-parts/wiper-blade-14705",
]

# Extra popular models (brandId, modelId) to ensure coverage
EXTRA_MODELS = [
    ("0198e6ef075171e7b37c7f0c3233a512", "0198e6ef07537023bc2f34f4a7d35355"),  # AUDI 50
    ("0198e6ef26fa71f884d8b00908672f14", None),  # placeholder skipped
]


def fetch(opener, url: str) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": mod.UA, "Accept": "text/html"}
    )
    with opener.open(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def engines_needing_fill(fit: dict, limit: int = 24) -> list[dict]:
    out = []
    seen = set()
    for e in fit.values():
        if not isinstance(e, dict) or e.get("aggregated"):
            continue
        eid = e.get("engineId")
        if not eid or eid in seen or e.get("engineName") == "any":
            continue
        bc = e.get("byCategory") or {}
        if "/car-parts/starter-15051" in bc and "/car-parts/head-gasket-14819" in bc:
            # already has deep keys
            continue
        seen.add(eid)
        out.append(
            {
                "brandId": e.get("brandId") or "",
                "brandName": e.get("brandName") or "",
                "modelId": e.get("modelId") or "",
                "modelName": e.get("modelName") or "",
                "engineId": eid,
                "engineName": e.get("engineName") or "",
            }
        )
        if len(out) >= limit:
            break
    return out


def add_extra_from_stubs(existing: list[dict], limit_extra: int = 8) -> list[dict]:
    """Add first engine of a few popular stub models not already covered."""
    brands_path = ROOT / "stubs/vehicles/brands.json"
    if not brands_path.exists():
        return existing
    brands_raw = json.loads(brands_path.read_text(encoding="utf-8"))
    popular = brands_raw.get("Popular carmakers") or []
    have = {e["engineId"] for e in existing}
    have_models = {e["modelId"] for e in existing if e.get("modelId")}
    added = []
    for b in popular[:12]:
        mp = ROOT / f"stubs/vehicles/brands/{b['id']}/models.json"
        if not mp.exists():
            continue
        models = json.loads(mp.read_text(encoding="utf-8"))
        flat = []
        for rows in models.values():
            flat.extend(rows)
        for m in flat[:2]:
            if m["id"] in have_models:
                continue
            tp = ROOT / f"stubs/vehicles/models/{m['id']}/types.json"
            if not tp.exists():
                continue
            types = json.loads(tp.read_text(encoding="utf-8"))
            tflat = []
            for rows in types.values():
                tflat.extend(rows)
            if not tflat:
                continue
            e = tflat[0]
            if e["id"] in have:
                continue
            added.append(
                {
                    "brandId": b["id"],
                    "brandName": b["name"],
                    "modelId": m["id"],
                    "modelName": m["name"],
                    "engineId": e["id"],
                    "engineName": e["name"],
                }
            )
            have.add(e["id"])
            have_models.add(m["id"])
            if len(added) >= limit_extra:
                return existing + added
    return existing + added


def scrape_must(eng: dict) -> dict:
    cache = CACHE / f"{eng['engineId']}.json"
    data = {
        **eng,
        "byCategory": {},
        "productDetails": [],
        "products": [],
        "ok": False,
    }
    if cache.exists():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
        except Exception:
            pass
    by = dict(data.get("byCategory") or {})
    details = {r["path"]: r for r in (data.get("productDetails") or []) if r.get("path")}
    need = [c for c in MUST if not by.get(c)]
    if not need:
        data["ok"] = True
        return data

    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    if not set_vehicle(op, eng["engineId"]):
        print("  set_vehicle fail", eng["engineName"], flush=True)
        return data
    for cat in need:
        try:
            rows = parse_products(fetch(op, "https://aateile.com" + cat), cat)
        except Exception as ex:
            print("  err", cat, ex, flush=True)
            rows = []
        by[cat] = [r["path"] for r in rows]
        for r in rows:
            details[r["path"]] = r
        time.sleep(0.02)
    data.update(
        {
            "brandId": eng["brandId"],
            "brandName": eng["brandName"],
            "modelId": eng["modelId"],
            "modelName": eng["modelName"],
            "engineId": eng["engineId"],
            "engineName": eng["engineName"],
            "byCategory": by,
            "productDetails": list(details.values()),
            "products": list(details),
            "ok": True,
            "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    )
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def rebuild_model_aggregates(fit: dict) -> dict:
    by_model: dict[str, list[dict]] = {}
    for e in fit.values():
        if not isinstance(e, dict) or e.get("aggregated"):
            continue
        mid = e.get("modelId")
        if not mid or e.get("engineName") == "any":
            continue
        by_model.setdefault(mid, []).append(e)
    for mid, entries in by_model.items():
        by_cat: dict[str, list[str]] = {}
        products: list[str] = []
        seen = set()
        for e in entries:
            for cat, paths in (e.get("byCategory") or {}).items():
                bucket = by_cat.setdefault(cat, [])
                s = set(bucket)
                for p in paths or []:
                    if p not in s:
                        bucket.append(p)
                        s.add(p)
                    if p not in seen:
                        products.append(p)
                        seen.add(p)
        agg = {
            "brandId": entries[0].get("brandId"),
            "brandName": entries[0].get("brandName"),
            "modelId": mid,
            "modelName": entries[0].get("modelName"),
            "engineId": mid,
            "engineName": "any",
            "products": products,
            "byCategory": by_cat,
            "ok": True,
            "aggregated": True,
        }
        fit[mid] = agg
        fit[f"model:{mid}"] = agg
    return fit


def main():
    fit = json.loads(FITMENT_OUT.read_text(encoding="utf-8"))
    engines = engines_needing_fill(fit, limit=20)
    engines = add_extra_from_stubs(engines, limit_extra=10)
    # skip C123 engines (already full)
    engines = [
        e
        for e in engines
        if e.get("modelId") != "0198e6ef1ed970239e0c4f3cb68fdc0d"
    ]
    print(f"Broaden must-have: {len(engines)} engines × {len(MUST)} cats", flush=True)
    details_by = {}
    for idx, eng in enumerate(engines, 1):
        t0 = time.time()
        data = scrape_must(eng)
        fit[eng["engineId"]] = {
            "brandId": data.get("brandId"),
            "brandName": data.get("brandName"),
            "modelId": data.get("modelId"),
            "modelName": data.get("modelName"),
            "engineId": data.get("engineId"),
            "engineName": data.get("engineName"),
            "products": data.get("products") or [],
            "byCategory": data.get("byCategory") or {},
            "ok": data.get("ok", False),
        }
        details_by[eng["engineId"]] = data.get("productDetails") or []
        bc = data.get("byCategory") or {}
        print(
            f"  {idx}/{len(engines)} {eng['brandName'][:12]:12} {eng['modelName'][:22]:22} "
            f"starter={len(bc.get(MUST[0]) or [])} gasket={len(bc.get(MUST[1]) or [])} "
            f"({time.time()-t0:.1f}s)",
            flush=True,
        )
        if idx % 4 == 0:
            fit = rebuild_model_aggregates(fit)
            FITMENT_OUT.write_text(
                json.dumps(fit, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )

    fit = rebuild_model_aggregates(fit)
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog = merge_into_catalog(catalog, details_by)
    catalog["fitment"] = fit
    catalog["fitmentEngines"] = len(
        [k for k, v in fit.items() if isinstance(v, dict) and not v.get("aggregated")]
    )
    meta = dict(catalog.get("vehicleCategoryFill") or {})
    meta["broadenMustHave"] = {
        "engines": len(engines),
        "categories": len(MUST),
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    catalog["vehicleCategoryFill"] = meta
    CATALOG.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    FITMENT_OUT.write_text(
        json.dumps(fit, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        "done products",
        len(catalog["products"]),
        "fitment keys",
        len(fit),
        flush=True,
    )


if __name__ == "__main__":
    main()
