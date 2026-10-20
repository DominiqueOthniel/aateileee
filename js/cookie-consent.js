(() => {
  const t = (key, vars) => (window.__AA_I18N__?.t ? window.__AA_I18N__.t(key, vars) : key);
  const COOKIE_NAME = "cookie-preference";
  const STORAGE_KEY = "aa_cookie_consent";
  const DAYS = 365;
  let bannerEl = null;
  let wired = false;

  function getStored() {
    try {
      const fromLs = localStorage.getItem(STORAGE_KEY);
      if (fromLs) return JSON.parse(fromLs);
    } catch {}
    const cookies = document.cookie.split(";").map((c) => c.trim());
    const pref = cookies.find((c) => c.startsWith(COOKIE_NAME + "="));
    if (pref) {
      const val = decodeURIComponent(pref.split("=").slice(1).join("="));
      return { choice: val === "1" ? "necessary" : val || "necessary", at: Date.now() };
    }
    const choice = cookies.find((c) => c.startsWith("aa_cookie_choice="));
    if (choice) {
      return {
        choice: decodeURIComponent(choice.split("=").slice(1).join("=")),
        at: Date.now(),
      };
    }
    return null;
  }

  function persist(choice) {
    const payload = { choice, at: Date.now() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
    const maxAge = DAYS * 24 * 60 * 60;
    document.cookie =
      COOKIE_NAME + "=1; Max-Age=" + maxAge + "; Path=/; SameSite=Lax";
    document.cookie =
      "aa_cookie_choice=" +
      encodeURIComponent(choice) +
      "; Max-Age=" +
      maxAge +
      "; Path=/; SameSite=Lax";
    return payload;
  }

  function findBanner() {
    return document.querySelector(".cookie-permission-container");
  }

  function hideBanner(banner) {
    const el = banner || bannerEl || findBanner();
    if (!el) return;
    bannerEl = el;
    el.setAttribute("hidden", "");
    el.setAttribute("aria-hidden", "true");
    el.classList.add("is-dismissed");
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    document.body.style.paddingBottom = "0";
  }

  function showBanner(banner) {
    if (getStored()) {
      hideBanner(banner);
      return;
    }
    const el = banner || bannerEl || findBanner();
    if (!el) return;
    bannerEl = el;
    el.removeAttribute("hidden");
    el.setAttribute("aria-hidden", "false");
    el.classList.remove("is-dismissed");
    el.style.removeProperty("visibility");
    el.style.setProperty("display", "block", "important");
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.right = "0";
    el.style.bottom = "0";
    el.style.zIndex = "1050";
    el.style.background = "#fff";
    requestAnimationFrame(() => {
      document.body.style.paddingBottom = el.offsetHeight + "px";
    });
  }

  function ensureConfigPanel(banner) {
    let panel = document.getElementById("aa-cookie-config");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "aa-cookie-config";
    panel.innerHTML = `
      <div class="aa-cookie-config-card" role="dialog" aria-modal="true" aria-label="${t("cookieSettings")}">
        <h2>${t("cookieSettings")}</h2>
        <p>${t("cookieChoose")}</p>
        <label><input type="checkbox" checked disabled> ${t("cookieRequired")}</label>
        <label><input type="checkbox" id="aa-cookie-analytics"> ${t("cookieAnalytics")}</label>
        <label><input type="checkbox" id="aa-cookie-marketing"> ${t("cookieMarketing")}</label>
        <div class="aa-cookie-config-actions">
          <button type="button" class="btn btn-primary" data-aa-cookie-save>${t("savePreferences")}</button>
          <button type="button" class="btn btn-outline-primary" data-aa-cookie-cancel>${t("cancel")}</button>
        </div>
      </div>`;
    const style = document.createElement("style");
    style.textContent = `
      #aa-cookie-config{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1100;display:none;align-items:center;justify-content:center;padding:16px}
      #aa-cookie-config.open{display:flex}
      #aa-cookie-config .aa-cookie-config-card{background:#fff;max-width:480px;width:100%;border-radius:8px;padding:20px;box-shadow:0 8px 30px rgba(0,0,0,.2)}
      #aa-cookie-config h2{margin:0 0 8px;font-size:1.25rem}
      #aa-cookie-config label{display:block;margin:10px 0;font-weight:500}
      #aa-cookie-config .aa-cookie-config-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
      #aa-cookie-config .btn{cursor:pointer}
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    panel.querySelector("[data-aa-cookie-cancel]").addEventListener("click", () => {
      panel.classList.remove("open");
    });
    panel.querySelector("[data-aa-cookie-save]").addEventListener("click", () => {
      const analytics = panel.querySelector("#aa-cookie-analytics")?.checked;
      const marketing = panel.querySelector("#aa-cookie-marketing")?.checked;
      const choice = analytics || marketing ? "configured" : "necessary";
      persist(choice);
      panel.classList.remove("open");
      hideBanner(banner);
    });
    panel.addEventListener("click", (e) => {
      if (e.target === panel) panel.classList.remove("open");
    });
    return panel;
  }

  function accept(choice, banner) {
    persist(choice);
    hideBanner(banner);
    document.dispatchEvent(new CustomEvent("hideCookieBar"));
  }

  function wire(banner) {
    if (!banner || wired) return;
    wired = true;
    bannerEl = banner;

    const necessaryBtn = banner.querySelector(
      ".js-cookie-permission-button button, .cookie-permission-button button"
    );
    const configureBtn = banner.querySelector(
      ".js-cookie-configuration-button button"
    );
    const acceptAllBtn = banner.querySelector(
      ".js-cookie-accept-all-button button"
    );

    if (necessaryBtn) {
      necessaryBtn.type = "button";
      necessaryBtn.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          accept("necessary", banner);
        },
        true
      );
    }
    if (acceptAllBtn) {
      acceptAllBtn.type = "button";
      acceptAllBtn.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          accept("all", banner);
        },
        true
      );
    }
    if (configureBtn) {
      configureBtn.type = "button";
      configureBtn.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          ensureConfigPanel(banner).classList.add("open");
        },
        true
      );
    }
  }

  function enforceConsentState() {
    const banner = findBanner();
    if (!banner) return;
    wire(banner);
    if (getStored()) hideBanner(banner);
    else showBanner(banner);
  }

  function watchForPluginOverrides(banner) {
    if (!banner || banner.dataset.aaCookieObserved === "1") return;
    banner.dataset.aaCookieObserved = "1";
    const obs = new MutationObserver(() => {
      if (!getStored()) return;
      const cs = getComputedStyle(banner);
      if (cs.display !== "none" || !banner.hasAttribute("hidden")) {
        hideBanner(banner);
      }
    });
    obs.observe(banner, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden"],
    });
  }

  function init() {
    enforceConsentState();
    const banner = findBanner();
    if (banner) watchForPluginOverrides(banner);

    document.addEventListener("showCookieBar", () => {
      if (getStored()) {
        hideBanner();
        return;
      }
      showBanner();
    });
    document.addEventListener("hideCookieBar", () => hideBanner());
    document.addEventListener("aa:lang-changed", () => {
      window.__AA_I18N__?.applyShell?.();
    });
    document.addEventListener("aa:open-cookie-settings", () => {
      const b = findBanner();
      if (!b) return;
      // Reopening settings is intentional even after consent
      b.classList.remove("is-dismissed");
      b.removeAttribute("hidden");
      b.style.setProperty("display", "block", "important");
      ensureConfigPanel(b).classList.add("open");
    });

    // Shopware async plugins may re-show the bar after load
    [100, 500, 1000, 2000, 4000].forEach((ms) => {
      setTimeout(enforceConsentState, ms);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
