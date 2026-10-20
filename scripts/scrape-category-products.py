#!/usr/bin/env python3
"""Scrape aateile.com category listings into catalog.json product↔category maps."""
from __future__ import annotations

import html as HTML
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

CATALOG = Path("/agent/aateile-clone/data/catalog.json")
CACHE = Path("/tmp/aa-category-scrape")
WORKERS = 12
UA = {"User-Agent": "Mozilla/5.0 (compatible; aateile-clone-category-scrape/1.0)"}


def fetch(url: str, retries: int = 3) -> str:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def parse_listing(html: str, category_path: str) -> list[dict]:
    # Pair product cards: href + data-product-information nearby
    products = []
    # Collect product URLs from listing
    hrefs = []
    for h in re.findall(r'href="(https://aateile\.com/[^"#?]+|/[^"#?]+)"', html):
        if h.startswith("http"):
            path = h.replace("https://aateile.com", "")
        else:
            path = h
        path = path.rstrip("/")
        if not re.match(r"^/[A-Za-z0-9._%-]+/[A-Za-z0-9._%-]+$", path):
            continue
        brand = path.strip("/").split("/")[0].lower()
        if brand in {"account", "checkout", "wishlist", "search", "cart", "media", "assets", "js", "css", "data", "stubs", "widgets", "cookie", "fr", "de"}:
            continue
        if "car-parts" in path:
            continue
        hrefs.append(path)
    # unique preserve order
    seen = set()
    ordered = []
    for p in hrefs:
        if p in seen:
            continue
        seen.add(p)
        ordered.append(p)

    infos = re.findall(r'data-product-information="([^"]+)"', html)
    parsed_infos = []
    for raw in infos:
        try:
            parsed_infos.append(json.loads(HTML.unescape(raw)))
        except Exception:
            parsed_infos.append(None)

    names = re.findall(r'class="product-name[^"]*"[^>]*>(.*?)</a>', html, re.S)
    names = [re.sub("<[^>]+>", "", HTML.unescape(n)).strip() for n in names]
    names = [n for n in names if n]

    # Images near product boxes
    imgs = re.findall(
        r'class="product-image[^"]*".*?src="([^"]+)"|product-image-link[^>]*>\s*<img[^>]+src="([^"]+)"',
        html,
        re.S,
    )
    img_urls = []
    for a, b in imgs:
        img_urls.append(a or b)

    n = max(len(ordered), len(parsed_infos), len(names))
    for i in range(n):
        info = parsed_infos[i] if i < len(parsed_infos) else None
        path = ordered[i] if i < len(ordered) else None
        if not path and info and info.get("sku") and info.get("brand"):
            brand = re.sub(r"\s+", "-", str(info["brand"]).strip())
            path = f"/{brand}/{info['sku']}"
        if not path:
            continue
        name = (info or {}).get("name") or (names[i] if i < len(names) else path)
        brand = (info or {}).get("brand") or path.strip("/").split("/")[0]
        sku = (info or {}).get("sku") or path.strip("/").split("/")[-1]
        price = (info or {}).get("price")
        try:
            price = float(price) if price is not None else None
        except Exception:
            price = None
        image = ""
        if i < len(img_urls):
            image = img_urls[i]
            if image.startswith("http"):
                # keep relative media path when possible
                m = re.search(r"(media/.+?)(?:\?|$)", image)
                if m:
                    image = m.group(1)
        products.append(
            {
                "path": path,
                "name": name,
                "brand": brand,
                "sku": sku,
                "articleNumber": sku,
                "price": price,
                "currency": "EUR",
                "image": image,
                "category": category_path,
            }
        )
    return products


def scrape_one(cat: dict) -> tuple[str, list[dict], str | None]:
    path = cat["path"]
    cache = CACHE / (path.strip("/").replace("/", "__") + ".json")
    if cache.exists() and cache.stat().st_size > 2:
        try:
            return path, json.loads(cache.read_text()), None
        except Exception:
            pass
    try:
        html = fetch("https://aateile.com" + path)
        products = parse_listing(html, path)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(products, ensure_ascii=False), encoding="utf-8")
        return path, products, None
    except Exception as e:
        return path, [], str(e)


def merge_products(existing: list[dict], scraped: dict[str, list[dict]]) -> list[dict]:
    by_path: dict[str, dict] = {}
    for p in existing:
        if not p.get("path"):
            continue
        q = dict(p)
        cats = []
        if q.get("category"):
            cats.append(q["category"])
        for c in q.get("categories") or []:
            if c not in cats:
                cats.append(c)
        q["categories"] = cats
        by_path[q["path"]] = q

    for cat_path, rows in scraped.items():
        for p in rows:
            path = p["path"]
            if path in by_path:
                cur = by_path[path]
                cats = list(cur.get("categories") or [])
                if cat_path not in cats:
                    cats.append(cat_path)
                cur["categories"] = cats
                # Prefer exact scraped category as primary when missing/wrong
                if not cur.get("category") or cur.get("category") == cat_path:
                    cur["category"] = cat_path
                for k in ("name", "brand", "sku", "articleNumber", "price", "image"):
                    if p.get(k) and not cur.get(k):
                        cur[k] = p[k]
                if p.get("price") is not None:
                    cur["price"] = p["price"]
            else:
                q = dict(p)
                q["categories"] = [cat_path]
                by_path[path] = q
    return list(by_path.values())


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    categories = catalog.get("categories") or []
    print(f"Scraping {len(categories)} categories…", flush=True)

    scraped: dict[str, list[dict]] = {}
    errors = []
    done = 0
    nonempty = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(scrape_one, c) for c in categories]
        for fut in as_completed(futs):
            path, products, err = fut.result()
            scraped[path] = products
            done += 1
            if products:
                nonempty += 1
            if err:
                errors.append((path, err))
            if done % 25 == 0 or done == len(categories):
                print(
                    f"  {done}/{len(categories)} nonempty={nonempty} errors={len(errors)}",
                    flush=True,
                )

    products = merge_products(catalog.get("products") or [], scraped)
    catalog["products"] = products

    # category → count index for debugging
    counts = {p: len(rows) for p, rows in scraped.items()}
    summary = {
        "categories": len(categories),
        "categoriesWithProducts": nonempty,
        "products": len(products),
        "scrapeErrors": len(errors),
        "topCategories": sorted(counts.items(), key=lambda x: -x[1])[:20],
    }
    catalog["categoryScrape"] = {
        "categoriesWithProducts": nonempty,
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (CACHE / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2)[:2000])
    if errors[:5]:
        print("errors sample", errors[:5])


if __name__ == "__main__":
    main()
