/**
 * Anti-freeze guardian: kill stuck Shopware overlays / splash / orphan scroll locks.
 * Must NOT block legitimate UI (cart, mnav, vehicle combobox, search, change-vehicle modal).
 */
(function () {
  "use strict";

  const LOCK_ATTR = "data-aa-scroll-locks";
  let healTimer = null;
  let quietUntil = 0;

  function isOurUi(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      "#aa-cart-root, #aa-mobile-nav, .aa-mnav-root, #aa-change-vehicle-modal, #aa-cookie-config, #aa-app-root, .vehicle-combobox, .aa-vehicle-details-modal, .aa-cv-modal, [data-find-parts], .find-parts"
    );
  }

  function hasIntentionalLock() {
    const b = document.body;
    if (!b) return false;
    return !!(
      b.classList.contains("aa-cart-open") ||
      b.classList.contains("aa-mnav-open") ||
      b.classList.contains("aa-cv-open") ||
      document.querySelector("#aa-cart-root.is-open") ||
      document.querySelector(".aa-mnav-root.is-open, #aa-mobile-nav.is-open") ||
      document.querySelector("#aa-change-vehicle-modal.is-open") ||
      document.querySelector("#aa-cookie-config.open, #aa-cookie-config.show") ||
      document.querySelector(".aa-vehicle-details-modal.is-open")
    );
  }

  function quiet(ms) {
    quietUntil = Date.now() + (ms || 600);
  }

  function killPreloaders() {
    document.querySelectorAll("#preloader, .page-loader, .sw-loader, .ajax-loader").forEach((el) => {
      try {
        el.classList.remove("preloader_visible", "is-active", "show");
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("pointer-events", "none", "important");
        el.style.setProperty("opacity", "0", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.remove();
      } catch (_) {
        /* ignore */
      }
    });
  }

  function killBrokenShopwareOffcanvas() {
    // Only remove clearly broken full-page dumps (logo splash inside offcanvas).
    // Do NOT blanket-kill every .offcanvas.show (cookie/config and menus may use it).
    document.querySelectorAll(".offcanvas.show, .offcanvas.showing").forEach((el) => {
      if (el.id === "aa-cookie-config" || el.classList.contains("aa-keep") || isOurUi(el)) return;
      const broken = el.querySelector?.(".loaderImage, .header-logo-main-img, #aa-app-root, #preloader");
      if (!broken) return;
      el.classList.remove("show", "showing");
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("pointer-events", "none", "important");
      el.setAttribute("aria-hidden", "true");
      try {
        el.remove();
      } catch (_) {
        /* ignore */
      }
    });

    document.querySelectorAll(".modal-backdrop, .offcanvas-backdrop").forEach((el) => {
      // Keep if an intentional drawer/menu/modal is open
      if (hasIntentionalLock()) return;
      // Orphan backdrops only
      if (document.querySelector(".offcanvas.show, .modal.show")) return;
      el.classList.remove("show", "showing");
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("pointer-events", "none", "important");
      try {
        el.remove();
      } catch (_) {
        /* ignore */
      }
    });
  }

  function killInvisibleBlockers() {
    document.querySelectorAll("body > div, body > aside, body > section").forEach((el) => {
      if (isOurUi(el)) return;
      if (el.id === "page-top" || el.id === "main" || el.classList.contains("container")) return;
      const st = getComputedStyle(el);
      if (st.position !== "fixed" && st.position !== "absolute") return;
      const z = parseInt(st.zIndex || "0", 10);
      if (!(z >= 1000)) return;
      const covers =
        (el.offsetWidth >= window.innerWidth * 0.9 || st.width === "100%" || st.inset === "0px") &&
        (el.offsetHeight >= window.innerHeight * 0.85 || st.height === "100%");
      if (!covers) return;
      const pe = st.pointerEvents;
      const visible = st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity || "1") > 0.01;
      const text = (el.textContent || "").trim();
      const emptyish = text.length < 2 && !el.querySelector("img, video, canvas, iframe, button, a, input, select, textarea, li, [role='listbox'], [role='menu']");
      const cls = String(el.className || "");
      // Never treat combobox/dropdown/search UI as blockers
      if (/vehicle-combobox|dropdown|listbox|typeahead|autocomplete|header-search|offcanvas-cart/i.test(cls)) return;
      if (visible && pe !== "none" && (emptyish || /backdrop|loaderImage|page-loader/i.test(cls))) {
        el.style.setProperty("pointer-events", "none", "important");
        el.style.setProperty("display", "none", "important");
        el.setAttribute("data-aa-freeze-blocker", "1");
      }
    });
  }

  function releaseScrollIfOrphaned() {
    const intentional = hasIntentionalLock();
    document.body.classList.add("aa-nofreeze", "aa-cart-kill-sw");
    document.documentElement.classList.add("aa-nofreeze");
    if (!intentional) {
      document.body.classList.remove("modal-open", "offcanvas-open");
      // Do not strip aa-cart-open / aa-mnav-open here unless roots are actually closed
      if (!document.querySelector("#aa-cart-root.is-open")) document.body.classList.remove("aa-cart-open");
      if (!document.querySelector("#aa-mobile-nav.is-open, .aa-mnav-root.is-open")) document.body.classList.remove("aa-mnav-open");
      if (!document.querySelector("#aa-change-vehicle-modal.is-open")) document.body.classList.remove("aa-cv-open");
      if (!hasIntentionalLock()) {
        document.body.classList.remove("aa-scroll-locked");
        document.documentElement.classList.remove("aa-scroll-locked");
        document.body.style.removeProperty("overflow");
        document.body.style.removeProperty("padding-right");
        document.body.style.removeProperty("position");
        document.body.style.removeProperty("top");
        document.body.style.removeProperty("width");
        document.body.style.removeProperty("height");
        document.documentElement.style.removeProperty("overflow");
        document.body.removeAttribute(LOCK_ATTR);
      }
    } else {
      document.querySelectorAll("#aa-cart-root.is-open, .aa-mnav-root.is-open, #aa-change-vehicle-modal.is-open").forEach((el) => {
        el.style.removeProperty("display");
        el.style.removeProperty("pointer-events");
        el.style.removeProperty("visibility");
        el.style.removeProperty("opacity");
      });
    }
  }

  function softHeal() {
    if (Date.now() < quietUntil) {
      killPreloaders();
      return;
    }
    try {
      killPreloaders();
      killBrokenShopwareOffcanvas();
      if (!hasIntentionalLock()) {
        killInvisibleBlockers();
        releaseScrollIfOrphaned();
      }
    } catch (_) {
      /* never throw */
    }
  }

  function heal() {
    if (Date.now() < quietUntil && hasIntentionalLock()) {
      killPreloaders();
      return;
    }
    try {
      killPreloaders();
      killBrokenShopwareOffcanvas();
      killInvisibleBlockers();
      releaseScrollIfOrphaned();
    } catch (_) {
      /* never throw */
    }
  }

  function lockScroll(reason) {
    quiet(800);
    const n = (parseInt(document.body.getAttribute(LOCK_ATTR) || "0", 10) || 0) + 1;
    document.body.setAttribute(LOCK_ATTR, String(n));
    document.body.classList.add("aa-scroll-locked", "aa-nofreeze");
    document.documentElement.classList.add("aa-scroll-locked", "aa-nofreeze");
    if (reason) document.body.setAttribute("data-aa-lock-reason", reason);
  }

  function unlockScroll(reason) {
    let n = parseInt(document.body.getAttribute(LOCK_ATTR) || "0", 10) || 0;
    n = Math.max(0, n - 1);
    if (n === 0) {
      document.body.removeAttribute(LOCK_ATTR);
      document.body.classList.remove("aa-scroll-locked");
      document.documentElement.classList.remove("aa-scroll-locked");
      document.body.removeAttribute("data-aa-lock-reason");
      softHeal();
    } else {
      document.body.setAttribute(LOCK_ATTR, String(n));
    }
  }

  function onRouteChange() {
    softHeal();
    setTimeout(softHeal, 50);
    setTimeout(softHeal, 300);
  }

  function boot() {
    document.documentElement.classList.add("aa-nofreeze");
    if (document.body) document.body.classList.add("aa-nofreeze", "aa-cart-kill-sw");
    softHeal();

    window.__AA_NOFREEZE__ = {
      heal,
      softHeal,
      quiet,
      lockScroll,
      unlockScroll,
      killPreloaders,
      killStuckOverlays: killBrokenShopwareOffcanvas,
    };

    const wrap = (fn) =>
      function () {
        const r = fn.apply(this, arguments);
        onRouteChange();
        return r;
      };
    try {
      history.pushState = wrap(history.pushState.bind(history));
      history.replaceState = wrap(history.replaceState.bind(history));
    } catch (_) {
      /* ignore */
    }
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener("pageshow", softHeal);

    // After interactions: soft heal only (never strip open drawers mid-animation)
    const afterInteract = (e) => {
      const t = e.target;
      if (t && t.closest && t.closest("#aa-cart-root, #aa-mobile-nav, #aa-change-vehicle-modal, .vehicle-combobox, .header-cart, .nav-main-toggle, [data-off-canvas-menu], form.buy-widget, .btn-buy")) {
        quiet(900);
        return;
      }
      setTimeout(softHeal, 120);
    };
    document.addEventListener("click", afterInteract, true);
    document.addEventListener("submit", afterInteract, true);

    if (healTimer) clearInterval(healTimer);
    healTimer = setInterval(softHeal, 2000);

    const mo = new MutationObserver(() => {
      if (document.querySelector(".offcanvas.show .loaderImage, .offcanvas.show #aa-app-root, #preloader.preloader_visible")) {
        softHeal();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
    document.addEventListener("readystatechange", () => {
      if (document.body) {
        document.body.classList.add("aa-nofreeze", "aa-cart-kill-sw");
        killPreloaders();
      }
    });
  } else {
    boot();
  }
})();
