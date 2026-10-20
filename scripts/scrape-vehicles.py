#!/usr/bin/env python3
"""Scrape full vehicle catalog from aateile.com into clone stubs."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE = "https://aateile.com"
OUT = Path(os.environ.get("AA_VEHICLE_OUT", "/agent/aateile-clone/stubs/vehicles"))
CACHE = Path(os.environ.get("AA_VEHICLE_CACHE", "/tmp/aa-vehicle-scrape"))
WORKERS = int(os.environ.get("AA_VEHICLE_WORKERS", "14"))
UA = {
    "Accept": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "Mozilla/5.0 (compatible; aateile-clone-vehicle-scrape/1.0)",
}


def fetch_json(url: str, retries: int = 4):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:
            last = e
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def slim_brand(b: dict) -> dict:
    return {
        "id": b["id"],
        "name": b.get("name") or b.get("code") or b["id"],
        "code": b.get("code"),
        "tecdocId": b.get("tecdocId"),
        "popular": bool(b.get("popular")),
        "active": bool(b.get("active")),
    }


def slim_model(m: dict) -> dict:
    out = {
        "id": m["id"],
        "name": m.get("name") or m["id"],
    }
    if m.get("yearFrom"):
        out["yearFrom"] = m["yearFrom"]
    if m.get("yearTo"):
        out["yearTo"] = m["yearTo"]
    if m.get("tecdocId") is not None:
        out["tecdocId"] = m["tecdocId"]
    if m.get("series"):
        out["series"] = m["series"]
    return out


def slim_type(t: dict) -> dict:
    out = {
        "id": t["id"],
        "name": t.get("name") or t["id"],
    }
    for k in ("enginePowerKw", "enginePowerHp", "yearFrom", "yearTo", "fuelType", "tecdocId"):
        if t.get(k) is not None:
            out[k] = t[k]
    return out


def slim_grouped(data: dict, slim_fn):
    if not isinstance(data, dict):
        return {}
    out = {}
    for group, rows in data.items():
        if not isinstance(rows, list):
            continue
        slim_rows = [slim_fn(x) for x in rows if isinstance(x, dict) and x.get("id")]
        if slim_rows:
            out[group] = slim_rows
    return out


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    print("Fetching brands…", flush=True)
    brands_raw = fetch_json(f"{BASE}/vehicles/brands")
    write_json(CACHE / "brands-raw.json", brands_raw)

    # Preserve official grouping; slim entries; de-dupe within groups
    brands_out = {}
    flat = []
    seen = set()
    for group, rows in brands_raw.items():
        slim_rows = []
        for b in rows or []:
            if not isinstance(b, dict) or not b.get("id"):
                continue
            sb = slim_brand(b)
            slim_rows.append(sb)
            if sb["id"] not in seen:
                seen.add(sb["id"])
                flat.append(sb)
        brands_out[group] = slim_rows

    write_json(OUT / "brands.json", brands_out)
    write_json(CACHE / "brands-flat.json", flat)
    print(f"Brands: {len(flat)} unique across {len(brands_out)} groups", flush=True)

    # Fetch models per brand
    models_dir = CACHE / "models-by-brand"
    models_dir.mkdir(exist_ok=True)

    def fetch_models(b):
        path = models_dir / f"{b['id']}.json"
        if path.exists() and path.stat().st_size > 2:
            try:
                return b["id"], json.loads(path.read_text()), None
            except Exception:
                pass
        try:
            data = slim_grouped(fetch_json(f"{BASE}/vehicles/brands/{b['id']}/models"), slim_model)
            write_json(path, data)
            return b["id"], data, None
        except Exception as e:
            return b["id"], {}, str(e)

    print(f"Fetching models for {len(flat)} brands ({WORKERS} workers)…", flush=True)
    brand_models = {}
    errors = []
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(fetch_models, b) for b in flat]
        for fut in as_completed(futs):
            bid, data, err = fut.result()
            brand_models[bid] = data
            done += 1
            if err:
                errors.append((bid, err))
            if done % 50 == 0 or done == len(flat):
                print(f"  models {done}/{len(flat)} errors={len(errors)}", flush=True)

    # Write stub model files + collect model ids
    # Clean old slug-based brand dirs that are not UUIDs? keep writing new ones
    model_ids = []
    model_to_brand = {}
    total_models = 0
    for bid, data in brand_models.items():
        write_json(OUT / "brands" / bid / "models.json", data)
        for rows in data.values():
            for m in rows:
                mid = m["id"]
                model_ids.append(mid)
                model_to_brand[mid] = bid
                total_models += 1

    write_json(CACHE / "model-to-brand.json", model_to_brand)
    print(f"Models: {total_models} (unique ids {len(model_to_brand)})", flush=True)

    # Flat models.json for /vehicles/models endpoint (grouped lightly)
    flat_models = {"All": []}
    for mid, mbrand in list(model_to_brand.items())[:5000]:
        # too big if we dump all names; keep minimal list from cache files
        pass
    # Build compact flat list from brand packs
    all_model_rows = []
    for bid, data in brand_models.items():
        for rows in data.values():
            all_model_rows.extend(rows)
    write_json(OUT / "models.json", {"All": all_model_rows[:1]})  # placeholder tiny; endpoint rarely used
    # Actually provide a useful compact index
    write_json(OUT / "models.json", {
        "count": len(all_model_rows),
        "note": "Use /vehicles/brands/{brandId}/models for full lists",
    })

    # Fetch types per model
    types_cache = CACHE / "types-by-model"
    types_cache.mkdir(exist_ok=True)

    def fetch_types(mid: str):
        path = types_cache / f"{mid}.json"
        if path.exists() and path.stat().st_size > 2:
            try:
                return mid, json.loads(path.read_text()), None
            except Exception:
                pass
        try:
            data = slim_grouped(fetch_json(f"{BASE}/vehicles/models/{mid}/types"), slim_type)
            write_json(path, data)
            return mid, data, None
        except Exception as e:
            return mid, {}, str(e)

    print(f"Fetching types for {len(model_ids)} models ({WORKERS} workers)…", flush=True)
    total_engines = 0
    type_errors = []
    done = 0
    empty_types = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(fetch_types, mid) for mid in model_ids]
        for fut in as_completed(futs):
            mid, data, err = fut.result()
            write_json(OUT / "models" / mid / "types.json", data)
            n = sum(len(v) for v in data.values()) if data else 0
            total_engines += n
            if not n:
                empty_types += 1
            if err:
                type_errors.append((mid, err))
            done += 1
            if done % 200 == 0 or done == len(model_ids):
                print(
                    f"  types {done}/{len(model_ids)} engines={total_engines} empty={empty_types} errors={len(type_errors)}",
                    flush=True,
                )

    # engines.json summary
    write_json(OUT / "engines.json", {
        "count": total_engines,
        "note": "Use /vehicles/models/{modelId}/types for full lists",
    })

    summary = {
        "brands": len(flat),
        "brandGroups": list(brands_out.keys()),
        "models": total_models,
        "engines": total_engines,
        "emptyTypeModels": empty_types,
        "modelFetchErrors": len(errors),
        "typeFetchErrors": len(type_errors),
        "elapsedSec": round(time.time() - t0, 1),
        "popularBrands": [b["name"] for b in flat if b.get("popular")],
    }
    write_json(CACHE / "summary.json", summary)
    write_json(OUT / "catalog-summary.json", summary)
    print(json.dumps(summary, indent=2))
    if errors[:5]:
        print("model errors sample", errors[:5])
    if type_errors[:5]:
        print("type errors sample", type_errors[:5])


if __name__ == "__main__":
    main()
