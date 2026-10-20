#!/usr/bin/env python3
"""Re-fetch the correct cover image for every catalog product from its PDP.

Prefer og:image and SKU-matching product-image URLs. Ignore related-product
gallery tiles (they caused hundreds of products to share one wrong ATE image).
"""
from __future__ import annotations

import html as HTML
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path("/agent/aateile-clone")
CATALOG = ROOT / "data" / "catalog.json"
MEDIA = ROOT / "media" / "product-covers"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
}
WORKERS = 24


def fetch(url: str, retries: int = 4) -> str:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def encode_url(url: str) -> str:
    if not url:
        return ""
    url = HTML.unescape(url).strip()
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(urllib.parse.unquote(parts.path), safe="/:@")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))


def normalize(url: str) -> str:
    if not url:
        return ""
    url = HTML.unescape(url).strip()
    if url.startswith("//"):
        url = "https:" + url
    if url.startswith("/media/"):
        url = "https://aateile.com" + url
    if url.startswith("media/"):
        url = "https://aateile.com/" + url
    # Drop cache-buster query on aateile.com media; keep S3 as-is but encode spaces
    if "aateile.com/media/" in url:
        url = url.split("?", 1)[0]
    return encode_url(url)


def is_chrome_logo(url: str) -> bool:
    low = (url or "").lower()
    return bool(re.search(r"logo-white|logo-black|header-logo|transparent-fr\.svg", low))


def sku_tokens(p: dict) -> list[str]:
    toks = []
    for k in ("articleNumber", "sku"):
        v = str(p.get(k) or "").strip()
        if v:
            toks.append(v)
    # path tail often equals internal id; article is better for S3 filenames
    name = p.get("name") or ""
    m = re.search(r"\b([A-Z0-9][A-Z0-9._-]{3,})\b", name)
    if m:
        toks.append(m.group(1))
    # unique preserve order
    out = []
    for t in toks:
        if t not in out:
            out.append(t)
    return out


def score_image(url: str, tokens: list[str]) -> int:
    if not url or is_chrome_logo(url):
        return -100
    fname = urllib.parse.unquote(url.rsplit("/", 1)[-1]).upper()
    score = 0
    if "aateile.s3." in url or "/media/" in url:
        score += 2
    if re.search(r"LOGO\.(PNG|JPE?G|WEBP)", fname):
        score -= 50
    for t in tokens:
        tu = t.upper().replace(" ", "")
        fu = fname.replace(" ", "").replace("%20", "")
        if tu and tu in fu:
            score += 100
        elif tu and tu.replace(".", "") in fu.replace(".", ""):
            score += 80
    # Prefer main cover sizes over tiny thumbs when SKU matches equally
    if re.search(r"/img/\d+/\d+/", url):
        score += 1
    return score


def main_product_html(html: str) -> str:
    """Cut related / cross-selling blocks so their product-image tags are ignored."""
    cut_at = len(html)
    for pat in (
        r'class="[^"]*cross-selling[^"]*"',
        r'class="[^"]*product-detail-tab-navigation[^"]*"',
        r'class="[^"]*cms-element-product-slider[^"]*"',
        r"id=\"relatedProducts\"",
        r"Related products",
        r"Customers also",
    ):
        m = re.search(pat, html, re.I)
        if m:
            cut_at = min(cut_at, m.start())
    # Keep head + product detail start
    start = 0
    m = re.search(r'class="[^"]*product-detail[^"]*"', html, re.I)
    if m:
        start = m.start()
    return html[start:cut_at] if start < cut_at else html[:cut_at]


def pick_cover(html: str, product: dict) -> str:
    tokens = sku_tokens(product)
    main = main_product_html(html)
    candidates: list[str] = []

    og = re.search(
        r'property="og:image"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:image"',
        html,
        re.I,
    )
    if og:
        u = normalize(og.group(1) or og.group(2))
        if u:
            candidates.append(u)

    for tag in re.findall(r"<img\b[^>]*>", main, re.I):
        if "product-image" not in tag and "gallery-slider" not in tag:
            continue
        m = re.search(r'\bsrc="([^"]+)"', tag, re.I) or re.search(
            r'\bdata-src="([^"]+)"', tag, re.I
        )
        if not m:
            continue
        u = normalize(m.group(1))
        if u and u not in candidates:
            candidates.append(u)

    if not candidates:
        # last resort: any product-image in full page with SKU score
        for tag in re.findall(r"<img\b[^>]*>", html, re.I):
            if "product-image" not in tag:
                continue
            m = re.search(r'\bsrc="([^"]+)"', tag, re.I)
            if not m:
                continue
            u = normalize(m.group(1))
            if u:
                candidates.append(u)

    if not candidates:
        return ""
    candidates.sort(key=lambda u: score_image(u, tokens), reverse=True)
    best = candidates[0]
    if score_image(best, tokens) < 0:
        return ""
    return best


def download_cover(url: str, product: dict) -> str | None:
    """Save cover under media/product-covers for stable local serving."""
    try:
        MEDIA.mkdir(parents=True, exist_ok=True)
        sku = re.sub(r"[^\w.-]+", "_", str(product.get("articleNumber") or product.get("sku") or "x"))
        pid = re.sub(r"[^\w.-]+", "_", product.get("path", "").strip("/"))
        ext = Path(urllib.parse.urlsplit(url).path).suffix.lower() or ".jpg"
        if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            ext = ".jpg"
        name = f"{sku}__{pid}{ext}"[:180]
        dest = MEDIA / name
        if dest.exists() and dest.stat().st_size > 500:
            return "/media/product-covers/" + name
        req = urllib.request.Request(url, headers={**UA, "Accept": "image/*,*/*"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        if len(data) < 200:
            return None
        dest.write_bytes(data)
        return "/media/product-covers/" + name
    except Exception:
        return None


def process_one(p: dict) -> tuple[str, str, str, str | None]:
    path = p["path"]
    try:
        html = fetch("https://aateile.com" + path)
        cover = pick_cover(html, p)
        local = download_cover(cover, p) if cover else None
        return path, cover, local or "", None
    except Exception as e:
        return path, "", "", str(e)


def http_ok(url: str) -> bool:
    if not url:
        return False
    try:
        req = urllib.request.Request(url if url.startswith("http") else "https://aateile.com" + url, method="HEAD", headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status < 400
    except Exception:
        try:
            full = url if url.startswith("http") else "https://aateile-clone.netlify.app" + url
            # for local paths just check file
            if url.startswith("/media/"):
                return (ROOT / url.lstrip("/")).exists()
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                return len(r.read(64)) > 0
        except Exception:
            return False


def main():
    t0 = time.time()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    products = catalog["products"]
    print(f"Fixing covers for {len(products)} products…", flush=True)
    by_path = {p["path"]: p for p in products}
    updated = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(process_one, p) for p in products]
        done = 0
        for fut in as_completed(futs):
            path, cover, local, err = fut.result()
            done += 1
            if err:
                errors += 1
            p = by_path.get(path)
            if p and cover:
                old = p.get("image")
                p["image"] = cover
                p["imageRemote"] = cover
                if local:
                    p["imageLocal"] = local
                    # Prefer remote CDN (already proven on official site); keep local as fallback
                if old != cover:
                    updated += 1
            if done % 100 == 0 or done == len(products):
                print(
                    f"  {done}/{len(products)} updated={updated} errors={errors}",
                    flush=True,
                )

    # Encode any remaining spaces; drop chrome logos
    for p in products:
        im = p.get("image") or ""
        if is_chrome_logo(im):
            p["image"] = ""
        elif im:
            p["image"] = normalize(im)

    # Second pass: anything still empty → search page by article number
    still = [p for p in products if not p.get("image")]
    print(f"Second pass via search for {len(still)} empty…", flush=True)
    filled2 = 0
    for p in still:
        q = urllib.parse.quote(str(p.get("articleNumber") or p.get("sku") or ""))
        if not q:
            continue
        try:
            html = fetch(f"https://aateile.com/search?search={q}")
            for tag in re.findall(r"<img\b[^>]*>", html, re.I):
                if "product-image" not in tag:
                    continue
                m = re.search(r'\bsrc="([^"]+)"', tag, re.I)
                if not m:
                    continue
                u = normalize(m.group(1))
                if u and score_image(u, sku_tokens(p)) >= 80:
                    p["image"] = u
                    p["imageRemote"] = u
                    filled2 += 1
                    break
            if not p.get("image"):
                # take first listing image for this exact product link
                for href, tag in re.findall(
                    r'href="([^"]+' + re.escape(p["path"]) + r'[^"]*)"[\s\S]{0,800}?<img\b([^>]*)>',
                    html,
                    re.I,
                ):
                    m = re.search(r'\bsrc="([^"]+)"', tag, re.I)
                    if m:
                        p["image"] = normalize(m.group(1))
                        filled2 += 1
                        break
        except Exception:
            pass
    print(f"  search-filled {filled2}", flush=True)

    # Validate HTTP for all remote images
    print("Validating image URLs…", flush=True)
    ok = 0
    broken = []
    with ThreadPoolExecutor(max_workers=40) as ex:
        futs = {ex.submit(http_ok, p.get("image") or ""): p for p in products}
        done = 0
        for fut in as_completed(futs):
            p = futs[fut]
            done += 1
            good = fut.result()
            if good:
                ok += 1
            else:
                broken.append(p["path"])
            if done % 500 == 0 or done == len(products):
                print(f"  validated {done}/{len(products)} ok={ok} broken={len(broken)}", flush=True)

    # Retry broken via PDP once more
    if broken:
        print(f"Retrying {len(broken)} broken…", flush=True)
        for path in list(broken):
            p = by_path[path]
            try:
                html = fetch("https://aateile.com" + path)
                cover = pick_cover(html, p)
                if cover and http_ok(cover):
                    p["image"] = cover
                    broken.remove(path)
                    ok += 1
            except Exception:
                pass

    with_img = sum(1 for p in products if p.get("image"))
    catalog["products"] = products
    catalog["imageEnrichment"] = {
        "withImage": with_img,
        "empty": len(products) - with_img,
        "httpOk": ok,
        "httpBroken": len(broken),
        "coveragePct": round(100 * ok / max(1, len(products)), 2),
        "updated": updated,
        "errors": errors,
        "elapsedSec": round(time.time() - t0, 1),
        "enrichedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": "pdp-og-sku-prefer-no-related",
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(catalog["imageEnrichment"], indent=2))
    if broken[:20]:
        print("still broken sample", broken[:20])
    # uniqueness
    from collections import Counter

    ctr = Counter(p.get("image") for p in products)
    print("most shared image count", ctr.most_common(3))


if __name__ == "__main__":
    main()
