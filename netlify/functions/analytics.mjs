import { connectLambda, getStore } from "@netlify/blobs";
import { isAuthorized, json } from "../lib/shared-auth.mjs";

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

async function getStoreSafe() {
  // Do not request strong consistency in Lambda-compat mode; that needs
  // uncachedEdgeURL which connectLambda does not provide.
  try {
    return getStore({ name: "aa-analytics" });
  } catch {
    return getStore("aa-analytics");
  }
}

async function readDay(store, day) {
  const events = [];
  // Legacy single-key day files (best-effort; may race under eventual consistency)
  try {
    const data = await store.get(`day/${day}`, { type: "json" });
    if (Array.isArray(data)) events.push(...data);
  } catch {
    /* ignore */
  }
  // Append-only per-event keys (safe for concurrent writes)
  try {
    const { blobs = [] } = await store.list({ prefix: `evt/${day}/` });
    const limited = blobs.slice(-MAX_DAY_EVENTS);
    const fetched = await Promise.all(
      limited.map(async (b) => {
        try {
          return await store.get(b.key, { type: "json" });
        } catch {
          return null;
        }
      })
    );
    for (const ev of fetched) {
      if (ev && typeof ev === "object" && ev.type) events.push(ev);
    }
  } catch {
    /* ignore */
  }
  return events;
}

async function writeEvents(store, events) {
  await Promise.all(
    events.map((ev) => {
      const day = (ev.ts || "").slice(0, 10) || dayKey();
      return store.setJSON(`evt/${day}/${ev.id}`, ev);
    })
  );
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
      source: payload.source != null ? String(payload.source).slice(0, 40) : undefined,
      vid: payload.vid != null ? String(payload.vid).slice(0, 64) : undefined,
    },
    ref: String(raw?.ref || meta.ref || "").slice(0, 300),
    ua: String(meta.ua || "").slice(0, 180),
  };
}

function summarize(events) {
  const now = Date.now();
  const dayMs = 86400000;
  const today = dayKey();
  const weekStart = now - 7 * dayMs;

  let pageviewsToday = 0;
  let pageviewsWeek = 0;
  let visitorsToday = new Set();
  let visitorsWeek = new Set();
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

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  // Lambda-compatible functions need an explicit Blobs context bootstrap.
  try {
    connectLambda(event);
  } catch {
    /* ignore if already connected / modern runtime */
  }

  let store;
  try {
    store = await getStoreSafe();
  } catch (err) {
    return json(503, {
      error: "blobs_unavailable",
      message: String(err?.message || err),
    });
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const batch = Array.isArray(body.events) ? body.events : [body];
    const meta = {
      ua: event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "",
      ref: event.headers?.referer || event.headers?.referrer || "",
    };
    const accepted = [];
    for (const raw of batch.slice(0, 20)) {
      const ev = normalizeEvent(raw, meta);
      if (ev) accepted.push(ev);
    }
    if (!accepted.length) return json(400, { error: "no_valid_events" });

    try {
      await writeEvents(store, accepted);
    } catch (err) {
      return json(502, {
        error: "write_failed",
        message: String(err?.message || err),
      });
    }
    return json(202, { ok: true, accepted: accepted.length });
  }

  if (event.httpMethod === "GET") {
    if (!(await isAuthorized(event, store))) {
      return json(401, { error: "unauthorized" });
    }
    const days = daysBack(8);
    let all = [];
    for (const d of days) {
      all = all.concat(await readDay(store, d));
    }
    return json(200, summarize(all));
  }

  return json(405, { error: "method_not_allowed" });
}
