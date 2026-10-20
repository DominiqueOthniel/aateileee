#!/usr/bin/env python3
"""Detect brand-logo / wordmark covers and replace from aateile.com PDPs.

Faster path: JSON-LD + og:image only (no bulk S3 HEAD storms). S3 probe is
limited to ams-OSRAM and other must-fix paths. Clears logo-only covers so the
storefront shows a neutral placeholder instead of a blurry wordmark.
Also refreshes name / sku / articleNumber from JSON-LD.
"""
from __future__ import annotations

import hashlib
import html as HTML
import json
import re
import time
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
    "Accept": "text/html,application/xhtml+xml,image/*,*/*",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
}
WORKERS = 28
OSRAM_LOGO_SIZE = 4287
S3_BASE = "https://aateile.s3.eu-central-1.amazonaws.com/img"
LOGO_URL_RE = re.compile(
    r"(?:^|[/_-])LOGO(?:[._-]|$)|OSRAM_LOGO|logo-white|logo-black|header-logo|"
    r"transparent-fr\.svg|brand[_-]?logo|wordmark",
    re.I,
)
MUST = {
    "/ams-OSRAM/593443",
    "/ams-OSRAM/593445",
    "/ams-OSRAM/593449",
    "/ams-OSRAM/603524",
    "/ams-OSRAM/593446",
    "/ams-OSRAM/593447",
    "/ams-OSRAM/593448",
}


def fetch(url: str, retries: int = 3) -> bytes:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(0.3 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def fetch_text(url: str) -> str:
    return fetch(url).decode("utf-8", "replace")


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
    if "aateile.com/media/" in url:
        url = url.split("?", 1)[0]
    return encode_url(url)


def is_logo_url(url: str) -> bool:
    return bool(url and LOGO_URL_RE.search(url))


def local_path(url: str) -> Path | None:
    if not url:
        return None
    if url.startswith("/media/"):
        return ROOT / url.lstrip("/")
    if url.startswith("media/"):
        return ROOT / url
    return None


def osram_logo_md5() -> str | None:
    for p in [
        MEDIA / "OSR9006DWBRT-2HFB__ams-OSRAM_593443.jpg",
        MEDIA / "OSR9006DWNBSM-2HB__ams-OSRAM_593445.jpg",
    ]:
        if p.exists() and p.stat().st_size == OSRAM_LOGO_SIZE:
            return hashlib.md5(p.read_bytes()).hexdigest()
    return None


def is_bad_cover(p: dict, logo_md5: str | None) -> bool:
    for key in ("imageLocal", "image", "imageRemote"):
        u = p.get(key) or ""
        if is_logo_url(u):
            return True
        lp = local_path(u)
        if lp and lp.exists():
            sz = lp.stat().st_size
            if sz == OSRAM_LOGO_SIZE:
                return True
            if logo_md5 and sz < 8000 and hashlib.md5(lp.read_bytes()).hexdigest() == logo_md5:
                return True
    return False


def parse_jsonld(html: str) -> dict:
    out: dict = {}
    for block in re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.I | re.S,
    ):
        try:
            data = json.loads(block)
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for d in items:
            if not isinstance(d, dict):
                continue
            t = d.get("@type")
            types = t if isinstance(t, list) else [t]
            if "Product" not in (types or []) and "sku" not in d and "mpn" not in d:
                continue
            if d.get("name"):
                out["name"] = HTML.unescape(str(d["name"])).strip()
            if d.get("sku"):
                out["sku"] = str(d["sku"]).strip()
            if d.get("mpn"):
                out["mpn"] = str(d["mpn"]).strip()
            img = d.get("image")
            urls: list[str] = []
            if isinstance(img, str):
                urls = [img]
            elif isinstance(img, list):
                urls = [x for x in img if isinstance(x, str)]
            out["images"] = [normalize(u) for u in urls if u]
            if out.get("name") or out.get("images"):
                return out
    return out


def og_image(html: str) -> str:
    m = re.search(
        r'property="og:image"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:image"',
        html,
        re.I,
    )
    return normalize((m.group(1) or m.group(2)) if m else "")


def article_from_html(html: str) -> str:
    for pat in (
        r'data-product-number="([^"]+)"',
        r'product-detail-ordernumber[^>]*>\s*([^<]+)',
    ):
        m = re.search(pat, html, re.I)
        if m:
            return HTML.unescape(m.group(1)).strip()
    return ""


def head_ok(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD", headers=UA)
        with urllib.request.urlopen(req, timeout=15) as r:
            cl = int(r.headers.get("Content-Length") or 0)
            return r.status < 400 and cl > 2000 and cl != OSRAM_LOGO_SIZE
    except Exception:
        return False


def s3_probe(mpn: str, sku: str) -> list[str]:
    tokens = []
    for t in (mpn, sku):
        t = (t or "").strip()
        if not t:
            continue
        tokens.append(t)
        if t.upper().startswith("OSR") and len(t) > 3:
            tokens.append(t[3:])
    seen = []
    for t in tokens:
        if t and t not in seen:
            seen.append(t)
    found = []
    for t in seen:
        for size in ("67", "144", "351", "403"):
            for suf in ("_1.JPG", "_2.JPG", "_3.JPG"):
                u = f"{S3_BASE}/{size}/{size}/{urllib.parse.quote(t)}{suf}"
                if head_ok(u):
                    found.append(u)
            if found:
                return found
    return found


def pick_images(html: str, meta: dict, allow_s3: bool) -> list[str]:
    out: list[str] = []
    for u in meta.get("images") or []:
        if u and not is_logo_url(u) and u not in out:
            out.append(u)
    og = og_image(html)
    if og and not is_logo_url(og) and og not in out:
        out.append(og)
    if not out and allow_s3:
        out = s3_probe(meta.get("mpn") or "", meta.get("sku") or "")
    return out


def download_cover(url: str, product: dict, logo_md5: str | None) -> str | None:
    try:
        MEDIA.mkdir(parents=True, exist_ok=True)
        sku = re.sub(
            r"[^\w.-]+",
            "_",
            str(product.get("articleNumber") or product.get("sku") or "x"),
        )
        pid = re.sub(r"[^\w.-]+", "_", product.get("path", "").strip("/"))
        ext = Path(urllib.parse.urlsplit(url).path).suffix.lower() or ".jpg"
        if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            ext = ".jpg"
        name = f"{sku}__{pid}{ext}"[:180]
        dest = MEDIA / name
        data = fetch(url)
        if len(data) < 2000 or len(data) == OSRAM_LOGO_SIZE:
            return None
        if logo_md5 and hashlib.md5(data).hexdigest() == logo_md5:
            return None
        dest.write_bytes(data)
        return "/media/product-covers/" + name
    except Exception:
        return None


def clear_logos(p: dict, logo_md5: str | None) -> None:
    for key in ("image", "imageLocal", "imageRemote"):
        u = p.get(key) or ""
        if is_logo_url(u):
            p[key] = ""
            continue
        lp = local_path(u)
        if lp and lp.exists():
            sz = lp.stat().st_size
            if sz == OSRAM_LOGO_SIZE or (
                logo_md5 and sz < 8000 and hashlib.md5(lp.read_bytes()).hexdigest() == logo_md5
            ):
                p[key] = ""
    if isinstance(p.get("images"), list):
        p["images"] = [u for u in p["images"] if u and not is_logo_url(u)]


def process_one(p: dict, logo_md5: str | None) -> dict:
    path = p["path"]
    allow_s3 = path in MUST
    result = {"path": path, "ok": False, "cover": "", "local": "", "meta": {}, "err": ""}
    try:
        html = fetch_text("https://aateile.com" + path)
        meta = parse_jsonld(html)
        art = article_from_html(html)
        if art:
            meta.setdefault("mpn", art)
        images = pick_images(html, meta, allow_s3=allow_s3)
        result["meta"] = {
            "name": meta.get("name"),
            "sku": meta.get("sku"),
            "mpn": meta.get("mpn") or art,
            "images": images,
        }
        if images:
            cover = images[0]
            local = download_cover(
                cover,
                {
                    **p,
                    "sku": meta.get("sku") or p.get("sku"),
                    "articleNumber": meta.get("mpn") or art or p.get("articleNumber"),
                },
                logo_md5,
            )
            result["cover"] = cover
            result["local"] = local or ""
        result["ok"] = True
    except Exception as e:
        result["err"] = str(e)
    return result


def main():
    t0 = time.time()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    products = catalog["products"]
    by_path = {p["path"]: p for p in products}
    logo_md5 = osram_logo_md5()
    print(f"OSRAM logo md5: {logo_md5}", flush=True)

    flagged = [p for p in products if is_bad_cover(p, logo_md5)]
    for path in MUST:
        p = by_path.get(path)
        if p and p not in flagged:
            flagged.append(p)
    print(f"Flagged {len(flagged)} / {len(products)}", flush=True)

    updated = cleared = meta_fixed = errors = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(process_one, p, logo_md5) for p in flagged]
        done = 0
        for fut in as_completed(futs):
            r = fut.result()
            done += 1
            p = by_path[r["path"]]
            if r["err"]:
                errors += 1
            meta = r.get("meta") or {}
            if meta.get("name") and meta["name"] != p.get("name"):
                p["name"] = meta["name"]
                meta_fixed += 1
            if meta.get("sku"):
                p["sku"] = meta["sku"]
            if meta.get("mpn"):
                p["articleNumber"] = meta["mpn"]
            if r["ok"] and r["cover"]:
                p["image"] = r["local"] or r["cover"]
                p["imageRemote"] = r["cover"]
                if r["local"]:
                    p["imageLocal"] = r["local"]
                if meta.get("images"):
                    p["images"] = meta["images"][:6]
                updated += 1
            elif r["ok"]:
                clear_logos(p, logo_md5)
                cleared += 1
            if done % 50 == 0 or done == len(flagged):
                print(
                    f"  {done}/{len(flagged)} updated={updated} cleared={cleared} "
                    f"meta={meta_fixed} errors={errors}",
                    flush=True,
                )

    # Force-fix true 9006DWNBSM
    p603 = by_path.get("/ams-OSRAM/603524")
    if p603:
        cover = f"{S3_BASE}/67/67/9006DWNBSM-2HB_1.JPG"
        local = download_cover(cover, p603, logo_md5)
        p603["name"] = "ams-OSRAM 9006DWNBSM-2HB Bulb, worklight"
        p603["sku"] = "OSR9006DWNBSM-2HB"
        p603["articleNumber"] = "9006DWNBSM-2HB"
        p603["image"] = local or cover
        p603["imageRemote"] = cover
        if local:
            p603["imageLocal"] = local
        p603["images"] = [
            f"{S3_BASE}/67/67/9006DWNBSM-2HB_1.JPG",
            f"{S3_BASE}/67/67/9006DWNBSM-2HB_2.JPG",
            f"{S3_BASE}/67/67/9006DWNBSM-2HB_3.JPG",
        ]

    # Strip any remaining logo URLs catalog-wide
    stripped = 0
    for p in products:
        before = (p.get("image"), p.get("imageLocal"), p.get("imageRemote"))
        clear_logos(p, logo_md5)
        if not p.get("image"):
            for u in (p.get("imageRemote"), *(p.get("images") or [])):
                if u and not is_logo_url(u):
                    p["image"] = u
                    break
        if (p.get("image"), p.get("imageLocal"), p.get("imageRemote")) != before:
            stripped += 1

    catalog["products"] = products
    catalog["logoImageFix"] = {
        "flagged": len(flagged),
        "updatedWithRealPhoto": updated,
        "clearedLogoOnly": cleared,
        "metaFixed": meta_fixed,
        "strippedRemaining": stripped,
        "errors": errors,
        "elapsedSec": round(time.time() - t0, 1),
        "fixedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    CATALOG.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps(catalog["logoImageFix"], indent=2))
    for path in sorted(MUST):
        p = by_path[path]
        print(
            f"VERIFY {path}: name={p.get('name')!r} art={p.get('articleNumber')} "
            f"image={(p.get('image') or '')[:90]}"
        )


if __name__ == "__main__":
    main()
