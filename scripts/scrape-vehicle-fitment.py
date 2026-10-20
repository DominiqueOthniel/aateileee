#!/usr/bin/env python3
"""Scrape vehicle-session listings for popular modern engines → data/fitment.json + catalog merge."""
from __future__ import annotations

import html as HTML
import http.cookiejar
import json
import re
import time
import urllib.request
from pathlib import Path

CATALOG = Path("/agent/aateile-clone/data/catalog.json")
BRANDS = Path("/agent/aateile-clone/stubs/vehicles/brands.json")
FITMENT_OUT = Path("/agent/aateile-clone/data/fitment.json")
CACHE = Path("/tmp/aa-fitment-scrape-v2")
UA = "Mozilla/5.0 (compatible; aateile-clone-fitment/1.1)"

SEED_CATEGORIES = [
    "/car-parts/air-filter-14844",
    "/car-parts/oil-filter-14845",
    "/car-parts/spark-plug-14901",
    "/car-parts/brake-discs-and-related-components-14677",
    "/car-parts/battery-15052",
    "/car-parts/engine-oil-14650",
    "/car-parts/wiper-blade-14705",
    "/car-parts/cabin-filter-14846",
]

PREFERRED = re.compile(
    r"\b(A3|A4|A6|Q3|Q5|GOLF|POLO|PASSAT|TIGUAN|308|208|3008|2008|CLIO|MEGANE|CAPTUR|"
    r"CORSA|ASTRA|MOKKA|FOCUS|FIESTA|KUGA|PUMA|CLASSE A|CLASSE C|GLA|SERIE 1|SERIE 3|"
    r"SERIE 5|OCTAVIA|FABIA|KAROQ|PANDA|TIPO|500|YARIS|COROLLA|RAV4|JUKE|QASHQAI|MICRA)\b",
    re.I,
)


def opener_with_cookies():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj)), cj


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
    except Exception:
        return False


def parse_products(html: str, category_path: str) -> list[dict]:
    hrefs = []
    for h in re.findall(r'href="(https://aateile\.com/[^"#?]+|/[^"#?]+)"', html):
        path = h.replace("https://aateile.com", "") if h.startswith("http") else h
        path = path.rstrip("/")
        if not re.match(r"^/[A-Za-z0-9._%-]+/[A-Za-z0-9._%-]+$", path):
            continue
        brand = path.strip("/").split("/")[0].lower()
        if brand in {"account", "checkout", "wishlist", "search", "cart", "media", "assets", "js", "css", "data", "stubs", "widgets"}:
            continue
        if "car-parts" in path:
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
        out.append(
            {
                "path": path,
                "name": name,
                "brand": brand,
                "sku": sku,
                "articleNumber": sku,
                "price": price,
                "currency": "EUR",
                "image": "",
                "category": category_path,
                "categories": [category_path],
            }
        )
    return out


def score_model(name: str) -> int:
    return 100 if PREFERRED.search(name or "") else 0


def popular_engines(limit_brands: int = 10, models_per_brand: int = 2, engines_per_model: int = 1):
    brands_raw = json.loads(BRANDS.read_text())
    popular = brands_raw.get("Popular carmakers") or []
    engines = []
    for b in popular[:limit_brands]:
        mp = Path(f"/agent/aateile-clone/stubs/vehicles/brands/{b['id']}/models.json")
        if not mp.exists():
            continue
        models = json.loads(mp.read_text())
        flat = []
        for rows in models.values():
            flat.extend(rows)
        flat.sort(key=lambda m: (-score_model(m.get("name", "")), m.get("name", "")))
        picked = flat[:models_per_brand]
        for m in picked:
            tp = Path(f"/agent/aateile-clone/stubs/vehicles/models/{m['id']}/types.json")
            if not tp.exists():
                continue
            types = json.loads(tp.read_text())
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


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CATALOG.read_text())
    cat_paths = {c["path"] for c in catalog.get("categories") or []}
    seeds = [p for p in SEED_CATEGORIES if p in cat_paths] or SEED_CATEGORIES
    engines = popular_engines()
    print(f"Fitment v2: {len(engines)} engines × {len(seeds)} categories", flush=True)
    for e in engines:
        print(f"  plan {e['brandName']} | {e['modelName'][:40]} | {e['engineName'][:30]}", flush=True)

    fitment = {}
    by_path = {p["path"]: p for p in catalog.get("products") or [] if p.get("path")}

    for idx, eng in enumerate(engines, 1):
        cache_file = CACHE / f"{eng['engineId']}.json"
        if cache_file.exists():
            data = json.loads(cache_file.read_text())
        else:
            opener, _ = opener_with_cookies()
            ok = set_vehicle(opener, eng["engineId"])
            products = []
            by_cat = {}
            if ok:
                for cat in seeds:
                    try:
                        html = fetch(opener, "https://aateile.com" + cat)
                        rows = parse_products(html, cat)
                        by_cat[cat] = [r["path"] for r in rows]
                        for r in rows:
                            products.append(r)
                        time.sleep(0.12)
                    except Exception as ex:
                        by_cat[cat] = []
                        print("   cat err", cat, ex, flush=True)
            # unique paths preserve order
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
            }
            cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            time.sleep(0.15)
        fitment[eng["engineId"]] = {
            k: data[k]
            for k in ("brandId", "brandName", "modelId", "modelName", "engineId", "engineName", "products", "byCategory", "ok")
            if k in data
        }
        # merge product details into catalog
        for r in data.get("productDetails") or []:
            path = r["path"]
            if path in by_path:
                cur = by_path[path]
                cats = list(cur.get("categories") or [])
                if r.get("category") and r["category"] not in cats:
                    cats.append(r["category"])
                cur["categories"] = cats
                fit = set(cur.get("fitment") or [])
                fit.add(eng["engineId"])
                cur["fitment"] = sorted(fit)
                if r.get("price") is not None:
                    cur["price"] = r["price"]
            else:
                q = dict(r)
                q["fitment"] = [eng["engineId"]]
                by_path[path] = q
        print(
            f"  {idx}/{len(engines)} {eng['brandName']} / {eng['modelName'][:28]} / {eng['engineName'][:18]} → {len(data.get('products') or [])}",
            flush=True,
        )

    catalog["products"] = list(by_path.values())
    catalog["fitment"] = fitment
    catalog["fitmentEngines"] = len(fitment)
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    FITMENT_OUT.write_text(json.dumps(fitment, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # overlap check across brands
    by_brand = {}
    for e in fitment.values():
        by_brand.setdefault(e["brandName"], set()).update(e.get("products") or [])
    brands = list(by_brand)
    print("products", len(catalog["products"]), "fitmentEngines", len(fitment))
    if len(brands) >= 2:
        a, b = brands[0], brands[1]
        print("overlap", a, b, len(by_brand[a] & by_brand[b]), "of", len(by_brand[a]), len(by_brand[b]))


if __name__ == "__main__":
    main()
