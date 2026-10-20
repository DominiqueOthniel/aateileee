#!/usr/bin/env python3
"""Fill vehicle-scoped category listings from official aateile.com.

Scrapes official category pages with a vehicle session set, then writes
fitment.byCategory + merges products into catalog.json.
"""
from __future__ import annotations

import html as HTML
import http.cookiejar
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
CATALOG = ROOT / "data/catalog.json"
FITMENT_OUT = ROOT / "data/fitment.json"
SPARES = ROOT / "data/spares-categories.json"
BRANDS = ROOT / "stubs/vehicles/brands.json"
CACHE = Path("/tmp/aa-vehicle-cat-fill")
UA = "Mozilla/5.0 (compatible; aateile-clone-vehicle-cat-fill/1.1)"

FORCE_ENGINES = [
    {
        "brandId": "0198e6ef075171e7b37c7f0c3233a512",
        "brandName": "AUDI",
        "modelId": "0198e6ef07537023bc2f34f4a7d35355",
        "modelName": "50 (863)",
        "engineId": "0198e6ef07537023bc2f34f4aaaa47de",
        "engineName": "0.8",
    },
]

# High-traffic / previously empty categories (always scraped for every engine).
PRIORITY_EXTRA = [
    "/car-parts/lowering-springs-15912",
    "/car-parts/lowering-springs-15198",
    "/car-parts/shock-absorbers-coil-springs-leaf-springs-and-related-components-15177",
    "/car-parts/shock-absorber-15178",
    "/car-parts/performance-clutch-15902",
    "/car-parts/sports-air-filter-15909",
    "/car-parts/body-kit-15913",
    "/car-parts/damping-15176",
    "/car-parts/tuning-15901",
    "/car-parts/air-filter-14844",
    "/car-parts/oil-filter-14843",
    "/car-parts/oil-filter-14739",
    "/car-parts/cabin-filter-14846",
    "/car-parts/spark-plug-14901",
    "/car-parts/brake-pads-and-related-components-14672",
    "/car-parts/brake-discs-and-related-components-14677",
    "/car-parts/battery-15052",
    "/car-parts/wiper-blade-14705",
    "/car-parts/engine-oil-14650",
    "/car-parts/starter-15051",
    "/car-parts/head-gasket-14819",
    "/car-parts/cylinder-head-gasket-set-14821",
    "/car-parts/rocker-cover-gasket-14818",
]

PREFERRED = re.compile(
    r"\b(A3|A4|GOLF|POLO|PASSAT|TIGUAN|208|308|2008|CLIO|CAPTUR|CORSA|ASTRA|"
    r"FOCUS|FIESTA|GLA|SERIE 1|500|FABIA|OCTAVIA|YARIS|QASHQAI|50 \(863\))\b",
    re.I,
)

SKIP_BRANDS = {
    "account",
    "checkout",
    "wishlist",
    "search",
    "cart",
    "media",
    "assets",
    "js",
    "css",
    "data",
    "stubs",
    "widgets",
    "cookie",
    "fr",
    "de",
    "en",
}


def fetch_raw(opener, url: str, data: bytes | None = None, headers: dict | None = None) -> str:
    h = {"User-Agent": UA, "Accept": "text/html,application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h)
    with opener.open(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def set_vehicle(opener, engine_id: str) -> bool:
    body = json.dumps({"vehicleId": engine_id}).encode()
    try:
        text = fetch_raw(
            opener,
            "https://aateile.com/customer/vehicle",
            data=body,
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        return "success" in text and "true" in text
    except Exception as ex:
        print("  set_vehicle fail", engine_id, ex, flush=True)
        return False


def spares_paths(full: bool) -> list[str]:
    spares = json.loads(SPARES.read_text(encoding="utf-8"))
    paths: list[str] = []
    seen = set()

    def add(path: str):
        if path and path not in seen:
            seen.add(path)
            paths.append(path)

    for c in spares.get("allCategories") or []:
        kids = c.get("children") or []
        if full:
            add(c["path"])
        if kids:
            for ch in kids:
                add(ch["path"])
        else:
            add(c["path"])
    for p in PRIORITY_EXTRA:
        add(p)
    # Also include every catalog category path (Starter, Head gasket, etc.)
    try:
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        for c in catalog.get("categories") or []:
            add(c.get("path") or "")
    except Exception:
        pass
    return paths


def score_model(name: str) -> int:
    return 100 if PREFERRED.search(name or "") else 0


def popular_engines(limit_brands=10, models_per_brand=2, engines_per_model=1) -> list[dict]:
    brands_raw = json.loads(BRANDS.read_text(encoding="utf-8"))
    popular = brands_raw.get("Popular carmakers") or []
    engines = []
    for b in popular[:limit_brands]:
        mp = ROOT / f"stubs/vehicles/brands/{b['id']}/models.json"
        if not mp.exists():
            continue
        models = json.loads(mp.read_text(encoding="utf-8"))
        flat = []
        for rows in models.values():
            flat.extend(rows)
        flat.sort(key=lambda m: (-score_model(m.get("name", "")), m.get("name", "")))
        for m in flat[:models_per_brand]:
            tp = ROOT / f"stubs/vehicles/models/{m['id']}/types.json"
            if not tp.exists():
                continue
            types = json.loads(tp.read_text(encoding="utf-8"))
            tflat = []
            for rows in types.values():
                tflat.extend(rows)
            for e in tflat[:engines_per_model]:
                engines.append(
                    {
                        "brandId": b["id"],
                        "brandName": b["name"],
                        "modelId": m["id"],
                        "modelName": m["name"],
                        "engineId": e["id"],
                        "engineName": e["name"],
                    }
                )
    return engines


def existing_fitment_engines() -> list[dict]:
    if not FITMENT_OUT.exists():
        return []
    fit = json.loads(FITMENT_OUT.read_text(encoding="utf-8"))
    out = []
    for e in fit.values():
        if e.get("engineId"):
            out.append(
                {
                    "brandId": e.get("brandId", ""),
                    "brandName": e.get("brandName", ""),
                    "modelId": e.get("modelId", ""),
                    "modelName": e.get("modelName", ""),
                    "engineId": e["engineId"],
                    "engineName": e.get("engineName", ""),
                }
            )
    return out


def select_engines() -> list[dict]:
    by_id = {}
    # Force first
    for e in FORCE_ENGINES:
        by_id[e["engineId"]] = e
    for e in existing_fitment_engines() + popular_engines():
        by_id.setdefault(e["engineId"], e)
    # Cap total engines for runtime; FORCE always kept
    ordered = list(by_id.values())
    if len(ordered) > 18:
        ordered = ordered[:18]
    return ordered


def parse_products(html: str, category_path: str) -> list[dict]:
    hrefs = []
    for h in re.findall(r'href="(https://aateile\.com/[^"#?]+|/[^"#?]+)"', html):
        path = h.replace("https://aateile.com", "") if h.startswith("http") else h
        path = path.rstrip("/")
        if not re.match(r"^/[A-Za-z0-9._%-]+/[A-Za-z0-9._%-]+$", path):
            continue
        brand = path.strip("/").split("/")[0].lower()
        if brand in SKIP_BRANDS or "car-parts" in path:
            continue
        if path not in hrefs:
            hrefs.append(path)

    infos = []
    for raw in re.findall(r'data-product-information="([^"]+)"', html):
        try:
            infos.append(json.loads(HTML.unescape(raw)))
        except Exception:
            infos.append(None)

    names = re.findall(r'class="product-name[^"]*"[^>]*>(.*?)</a>', html, re.S)
    names = [re.sub("<[^>]+>", "", HTML.unescape(n)).strip() for n in names]
    names = [n for n in names if n]

    imgs = re.findall(
        r'class="product-image[^"]*".*?src="([^"]+)"|product-image-link[^>]*>\s*<img[^>]+src="([^"]+)"',
        html,
        re.S,
    )
    img_urls = [(a or b) for a, b in imgs]

    out = []
    for i, path in enumerate(hrefs):
        info = infos[i] if i < len(infos) else None
        name = (info or {}).get("name") or (names[i] if i < len(names) else path)
        brand = (info or {}).get("brand") or path.strip("/").split("/")[0]
        sku = (info or {}).get("sku") or path.strip("/").split("/")[-1]
        price = (info or {}).get("price")
        try:
            price = float(price) if price is not None else None
        except Exception:
            price = None
        image = ""
        if i < len(img_urls) and img_urls[i]:
            image = img_urls[i]
            if image.startswith("http"):
                m = re.search(r"(media/.+?)(?:\?|$)", image)
                if m:
                    image = "/" + m.group(1)
        out.append(
            {
                "path": path,
                "name": name,
                "brand": brand,
                "sku": sku,
                "articleNumber": sku,
                "price": price,
                "currency": "EUR",
                "image": image,
                "imageRemote": ("https://aateile.com" + image) if image.startswith("/") else image,
                "category": category_path,
                "categories": [category_path],
            }
        )
    return out


def scrape_one_cat(opener, cat: str) -> tuple[str, list[dict]]:
    try:
        html = fetch_raw(opener, "https://aateile.com" + cat)
        return cat, parse_products(html, cat)
    except Exception as ex:
        if "404" not in str(ex):
            print(f"   cat err {cat}: {ex}", flush=True)
        return cat, []


def scrape_engine(eng: dict, categories: list[str], full_cover: bool) -> dict:
    cache_file = CACHE / f"{eng['engineId']}.json"
    min_cover = len(categories) if full_cover else max(30, int(len(categories) * 0.8))
    if cache_file.exists() and cache_file.stat().st_size > 20:
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            by_cat = data.get("byCategory") or {}
            if len(by_cat) >= min_cover:
                return data
        except Exception:
            pass

    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    ok = set_vehicle(opener, eng["engineId"])
    by_cat: dict[str, list[str]] = {}
    products: list[dict] = []
    if ok:
        # Sequential is safer with session cookies; keep it snappy.
        for cat in categories:
            cpath, rows = scrape_one_cat(opener, cat)
            by_cat[cpath] = [r["path"] for r in rows]
            products.extend(rows)
            time.sleep(0.03)
    else:
        for cat in categories:
            by_cat[cat] = []

    seen = set()
    uniq = []
    for r in products:
        if r["path"] in seen:
            continue
        seen.add(r["path"])
        uniq.append(r)

    data = {
        "brandId": eng["brandId"],
        "brandName": eng["brandName"],
        "modelId": eng["modelId"],
        "modelName": eng["modelName"],
        "engineId": eng["engineId"],
        "engineName": eng["engineName"],
        "products": [r["path"] for r in uniq],
        "productDetails": uniq,
        "byCategory": by_cat,
        "ok": ok,
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def merge_into_catalog(catalog: dict, details_by_engine: dict[str, list[dict]]) -> dict:
    by_path = {p["path"]: p for p in catalog.get("products") or [] if p.get("path")}
    for eng_id, rows in details_by_engine.items():
        for r in rows:
            path = r["path"]
            if path in by_path:
                cur = by_path[path]
                cats = list(cur.get("categories") or [])
                for c in r.get("categories") or ([r["category"]] if r.get("category") else []):
                    if c and c not in cats:
                        cats.append(c)
                cur["categories"] = cats
                if r.get("category") and not cur.get("category"):
                    cur["category"] = r["category"]
                fit = set(cur.get("fitment") or [])
                fit.add(eng_id)
                cur["fitment"] = sorted(fit)
                if r.get("price") is not None:
                    cur["price"] = r["price"]
                if r.get("image") and not cur.get("image"):
                    cur["image"] = r["image"]
                if r.get("imageRemote") and not cur.get("imageRemote"):
                    cur["imageRemote"] = r["imageRemote"]
                if r.get("name") and (not cur.get("name") or cur["name"] == path):
                    cur["name"] = r["name"]
            else:
                q = dict(r)
                q["fitment"] = [eng_id]
                by_path[path] = q
    catalog["products"] = list(by_path.values())
    return catalog


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    # Full leaf cover for FORCE vehicle; priority+leaves for others
    full_cats = spares_paths(full=True)
    engines = select_engines()
    print(f"Vehicle×category fill: {len(engines)} engines; full cats={len(full_cats)}", flush=True)

    prior = {}
    if FITMENT_OUT.exists():
        try:
            prior = json.loads(FITMENT_OUT.read_text(encoding="utf-8"))
        except Exception:
            prior = {}

    fitment = dict(prior)
    details_by_engine: dict[str, list[dict]] = {}

    for idx, eng in enumerate(engines, 1):
        is_force = eng["engineId"] in {e["engineId"] for e in FORCE_ENGINES}
        cats = full_cats  # scrape full leaf set for every selected engine
        data = scrape_engine(eng, cats, full_cover=is_force)
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
        nonempty = sum(1 for v in (data.get("byCategory") or {}).values() if v)
        print(
            f"  {idx}/{len(engines)} {eng['brandName']} / {eng['modelName'][:28]} / {eng['engineName'][:18]} "
            f"→ {len(data.get('products') or [])} products, {nonempty} nonempty cats",
            flush=True,
        )

        # Persist incrementally so a mid-run kill still helps deploy
        if idx == 1 or idx == len(engines) or idx % 3 == 0:
            catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
            catalog = merge_into_catalog(catalog, details_by_engine)
            catalog["fitment"] = fitment
            catalog["fitmentEngines"] = len(fitment)
            catalog["vehicleCategoryFill"] = {
                "engines": idx,
                "categories": len(full_cats),
                "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            FITMENT_OUT.write_text(json.dumps(fitment, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            print(f"  checkpoint saved ({idx} engines, {len(catalog['products'])} products)", flush=True)

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog = merge_into_catalog(catalog, details_by_engine)
    catalog["fitment"] = fitment
    catalog["fitmentEngines"] = len(fitment)
    catalog["vehicleCategoryFill"] = {
        "engines": len(engines),
        "categories": len(full_cats),
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    FITMENT_OUT.write_text(json.dumps(fitment, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    audi = fitment.get("0198e6ef07537023bc2f34f4aaaa47de", {})
    by = audi.get("byCategory") or {}
    print("AUDI50 lowering", len(by.get("/car-parts/lowering-springs-15912") or []))
    print(
        "AUDI50 shock parent",
        len(by.get("/car-parts/shock-absorbers-coil-springs-leaf-springs-and-related-components-15177") or []),
    )
    print("AUDI50 brakes", len(by.get("/car-parts/brake-pads-and-related-components-14672") or []))
    print("products", len(catalog["products"]), "fitmentEngines", len(fitment))


if __name__ == "__main__":
    main()
