(function () {
  "use strict";
  const ENDPOINT = "/api/analytics";
  const QUEUE_KEY = "aa_analytics_q";
  let vid = "";

  try {
    vid = localStorage.getItem("aa_vid") || "";
    if (!vid) {
      vid = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("aa_vid", vid);
    }
  } catch {
    vid = "v_ephemeral";
  }

  function flush(events) {
    if (!events.length) return;
    const body = JSON.stringify({ events });
    try {
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
        if (ok) return;
      }
    } catch {
      /* fall through */
    }
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  }

  function track(type, payload) {
    try {
      if (!type) return;
      const ev = {
        type: String(type),
        path: location.pathname + location.search,
        ref: document.referrer || "",
        payload: Object.assign({ vid }, payload || {}),
      };
      flush([ev]);
    } catch {
      /* never break shop */
    }
  }

  window.aaTrack = track;

  // page view (once per load; SPA navigations call track manually)
  track("page_view", { lang: localStorage.getItem("aa_lang") || "" });

  // WhatsApp float + footer/header WhatsApp links
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target?.closest?.("a[href*='wa.me'], a.aa-wa-float, .whatsapp_no, .whatsapp_icon");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!/wa\.me/i.test(href) && !a.classList.contains("aa-wa-float")) return;
      track("whatsapp_order", {
        source: a.classList.contains("aa-wa-float") ? "float" : "link",
      });
    },
    true
  );

  // Find parts buttons (native shopware forms + SPA)
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target?.closest?.(
        "button.find-parts-btn, .find-parts__actions .btn, [data-aa-find-parts], a[href='/find-parts'], a[href^='/find-parts?']"
      );
      if (!el) return;
      track("find_parts", { source: "click" });
    },
    true
  );

  // Language forms / flags
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target?.closest?.("[data-lang], form.language-form button, .language-form button");
      if (!el) return;
      const lang =
        el.getAttribute("data-lang") ||
        el.closest("form")?.querySelector("[name='languageId'], [name='locale']")?.value ||
        "";
      track("language", { lang: String(lang || "").slice(0, 12) });
    },
    true
  );
})();
