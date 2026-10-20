#!/usr/bin/env python3
"""Local static server with SPA routes + analytics JSON store (mirrors Netlify function)."""
import hashlib
import http.server
import json
import os
import random
import string
import time
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8765"))
ANALYTICS_DIR = ROOT / ".data" / "analytics"
SETTINGS_FILE = ROOT / ".data" / "settings-contact.json"
PASSWORD_HASH_FILE = ROOT / ".data" / "admin-password-hash.json"
DEFAULT_HASH = "8a3290ab5d1c5d79c50819359d7208c47404f0d57609ba502358f626fccdc52e"
FIXED_WHATSAPP = {
    "whatsappDigits": "33644684920",
    "whatsappDisplay": "+33 6 44 68 49 20",
}
DEFAULT_EMAIL = "aateilepieceauto1@gmail.com"
MAX_DAY_EVENTS = 4000
ALLOWED = {
    "page_view",
    "search",
    "add_to_cart",
    "whatsapp_order",
    "find_parts",
    "language",
}

STUBS = {
    "/widgets/checkout/info": (
        "text/html; charset=utf-8",
        '<span class="cart-item-count header-cart-badge" data-cart-item-count="0"></span><span class="header-cart-total" data-aa-cart-total>€0.00</span>',
    ),
    "/vehicles/brands": ("application/json", None),
    "/vehicles/models": ("application/json", None),
    "/vehicles/engines": ("application/json", None),
    "/customer/vehicle": ("application/json", "null"),
    "/autoexpert/aesession": ("application/json", "{}"),
    "/cookie/offcanvas": (
        "text/html; charset=utf-8",
        '<div class="offcanvas-body">Cookie settings are unavailable in this local clone.</div>',
    ),
    "/cookie/groups": ("application/json", "[]"),
    "/cookie/consent-offcanvas": ("text/html; charset=utf-8", "<div></div>"),
}

FILE_STUBS = {
    "/checkout/offcanvas": ROOT / "stubs/checkout/offcanvas.html",
    "/checkout/line-item/add": ROOT / "stubs/checkout/line-item-add.json",
    "/vehicles/brands": ROOT / "stubs/vehicles/brands.json",
    "/vehicles/models": ROOT / "stubs/vehicles/models.json",
    "/vehicles/engines": ROOT / "stubs/vehicles/engines.json",
}

SPA_PREFIXES = (
    "/car-parts",
    "/spares",
    "/spare-parts",
    "/pieces",
    "/pieces-auto",
    "/checkout",
    "/cart",
    "/account",
    "/wishlist",
    "/search",
    "/find-parts",
    "/fr",
    "/de",
    "/contact-us",
    "/delivery",
    "/payment-methods",
    "/privacy-policy",
    "/terms-conditions",
    "/right-of-withdrawal",
    "/cookie-settings",
    "/beware-of-fraud",
    "/information-on-the-disposal-of-used-oil",
)


def sha256(text: str) -> str:
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()


def expected_hash() -> str:
    # Blob/file hash wins so local password changes work without restarting env
    if PASSWORD_HASH_FILE.exists():
        try:
            data = json.loads(PASSWORD_HASH_FILE.read_text(encoding="utf-8"))
            h = str(data.get("hash") or "").lower()
            if len(h) == 64 and all(c in "0123456789abcdef" for c in h):
                return h
        except Exception:
            pass
    if os.environ.get("AA_ADMIN_PASSWORD"):
        return sha256(os.environ["AA_ADMIN_PASSWORD"])
    return (os.environ.get("AA_ADMIN_PASSWORD_HASH") or DEFAULT_HASH).lower()


def day_key(dt=None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%d")


def days_back(n: int):
    now = datetime.now(timezone.utc)
    return [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


def read_day(day: str):
    path = ANALYTICS_DIR / f"{day}.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def write_day(day: str, events):
    ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)
    (ANALYTICS_DIR / f"{day}.json").write_text(
        json.dumps(events, ensure_ascii=False), encoding="utf-8"
    )


def normalize_event(raw, meta=None):
    meta = meta or {}
    typ = str((raw or {}).get("type") or "")[:40]
    if typ not in ALLOWED:
        return None
    payload = (raw or {}).get("payload")
    if not isinstance(payload, dict):
        payload = {}
    rid = (
        f"{int(time.time() * 1000):x}-"
        + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    )
    return {
        "id": rid,
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "type": typ,
        "path": str((raw or {}).get("path") or meta.get("path") or "/")[:300],
        "payload": {
            "q": str(payload["q"])[:120] if payload.get("q") is not None else None,
            "sku": str(payload["sku"])[:80] if payload.get("sku") is not None else None,
            "name": str(payload["name"])[:160] if payload.get("name") is not None else None,
            "lang": str(payload["lang"])[:12] if payload.get("lang") is not None else None,
            "qty": int(payload.get("qty") or 1) if payload.get("qty") is not None else None,
            "source": str(payload["source"])[:40] if payload.get("source") is not None else None,
            "vid": str(payload["vid"])[:64] if payload.get("vid") is not None else None,
        },
        "ref": str((raw or {}).get("ref") or meta.get("ref") or "")[:300],
        "ua": str(meta.get("ua") or "")[:180],
    }


def summarize(events):
    now = time.time()
    today = day_key()
    week_start = now - 7 * 86400
    pageviews_today = 0
    pageviews_week = 0
    visitors_today = set()
    visitors_week = set()
    cart_adds = 0
    whatsapp = 0
    searches = 0
    find_parts = 0
    pages = {}
    recent = []

    for ev in events:
        try:
            t = datetime.fromisoformat(str(ev.get("ts", "")).replace("Z", "+00:00")).timestamp()
        except Exception:
            t = 0
        vid = f"{ev.get('ua','')}|{ev.get('path','')}|{int(t // 600)}"
        if ev.get("type") == "page_view":
            p = ev.get("path") or "/"
            pages[p] = pages.get(p, 0) + 1
            if str(ev.get("ts", "")).startswith(today):
                pageviews_today += 1
                visitors_today.add(vid)
            if t >= week_start:
                pageviews_week += 1
                visitors_week.add(vid)
        if ev.get("type") == "add_to_cart" and t >= week_start:
            cart_adds += 1
        if ev.get("type") == "whatsapp_order" and t >= week_start:
            whatsapp += 1
        if ev.get("type") == "search" and t >= week_start:
            searches += 1
        if ev.get("type") == "find_parts" and t >= week_start:
            find_parts += 1
        recent.append(ev)

    recent.sort(key=lambda e: str(e.get("ts") or ""), reverse=True)
    top_pages = sorted(pages.items(), key=lambda x: x[1], reverse=True)[:15]
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "today": {
            "pageviews": pageviews_today,
            "visitorsApprox": len(visitors_today),
        },
        "week": {
            "pageviews": pageviews_week,
            "visitorsApprox": len(visitors_week),
            "cartAdds": cart_adds,
            "whatsappOrders": whatsapp,
            "searches": searches,
            "findParts": find_parts,
        },
        "topPages": [{"path": p, "count": c} for p, c in top_pages],
        "recent": recent[:80],
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def send_file_bytes(self, data, ctype="text/html; charset=utf-8", code=200, extra=None):
        if isinstance(data, str):
            data = data.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, code, obj):
        self.send_file_bytes(json.dumps(obj), "application/json; charset=utf-8", code)

    def do_OPTIONS(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/api/analytics", "/api/settings"):
            self.send_file_bytes(b"", "application/json", 204)
            return
        self.send_error(405)

    def read_settings(self):
        email = DEFAULT_EMAIL
        email_updated = None
        source = "defaults"
        if SETTINGS_FILE.exists():
            try:
                data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
                if isinstance(data, dict) and data.get("email"):
                    email = str(data["email"])
                    email_updated = data.get("emailUpdatedAt") or data.get("updatedAt")
                    source = "file"
            except Exception:
                pass
        return {
            **FIXED_WHATSAPP,
            "email": email,
            "emailUpdatedAt": email_updated,
            "phoneEditable": False,
            "source": source,
        }

    def write_settings(self, data):
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def handle_settings(self, method):
        if method == "GET":
            return self.send_json(200, self.read_settings())

        if method in ("PUT", "POST"):
            auth = self.headers.get("Authorization") or ""
            token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
            if sha256(token) != expected_hash():
                return self.send_json(401, {"error": "unauthorized"})
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except Exception:
                return self.send_json(400, {"error": "invalid_json"})

            if body.get("action") == "change_password":
                current = str(body.get("currentPassword") or "")
                new = str(body.get("newPassword") or "")
                confirm = str(body.get("confirmPassword", new) or "")
                if not current or not new:
                    return self.send_json(400, {"error": "missing_fields", "message": "Current and new password are required."})
                if len(new) < 10:
                    return self.send_json(400, {"error": "weak_password", "message": "New password must be at least 10 characters."})
                if new != confirm:
                    return self.send_json(400, {"error": "mismatch", "message": "New password confirmation does not match."})
                expected = expected_hash()
                if sha256(current) != expected or sha256(token) != expected:
                    return self.send_json(403, {"error": "bad_current_password", "message": "Current password is incorrect."})
                PASSWORD_HASH_FILE.parent.mkdir(parents=True, exist_ok=True)
                PASSWORD_HASH_FILE.write_text(
                    json.dumps(
                        {
                            "hash": sha256(new),
                            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )
                return self.send_json(200, {"ok": True, "action": "change_password", "message": "Password updated. Use the new password next login."})

            phone_keys = ("whatsappDigits", "whatsappDisplay", "phone", "phoneDigits")
            if any(k in body for k in phone_keys) and body.get("email") is None:
                return self.send_json(400, {"error": "phone_not_editable", "message": "WhatsApp / phone cannot be changed from admin."})

            email = str(body.get("email") or "").strip()
            if not email or "@" not in email:
                return self.send_json(400, {"error": "invalid_email", "message": "Email looks invalid."})
            next_settings = {
                "email": email[:120],
                "emailUpdatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
            self.write_settings(next_settings)
            out = self.read_settings()
            out["ok"] = True
            return self.send_json(200, out)

        return self.send_json(405, {"error": "method_not_allowed"})

    def handle_analytics(self, method):
        if method == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except Exception:
                return self.send_json(400, {"error": "invalid_json"})
            batch = body.get("events") if isinstance(body.get("events"), list) else [body]
            meta = {
                "ua": self.headers.get("User-Agent") or "",
                "ref": self.headers.get("Referer") or self.headers.get("Referrer") or "",
            }
            accepted = []
            for item in batch[:20]:
                ev = normalize_event(item, meta)
                if ev:
                    accepted.append(ev)
            if not accepted:
                return self.send_json(400, {"error": "no_valid_events"})
            by_day = {}
            for ev in accepted:
                d = (ev.get("ts") or "")[:10] or day_key()
                by_day.setdefault(d, []).append(ev)
            for day, lst in by_day.items():
                cur = read_day(day)
                write_day(day, (cur + lst)[-MAX_DAY_EVENTS:])
            return self.send_json(202, {"ok": True, "accepted": len(accepted)})

        if method == "GET":
            auth = self.headers.get("Authorization") or ""
            token = ""
            if auth.lower().startswith("bearer "):
                token = auth[7:].strip()
            if sha256(token) != expected_hash():
                return self.send_json(401, {"error": "unauthorized"})
            all_events = []
            for d in days_back(8):
                all_events.extend(read_day(d))
            return self.send_json(200, summarize(all_events))

        return self.send_json(405, {"error": "method_not_allowed"})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == "/api/analytics":
            return self.handle_analytics("GET")
        if path == "/api/settings":
            return self.handle_settings("GET")

        if path in ("/admin", "/admin/"):
            self.path = "/admin/index.html"
            return super().do_GET()

        if path in FILE_STUBS and FILE_STUBS[path].exists():
            data = FILE_STUBS[path].read_bytes()
            ctype = (
                "text/html; charset=utf-8"
                if str(FILE_STUBS[path]).endswith(".html")
                else "application/json"
            )
            self.send_file_bytes(data, ctype)
            return

        if path in STUBS:
            ctype, body = STUBS[path]
            if body is None:
                body = "{}"
            self.send_file_bytes(body, ctype)
            return

        if path.startswith("/widgets/") or path.startswith("/store-api/"):
            self.send_file_bytes(b"{}", "application/json")
            return

        candidate = ROOT / path.lstrip("/")
        if path != "/" and candidate.is_file():
            return super().do_GET()

        if path == "/":
            return super().do_GET()
        if any(path == p or path.startswith(p + "/") for p in SPA_PREFIXES):
            self.send_file_bytes((ROOT / "app.html").read_bytes(), "text/html; charset=utf-8")
            return
        parts = [p for p in path.split("/") if p]
        if len(parts) == 2 and "." not in parts[-1]:
            self.send_file_bytes((ROOT / "app.html").read_bytes(), "text/html; charset=utf-8")
            return

        if not candidate.exists():
            self.send_file_bytes((ROOT / "app.html").read_bytes(), "text/html; charset=utf-8")
            return
        if candidate.is_dir():
            # Prefer real directory index (e.g. /admin/)
            index = candidate / "index.html"
            if index.is_file():
                self.send_file_bytes(index.read_bytes(), "text/html; charset=utf-8")
                return
            self.send_file_bytes((ROOT / "app.html").read_bytes(), "text/html; charset=utf-8")
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == "/api/analytics":
            return self.handle_analytics("POST")
        if path == "/api/settings":
            return self.handle_settings("POST")
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        self.send_file_bytes(b"{}", "application/json")

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == "/api/settings":
            return self.handle_settings("PUT")
        self.send_json(405, {"error": "method_not_allowed"})

    def translate_path(self, path):
        path = urllib.parse.unquote(path.split("?", 1)[0]).split("#", 1)[0]
        words = [w for w in path.split("/") if w]
        full = ROOT
        for w in words:
            full = full / w
        return str(full)

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "404" in msg or "/api/analytics" in msg or "/api/settings" in msg or "/admin" in msg:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Serving {ROOT} at http://127.0.0.1:{PORT}/", flush=True)
        httpd.serve_forever()
