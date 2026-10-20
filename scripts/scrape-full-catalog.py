#!/usr/bin/env python3
"""Full aateile.com catalog crawl: all /spares categories × pagination → catalog.json."""
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
CACHE = Path("/tmp/aa-full-catalog")
WORKERS = 20
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
}
BAD_BRANDS = {
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
}


def fetch(url: str, retries: int = 4) -> str:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def slug_to_name(slug: str) -> str:
    base = re.sub(r"-\d+$", "", slug)
    return base.replace("-", " ").strip().title()


def normalize_image_url(src: str) -> str:
    """Prefer absolute stable product image URLs (aateile.com media or S3)."""
    if not src:
        return ""
    src = HTML.unescape(src).strip()
    if not src or src.startswith("data:"):
        return ""
    low = src.lower()
    if "logo" in low and ("transparent" in low or "header" in low or "brand" in low):
        # Keep brand tile logos from S3 when they are the product art; drop site chrome logos
        if "logo-white" in low or "logo-black" in low or "header-logo" in low:
            return ""
    if src.startswith("//"):
        src = "https:" + src
    if src.startswith("/media/"):
        return "https://aateile.com" + src.split("?", 1)[0]
    if src.startswith("media/"):
        return "https://aateile.com/" + src.split("?", 1)[0]
    if src.startswith("https://aateile.com/media/"):
        return src.split("?", 1)[0]
    if "aateile.s3." in src or src.startswith("https://aateile.com/"):
        return src.split("?", 1)[0] if "aateile.com/media/" in src else src
    if src.startswith("http"):
        return src
    return src


def extract_listing_images(html: str) -> list[str]:
    """Pull cover images from listing cards (src often appears before class)."""
    imgs: list[str] = []
    for tag in re.findall(r"<img\b[^>]*>", html, re.I):
        if "product-image" not in tag:
            continue
        m = re.search(r'\bsrc="([^"]+)"', tag, re.I)
        if not m:
            m = re.search(r'\bdata-src="([^"]+)"', tag, re.I)
        if not m:
            continue
        url = normalize_image_url(m.group(1))
        if url:
            imgs.append(url)
    return imgs


def parse_products(html: str, category_path: str) -> list[dict]:
    hrefs = []
    for h in re.findall(r'href="(https://aateile\.com/[^"#?]+|/[^"#?]+)"', html):
        path = h.replace("https://aateile.com", "") if h.startswith("http") else h
        path = path.rstrip("/")
        if not re.match(r"^/[A-Za-z0-9._%-]+/[A-Za-z0-9._%-]+$", path):
            continue
        brand = path.strip("/").split("/")[0].lower()
        if brand in BAD_BRANDS or "car-parts" in path:
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
    imgs = extract_listing_images(html)
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
        image = imgs[i] if i < len(imgs) else ""
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
                "category": category_path,
                "categories": [category_path],
            }
        )
    return out


def max_page_and_total(html: str) -> tuple[int, int | None]:
    # Prefer Pagination nav last-page link (avoids random ?p= elsewhere in the DOM)
    max_p = 1
    nav = re.search(
        r'<nav[^>]*aria-label="[^"]*[Pp]agination[^"]*"[\s\S]*?</nav>',
        html,
    )
    if nav:
        pages = [int(x) for x in re.findall(r"[?&]p=(\d+)", nav.group(0))]
        pages += [int(x) for x in re.findall(r'data-page="(\d+)"', nav.group(0))]
        if pages:
            max_p = max(pages)
    else:
        pages = [int(x) for x in re.findall(r"[?&]p=(\d+)", html)]
        max_p = max(pages) if pages else 1
    tot = None
    m = re.search(r"([\d\s\u00a0\.]+)\s*products?", html, re.I)
    if m:
        try:
            tot = int(re.sub(r"\D", "", m.group(1)))
        except Exception:
            tot = None
    # Sanity: if total known, clamp pages to ceil(total/24)+1
    if tot and tot > 0:
        from math import ceil

        est = max(1, ceil(tot / 24))
        if max_p > est + 2:
            max_p = est
    return max(1, max_p), tot


def discover_categories() -> tuple[list[dict], list[dict]]:
    html = fetch("https://aateile.com/spares")
    paths = sorted(set(re.findall(r"(/car-parts/[a-z0-9-]+)", html)))
    cats = []
    for path in paths:
        slug = path.rsplit("/", 1)[-1]
        m = re.search(r"-(\d+)$", slug)
        cats.append(
            {
                "path": path,
                "slug": slug,
                "name": slug_to_name(slug),
                "id": m.group(1) if m else slug,
            }
        )
    # Top categories: first prominent named links under Top categories section
    top = []
    # Prefer known hub names appearing early
    for name, path in re.findall(
        r'href="(?:https://aateile\.com)?(/car-parts/[^"]+)"[^>]*>\s*([^<]{3,60})\s*<',
        html,
    ):
        label = HTML.unescape(name if False else path)  # placeholder
    # Extract from text anchors near top
    for href, label in re.findall(
        r'href="(?:https://aateile\.com)?(/car-parts/[a-z0-9-]+)"[^>]*>\s*([^<]{3,70})\s*<',
        html,
    ):
        lab = HTML.unescape(label).strip()
        if not lab or lab.lower() in {"overview", "log in", "sign up"}:
            continue
        if any(t["path"] == href for t in top):
            continue
        top.append({"path": href, "name": lab})
        if len(top) >= 30:
            break
    return cats, top


def fetch_category_page(cat_path: str, page: int) -> tuple[str, int, list[dict], str | None]:
    cache = CACHE / "pages" / f"{cat_path.strip('/').replace('/', '__')}__p{page}.json"
    if cache.exists() and cache.stat().st_size > 2:
        try:
            data = json.loads(cache.read_text())
            return cat_path, page, data.get("products") or [], None
        except Exception:
            pass
    url = "https://aateile.com" + cat_path + (f"?p={page}" if page > 1 else "")
    try:
        html = fetch(url)
        products = parse_products(html, cat_path)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"products": products}, ensure_ascii=False), encoding="utf-8")
        return cat_path, page, products, None
    except Exception as e:
        return cat_path, page, [], str(e)


def probe_category(cat: dict) -> tuple[str, int, int | None, list[dict], str | None]:
    path = cat["path"]
    meta_cache = CACHE / "meta" / (path.strip("/").replace("/", "__") + ".json")
    if meta_cache.exists():
        try:
            meta = json.loads(meta_cache.read_text())
            # still need page 1 products if not cached as page
            _, _, products, err = fetch_category_page(path, 1)
            return path, meta.get("maxPage", 1), meta.get("total"), products, err
        except Exception:
            pass
    url = "https://aateile.com" + path
    try:
        html = fetch(url)
        max_p, total = max_page_and_total(html)
        products = parse_products(html, path)
        meta_cache.parent.mkdir(parents=True, exist_ok=True)
        meta_cache.write_text(
            json.dumps({"maxPage": max_p, "total": total}, ensure_ascii=False), encoding="utf-8"
        )
        # also cache page 1
        p1 = CACHE / "pages" / f"{path.strip('/').replace('/', '__')}__p1.json"
        p1.parent.mkdir(parents=True, exist_ok=True)
        p1.write_text(json.dumps({"products": products}, ensure_ascii=False), encoding="utf-8")
        return path, max_p, total, products, None
    except Exception as e:
        return path, 1, None, [], str(e)


def merge_products(existing: list[dict], incoming: list[dict]) -> dict[str, dict]:
    by: dict[str, dict] = {}
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
        by[q["path"]] = q
    for p in incoming:
        path = p.get("path")
        if not path:
            continue
        if path in by:
            cur = by[path]
            cats = list(cur.get("categories") or [])
            for c in p.get("categories") or []:
                if c not in cats:
                    cats.append(c)
            if p.get("category") and p["category"] not in cats:
                cats.append(p["category"])
            cur["categories"] = cats
            if not cur.get("category") and cats:
                cur["category"] = cats[0]
            for k in ("name", "brand", "sku", "articleNumber"):
                if p.get(k) and not cur.get(k):
                    cur[k] = p[k]
            if p.get("image"):
                cur_img = cur.get("image") or ""
                if not cur_img or "logo-white" in cur_img or cur_img.startswith("media/"):
                    cur["image"] = p["image"]
                elif not cur_img.startswith("http") and p["image"].startswith("http"):
                    cur["image"] = p["image"]
            if p.get("price") is not None:
                cur["price"] = p["price"]
            # preserve fitment
        else:
            q = dict(p)
            if not q.get("categories"):
                q["categories"] = [q["category"]] if q.get("category") else []
            by[path] = q
    return by


def scrape_home_bestsellers() -> list[dict]:
    html = fetch("https://aateile.com/")
    return parse_products(html, "/car-parts/auto-detailing-15928")


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    print("Discovering categories from /spares…", flush=True)
    cats, top = discover_categories()
    print(f"  {len(cats)} categories, {len(top)} top links", flush=True)
    catalog["categories"] = cats
    catalog["topCategories"] = top[:24]

    # Probe all categories for page counts
    print("Probing category page counts…", flush=True)
    jobs = []  # (path, page)
    scraped_products: list[dict] = []
    errors = []
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(probe_category, c) for c in cats]
        for fut in as_completed(futs):
            path, max_p, total, products, err = fut.result()
            scraped_products.extend(products)
            done += 1
            if err:
                errors.append((path, err))
            for p in range(2, max_p + 1):
                jobs.append((path, p))
            if done % 50 == 0 or done == len(cats):
                print(
                    f"  probed {done}/{len(cats)} extra_pages={len(jobs)} errors={len(errors)}",
                    flush=True,
                )

    print(f"Fetching {len(jobs)} additional listing pages…", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(fetch_category_page, path, page) for path, page in jobs]
        for fut in as_completed(futs):
            path, page, products, err = fut.result()
            scraped_products.extend(products)
            done += 1
            if err:
                errors.append((f"{path}?p={page}", err))
            if done % 100 == 0 or done == len(jobs):
                print(
                    f"  pages {done}/{len(jobs)} products_so_far={len(scraped_products)} errors={len(errors)}",
                    flush=True,
                )

    try:
        scraped_products.extend(scrape_home_bestsellers())
    except Exception as e:
        errors.append(("home", str(e)))

    # Preserve existing fitment annotations
    old_fit = {p["path"]: p.get("fitment") for p in catalog.get("products") or [] if p.get("fitment")}
    by = merge_products(catalog.get("products") or [], scraped_products)
    for path, fit in old_fit.items():
        if path in by and fit:
            by[path]["fitment"] = fit

    catalog["products"] = list(by.values())
    catalog["fullCatalogScrape"] = {
        "categories": len(cats),
        "products": len(catalog["products"]),
        "pagesFetched": len(jobs) + len(cats),
        "errors": len(errors),
        "elapsedSec": round(time.time() - t0, 1),
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (CACHE / "summary.json").write_text(
        json.dumps(catalog["fullCatalogScrape"], indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(catalog["fullCatalogScrape"], indent=2))
    if errors[:8]:
        print("errors sample", errors[:8])


if __name__ == "__main__":
    main()
