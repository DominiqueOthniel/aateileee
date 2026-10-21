import { list } from "@vercel/blob";
import {
  blobGetJson,
  blobPutJson,
  isAuthorized,
  readBody,
  sendJson,
} from "./_lib/auth.mjs";

export const config = {
  maxDuration: 30,
};

const MAX_DAY_EVENTS = 4000;
const ALLOWED = new Set([
  "page_view",
  "search",
  "add_to_cart",
  "whatsapp_order",
  "find_parts",
  "language",
]);

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function daysBack(n) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

function normalizeEvent(raw, meta = {}) {
  const type = String(raw?.type || "").slice(0, 40);
  if (!ALLOWED.has(type)) return null;
  const path = String(raw?.path || meta.path || "/").slice(0, 300);
  const payload =
    raw?.payload && typeof raw.payload === "object" ? raw.payload : {};
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type,
    path,
    payload: {
      q: payload.q != null ? String(payload.q).slice(0, 120) : undefined,
      sku: payload.sku != null ? String(payload.sku).slice(0, 80) : undefined,
      name: payload.name != null ? String(payload.name).slice(0, 160) : undefined,
      lang: payload.lang != null ? String(payload.lang).slice(0, 12) : undefined,
      qty: payload.qty != null ? Number(payload.qty) || 1 : undefined,
      source:
        payload.source != null ? String(payload.source).slice(0, 40) : undefined,
      vid: payload.vid != null ? String(payload.vid).slice(0, 64) : undefined,
    },
    ref: String(raw?.ref || meta.ref || "").slice(0, 300),
    ua: String(meta.ua || "").slice(0, 180),
  };
}

async function readDay(day) {
  const events = [];
  const legacy = await blobGetJson(`appdata/analytics/day/${day}.json`);
  if (Array.isArray(legacy)) events.push(...legacy);

  const token =
    process.env.AA_APPDATA_BLOB_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
  if (!token) return events;
  try {
    const { blobs = [] } = await list({
      prefix: `appdata/analytics/evt/${day}/`,
      token,
      limit: MAX_DAY_EVENTS,
    });
    const limited = blobs.slice(-MAX_DAY_EVENTS);
    const fetched = await Promise.all(
      limited.map(async (b) => {
        const key = b.pathname || "";
        if (!key) return null;
        return blobGetJson(key);
      })
    );
    for (const ev of fetched) {
      if (ev && typeof ev === "object" && ev.type) events.push(ev);
    }
  } catch {
    /* ignore list failures */
  }
  return events;
}

function summarize(events) {
  const now = Date.now();
  const dayMs = 86400000;
  const today = dayKey();
  const weekStart = now - 7 * dayMs;

  let pageviewsToday = 0;
  let pageviewsWeek = 0;
  const visitorsToday = new Set();
  const visitorsWeek = new Set();
  let cartAdds = 0;
  let whatsappClicks = 0;
  let searches = 0;
  let findParts = 0;
  const pages = new Map();
  const recent = [];

  for (const ev of events) {
    const t = Date.parse(ev.ts || "") || 0;
    const vid = `${ev.ua || ""}|${ev.path || ""}|${(t / 600000) | 0}`;
    if (ev.type === "page_view") {
      pages.set(ev.path, (pages.get(ev.path) || 0) + 1);
      if ((ev.ts || "").startsWith(today)) {
        pageviewsToday++;
        visitorsToday.add(vid);
      }
      if (t >= weekStart) {
        pageviewsWeek++;
        visitorsWeek.add(vid);
      }
    }
    if (ev.type === "add_to_cart" && t >= weekStart) cartAdds++;
    if (ev.type === "whatsapp_order" && t >= weekStart) whatsappClicks++;
    if (ev.type === "search" && t >= weekStart) searches++;
    if (ev.type === "find_parts" && t >= weekStart) findParts++;
    recent.push(ev);
  }

  recent.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const topPages = [...pages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([path, count]) => ({ path, count }));

  return {
    generatedAt: new Date().toISOString(),
    today: {
      pageviews: pageviewsToday,
      visitorsApprox: visitorsToday.size,
    },
    week: {
      pageviews: pageviewsWeek,
      visitorsApprox: visitorsWeek.size,
      cartAdds,
      whatsappOrders: whatsappClicks,
      searches,
      findParts,
    },
    topPages,
    recent: recent.slice(0, 80),
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.method === "POST") {
    let body = {};
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }
    const batch = Array.isArray(body.events) ? body.events : [body];
    const meta = {
      ua: req.headers["user-agent"] || "",
      ref: req.headers.referer || req.headers.referrer || "",
    };
    const accepted = [];
    for (const raw of batch.slice(0, 20)) {
      const ev = normalizeEvent(raw, meta);
      if (ev) accepted.push(ev);
    }
    if (!accepted.length) {
      return sendJson(res, 400, { error: "no_valid_events" });
    }
    try {
      await Promise.all(
        accepted.map((ev) => {
          const day = (ev.ts || "").slice(0, 10) || dayKey();
          return blobPutJson(
            `appdata/analytics/evt/${day}/${ev.id}.json`,
            ev
          );
        })
      );
    } catch (err) {
      return sendJson(res, 502, {
        error: "write_failed",
        message: String(err?.message || err),
      });
    }
    return sendJson(res, 202, { ok: true, accepted: accepted.length });
  }

  if (req.method === "GET") {
    if (!(await isAuthorized(req))) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    let all = [];
    for (const d of daysBack(8)) {
      all = all.concat(await readDay(d));
    }
    return sendJson(res, 200, summarize(all));
  }

  return sendJson(res, 405, { error: "method_not_allowed" });
}
