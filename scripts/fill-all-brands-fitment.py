#!/usr/bin/env python3
"""Wave-based fitment fill for ALL brands/models (resumable).

Wave A: 1–2 engines per model × priority deep categories (must-have + top deep).
Wave B: remaining catalog category paths for engines already scraped in Wave A.

State: /tmp/aa-fitment-all/state.json
Caches: /tmp/aa-vehicle-cat-fill/{engineId}.json
Writes: data/fitment.json incrementally; catalog merge on checkpoints / end.
"""
from __future__ import annotations

import argparse
import http.cookiejar
import importlib.util
import json
import os
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
STATE_DIR = Path("/tmp/aa-fitment-all")
STATE_FILE = STATE_DIR / "state.json"
PROGRESS_LOG = STATE_DIR / "progress.log"

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

UA = "Mozilla/5.0 (compatible; aateile-clone-all-brands-fitment/1.0)"
mod.UA = UA

PRIORITY_CATS = [
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
    "/car-parts/oil-filter-14739",
    "/car-parts/air-filter-14844",
    "/car-parts/fuel-filter-14845",
    "/car-parts/spark-plug-14901",
    "/car-parts/battery-15052",
    "/car-parts/brake-pads-and-related-components-14672",
    "/car-parts/brake-discs-and-related-components-14677",
    "/car-parts/engine-oil-14650",
    "/car-parts/cabin-filter-14846",
    "/car-parts/pollen-filter-14753",
    "/car-parts/lowering-springs-15912",
    "/car-parts/performance-clutch-15902",
    "/car-parts/sports-air-filter-15909",
    "/car-parts/timing-belt-14793",
    "/car-parts/timing-chain-14794",
    "/car-parts/clutch-kit-14727",
    "/car-parts/drive-shaft-15090",
    "/car-parts/wheel-bearing-15120",
    "/car-parts/control-arm-15140",
    "/car-parts/stabilizer-link-15150",
    "/car-parts/tie-rod-end-15160",
    "/car-parts/lambda-sensor-14940",
    "/car-parts/glow-plug-14910",
    "/car-parts/injector-14930",
    "/car-parts/fuel-pump-14920",
    "/car-parts/turbocharger-14915",
    "/car-parts/egr-valve-14840",
    "/car-parts/headlight-15870",
    "/car-parts/tail-light-15880",
]

_lock = threading.Lock()
_fit_lock = threading.Lock()


def log(msg: str):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {msg}"
    print(msg, flush=True)
    with open(PROGRESS_LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def fetch(opener, url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with opener.open(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"doneEngines": {}, "wave": "A", "stats": {}}


def save_state(state: dict):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)


def all_catalog_paths() -> list[str]:
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    paths = []
    seen = set()
    for c in cat.get("categories") or []:
        p = c.get("path")
        if p and p not in seen:
            seen.add(p)
            paths.append(p)
    return paths


def wave_a_categories() -> list[str]:
    """Priority deep categories only (Wave B expands to full catalog tree)."""
    all_paths = set(all_catalog_paths())
    out = []
    seen = set()
    for p in PRIORITY_CATS:
        if p in all_paths and p not in seen:
            out.append(p)
            seen.add(p)
    # Keep any PRIORITY paths even if not yet in catalog.json (official may still list them).
    for p in PRIORITY_CATS:
        if p not in seen:
            out.append(p)
            seen.add(p)
    return out


def pick_engines_for_model(types: dict, max_per_model: int = 2) -> list[dict]:
    """Pick up to one engine per fuel group (Diesel/Petrol/…)."""
    picked = []
    for fuel, rows in types.items():
        if not isinstance(rows, list) or not rows:
            continue
        # prefer mid-list common engines: take first
        e = rows[0]
        picked.append(e)
        if len(picked) >= max_per_model:
            break
    if not picked:
        # flat fallback
        for rows in types.values():
            if isinstance(rows, list):
                for e in rows:
                    picked.append(e)
                    break
            if picked:
                break
    return picked[:max_per_model]


def enumerate_targets(max_per_model: int = 2) -> list[dict]:
    brands_raw = json.loads((ROOT / "stubs/vehicles/brands.json").read_text(encoding="utf-8"))
    popular_ids = []
    brands = {}
    for b in brands_raw.get("Popular carmakers") or []:
        if isinstance(b, dict) and b.get("id"):
            brands[b["id"]] = b
            popular_ids.append(b["id"])
    for k, v in brands_raw.items():
        if k == "Popular carmakers":
            continue
        if isinstance(v, list):
            for b in v:
                if isinstance(b, dict) and b.get("id"):
                    brands[b["id"]] = b
    # popular first, then alpha by name
    ordered = list(dict.fromkeys(popular_ids + sorted(brands.keys(), key=lambda i: (brands[i].get("name") or "").lower())))
    targets = []
    for bid in ordered:
        b = brands[bid]
        mp = ROOT / f"stubs/vehicles/brands/{bid}/models.json"
        if not mp.exists():
            continue
        try:
            models = json.loads(mp.read_text(encoding="utf-8"))
        except Exception:
            continue
        flat = []
        for rows in models.values():
            if isinstance(rows, list):
                flat.extend(rows)
        for m in flat:
            mid = m.get("id")
            if not mid:
                continue
            tp = ROOT / f"stubs/vehicles/models/{mid}/types.json"
            if not tp.exists():
                continue
            try:
                types = json.loads(tp.read_text(encoding="utf-8"))
            except Exception:
                continue
            for e in pick_engines_for_model(types, max_per_model=max_per_model):
                targets.append(
                    {
                        "brandId": bid,
                        "brandName": b.get("name") or "",
                        "modelId": mid,
                        "modelName": m.get("name") or "",
                        "engineId": e["id"],
                        "engineName": e.get("name") or "",
                    }
                )
    return targets


def scrape_engine_cats(eng: dict, categories: list[str]) -> dict:
    cache_file = CACHE / f"{eng['engineId']}.json"
    data = {
        **eng,
        "byCategory": {},
        "productDetails": [],
        "products": [],
        "ok": False,
    }
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    by = dict(data.get("byCategory") or {})
    details = {r["path"]: r for r in (data.get("productDetails") or []) if r.get("path")}
    need = [c for c in categories if c not in by]
    if not need and data.get("ok"):
        return data

    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    ok = False
    last_err = ""
    for attempt in range(4):
        try:
            ok = set_vehicle(opener, eng["engineId"])
            if ok:
                break
            last_err = "set_vehicle_returned_false"
        except Exception as ex:
            last_err = str(ex)
            ok = False
        time.sleep(0.4 * (attempt + 1))
    if not ok:
        data["ok"] = False
        data["error"] = f"set_vehicle_failed:{last_err}"
        return data

    for cat in need:
        try:
            html = fetch(opener, "https://aateile.com" + cat)
            rows = parse_products(html, cat)
            by[cat] = [r["path"] for r in rows]
            for r in rows:
                details[r["path"]] = r
        except urllib.error.HTTPError as ex:
            if ex.code == 404:
                by[cat] = []
            else:
                by[cat] = []
        except Exception:
            by[cat] = []
        time.sleep(0.01)

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
            "products": list(details.keys()),
            "ok": True,
            "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    )
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def rebuild_aggregates(fit: dict) -> dict:
    by_model: dict[str, list[dict]] = {}
    for e in list(fit.values()):
        if not isinstance(e, dict) or e.get("aggregated"):
            continue
        if e.get("engineName") == "any":
            continue
        mid = e.get("modelId")
        if not mid:
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


def merge_fitment_entry(fit: dict, data: dict):
    eid = data["engineId"]
    fit[eid] = {
        "brandId": data.get("brandId"),
        "brandName": data.get("brandName"),
        "modelId": data.get("modelId"),
        "modelName": data.get("modelName"),
        "engineId": eid,
        "engineName": data.get("engineName"),
        "products": data.get("products") or [],
        "byCategory": data.get("byCategory") or {},
        "ok": data.get("ok", False),
    }


def write_fitment(fit: dict):
    FITMENT_OUT.write_text(
        json.dumps(fit, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def checkpoint_catalog(fit: dict, details_batch: dict[str, list], meta_extra: dict):
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    if details_batch:
        catalog = merge_into_catalog(catalog, details_batch)
    catalog["fitment"] = fit
    catalog["fitmentEngines"] = sum(
        1
        for v in fit.values()
        if isinstance(v, dict) and not v.get("aggregated") and v.get("engineName") != "any"
    )
    meta = dict(catalog.get("vehicleCategoryFill") or {})
    meta.update(meta_extra)
    catalog["vehicleCategoryFill"] = meta
    CATALOG.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def coverage_stats(fit: dict) -> dict:
    engines = [
        v
        for v in fit.values()
        if isinstance(v, dict) and not v.get("aggregated") and v.get("engineName") != "any"
    ]
    brands = {e.get("brandId") for e in engines if e.get("brandId")}
    models = {e.get("modelId") for e in engines if e.get("modelId")}
    nonempty_keys = 0
    cat_keys = 0
    for e in engines:
        bc = e.get("byCategory") or {}
        cat_keys += len(bc)
        nonempty_keys += sum(1 for v in bc.values() if v)
    return {
        "engines": len(engines),
        "brands": len(brands),
        "models": len(models),
        "byCategoryKeys": cat_keys,
        "nonemptyByCategoryKeys": nonempty_keys,
        "fitmentKeys": len(fit),
    }


def popular_brand_names() -> list[str]:
    brands_raw = json.loads((ROOT / "stubs/vehicles/brands.json").read_text(encoding="utf-8"))
    names = []
    for b in brands_raw.get("Popular carmakers") or []:
        if isinstance(b, dict) and b.get("name"):
            names.append(b["name"])
    return names


def clear_failed_wave_a(state: dict) -> int:
    """Clear waveA markers for engines that failed set_vehicle / scrape."""
    done = state.setdefault("doneEngines", {})
    n = 0
    for eid, marker in list(done.items()):
        if marker.get("waveA") and not marker.get("ok"):
            marker = dict(marker)
            marker.pop("waveA", None)
            done[eid] = marker
            n += 1
            # drop empty cache so retry re-scrapes
            cache_file = CACHE / f"{eid}.json"
            if cache_file.exists():
                try:
                    data = json.loads(cache_file.read_text(encoding="utf-8"))
                    if not data.get("ok") or not (data.get("byCategory") or {}):
                        cache_file.unlink(missing_ok=True)
                except Exception:
                    cache_file.unlink(missing_ok=True)
    return n


def run_wave(
    wave: str,
    workers: int,
    max_engines: int | None,
    max_per_model: int,
    popular_first: bool = False,
    skip_catalog_merge: bool = False,
    catalog_every: int = 800,
):
    state = load_state()
    done = state.setdefault("doneEngines", {})
    if wave == "A":
        categories = wave_a_categories()
        targets = enumerate_targets(max_per_model=max_per_model)
        log(f"Wave A targets={len(targets)} cats={len(categories)} workers={workers}")
    else:
        categories = all_catalog_paths()
        # Wave B: expand categories for engines already present in fitment
        targets = []
        fit0 = json.loads(FITMENT_OUT.read_text(encoding="utf-8")) if FITMENT_OUT.exists() else {}
        for eid, e in fit0.items():
            if not isinstance(e, dict) or e.get("aggregated") or e.get("engineName") == "any":
                continue
            if not e.get("engineId"):
                continue
            if not e.get("ok") and not (e.get("byCategory") or {}):
                continue
            targets.append(
                {
                    "brandId": e.get("brandId") or "",
                    "brandName": e.get("brandName") or "",
                    "modelId": e.get("modelId") or "",
                    "modelName": e.get("modelName") or "",
                    "engineId": e["engineId"],
                    "engineName": e.get("engineName") or "",
                }
            )
        if popular_first:
            pop = {n.upper() for n in popular_brand_names()}
            targets.sort(
                key=lambda t: (
                    0 if (t.get("brandName") or "").upper() in pop else 1,
                    (t.get("brandName") or "").lower(),
                    (t.get("modelName") or "").lower(),
                )
            )
        log(
            f"Wave B targets={len(targets)} cats={len(categories)} workers={workers} "
            f"popular_first={popular_first}"
        )

    # skip completed for this wave
    pending = []
    for t in targets:
        eid = t["engineId"]
        marker = done.get(eid) or {}
        if wave == "A" and marker.get("waveA"):
            continue
        if wave == "B" and marker.get("waveB"):
            continue
        pending.append(t)
    skipped = len(targets) - len(pending)
    if max_engines:
        pending = pending[:max_engines]
    log(f"Pending {len(pending)} (already done {skipped}, total targets {len(targets)})")

    fit = {}
    if FITMENT_OUT.exists():
        fit = json.loads(FITMENT_OUT.read_text(encoding="utf-8"))

    details_batch: dict[str, list] = {}
    completed = 0
    errors = 0
    t0 = time.time()

    def work(eng):
        return scrape_engine_cats(eng, categories)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(work, eng): eng for eng in pending}
        for fut in as_completed(futs):
            eng = futs[fut]
            try:
                data = fut.result()
            except Exception as ex:
                errors += 1
                log(f"FAIL {eng['brandName']}/{eng['modelName']}: {ex}")
                continue
            with _fit_lock:
                merge_fitment_entry(fit, data)
                details_batch[eng["engineId"]] = data.get("productDetails") or []
                # Only mark wave complete when scrape succeeded
                marker = {
                    **(done.get(eng["engineId"]) or {}),
                    "ok": data.get("ok", False),
                    "cats": len(data.get("byCategory") or {}),
                    "nonempty": sum(1 for v in (data.get("byCategory") or {}).values() if v),
                    "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
                if data.get("ok"):
                    marker[f"wave{wave}"] = True
                else:
                    marker.pop(f"wave{wave}", None)
                done[eng["engineId"]] = marker
                completed += 1
                # Wave B is slow per engine (full catalog tree) — checkpoint often
                ck_every = 1 if wave == "B" else 25
                if completed % ck_every == 0 or completed == len(pending):
                    fit = rebuild_aggregates(fit)
                    write_fitment(fit)
                    state["doneEngines"] = done
                    state["wave"] = wave
                    state["stats"] = coverage_stats(fit)
                    save_state(state)
                    rate = completed / max(1, time.time() - t0)
                    log(
                        f"checkpoint {completed}/{len(pending)} errors={errors} "
                        f"{rate:.2f} eng/s nonempty={marker.get('nonempty')} "
                        f"cats={marker.get('cats')} "
                        f"{eng.get('brandName')}/{eng.get('modelName')} "
                        f"stats={state['stats']}"
                    )
                if (
                    not skip_catalog_merge
                    and completed > 0
                    and completed % catalog_every == 0
                ):
                    checkpoint_catalog(
                        fit,
                        details_batch,
                        {
                            "allBrandsWave": wave,
                            "completed": completed,
                            "pending": len(pending),
                            "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                            "stats": coverage_stats(fit),
                        },
                    )
                    details_batch = {}
                    log("catalog checkpoint written")

    fit = rebuild_aggregates(fit)
    write_fitment(fit)
    if not skip_catalog_merge:
        checkpoint_catalog(
            fit,
            details_batch,
            {
                "allBrandsWave": wave,
                "completed": completed,
                "pending": len(pending),
                "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "stats": coverage_stats(fit),
            },
        )
    else:
        # Still stamp light meta onto catalog without full product merge when possible
        try:
            catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
            catalog["fitment"] = fit
            catalog["fitmentEngines"] = coverage_stats(fit)["engines"]
            meta = dict(catalog.get("vehicleCategoryFill") or {})
            meta.update(
                {
                    "allBrandsWave": wave,
                    "completed": completed,
                    "skipCatalogMerge": True,
                    "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "stats": coverage_stats(fit),
                }
            )
            catalog["vehicleCategoryFill"] = meta
            CATALOG.write_text(
                json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
        except Exception as ex:
            log(f"catalog light update skipped: {ex}")
    state["doneEngines"] = done
    state["wave"] = wave
    state["stats"] = coverage_stats(fit)
    save_state(state)
    log(f"Wave {wave} finished completed={completed} errors={errors} stats={state['stats']}")
    return state["stats"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wave", choices=["A", "B", "AB", "retry"], default="A")
    ap.add_argument("--workers", type=int, default=int(os.environ.get("FITMENT_WORKERS", "12")))
    ap.add_argument("--max-engines", type=int, default=0, help="0 = all")
    ap.add_argument("--max-per-model", type=int, default=1)
    ap.add_argument("--popular-first", action="store_true")
    ap.add_argument(
        "--skip-catalog-merge",
        action="store_true",
        help="Write fitment only; light catalog stamp (faster Wave B)",
    )
    ap.add_argument("--catalog-every", type=int, default=800)
    args = ap.parse_args()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    max_e = args.max_engines or None

    if args.wave == "retry":
        state = load_state()
        n = clear_failed_wave_a(state)
        save_state(state)
        log(f"Cleared {n} failed Wave A markers; re-running Wave A for those + any pending")
        run_wave(
            "A",
            workers=args.workers,
            max_engines=max_e,
            max_per_model=args.max_per_model,
            skip_catalog_merge=args.skip_catalog_merge,
            catalog_every=args.catalog_every,
        )
        return

    if args.wave in ("A", "AB"):
        run_wave(
            "A",
            workers=args.workers,
            max_engines=max_e,
            max_per_model=args.max_per_model,
            skip_catalog_merge=args.skip_catalog_merge,
            catalog_every=args.catalog_every,
        )
    if args.wave in ("B", "AB"):
        run_wave(
            "B",
            workers=args.workers,
            max_engines=max_e,
            max_per_model=args.max_per_model,
            popular_first=args.popular_first or True,
            skip_catalog_merge=args.skip_catalog_merge,
            catalog_every=args.catalog_every,
        )


if __name__ == "__main__":
    main()

