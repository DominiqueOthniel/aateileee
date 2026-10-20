(() => {
  const t = (key, vars) =>
    window.__AA_I18N__?.t ? window.__AA_I18N__.t(key, vars) : key;

  const NAV_JSON = "/data/mobile-nav.json?v=20261017fr2";

  let navData = null;
  let root = null;
  let stackEl = null;
  let stack = [];

  const chevronSvg =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.5 2.5 11 8l-5.5 5.5-.9-.9L9.2 8 4.6 3.4z"/></svg>';
  const backSvg =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M10.5 2.5 5 8l5.5 5.5.9-.9L6.8 8l4.6-4.6z"/></svg>';

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeLang(code) {
    const c = String(code || "")
      .toLowerCase()
      .slice(0, 2);
    return c === "fr" || c === "de" || c === "en" ? c : null;
  }

  function currentLang() {
    return (
      normalizeLang(window.__AA_I18N__?.getLang?.()) ||
      normalizeLang(document.documentElement.getAttribute("data-aa-lang")) ||
      normalizeLang(document.documentElement.lang) ||
      normalizeLang(document.body?.getAttribute("data-aa-lang")) ||
      normalizeLang(localStorage.getItem("aa_lang")) ||
      "en"
    );
  }

  function flagClass(code) {
    if (code === "fr") return "fr";
    if (code === "de") return "de";
    return "gb";
  }

  function langLabel(code) {
    if (code === "fr") return t("langFrench");
    if (code === "de") return t("langGerman");
    return t("langEnglish");
  }

  function catIdFromPath(path) {
    const m = String(path || "").match(/(\d{4,})\/?$/);
    return m ? m[1] : "";
  }

  /** Resolve localized label; never prefer English when locale is fr/de if a translation exists. */
  function itemLabel(item) {
    if (!item) return "";
    const lang = currentLang();
    const names = item.names || {};
    const fromNames = names[lang];
    if (fromNames) return fromNames;
    const id = catIdFromPath(item.path);
    const indexed = navData?.labelIndex?.[id];
    if (indexed?.[lang]) return indexed[lang];
    if (lang !== "en" && names.en && item.name && item.name !== names.en) {
      // name may already have been localized by applyLocaleToNavData
      return item.name;
    }
    if (lang !== "en" && item.name && names.en && item.name === names.en) {
      // Still English while locale is FR/DE: last resort keep it (official same word)
      return item.name;
    }
    return names.en || item.name || "";
  }

  /** Rewrite every item.name to the active locale so no path can leak English labels. */
  function applyLocaleToNavData() {
    if (!navData?.items) return;
    const lang = currentLang();
    const walk = (items) => {
      for (const it of items) {
        const id = catIdFromPath(it.path);
        const names = it.names || navData.labelIndex?.[id] || {};
        const localized = names[lang] || names.en || it.name || "";
        it.name = localized;
        if (!it.names && Object.keys(names).length) it.names = names;
        if (it.children?.length) walk(it.children);
      }
    };
    walk(navData.items);
  }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.className = "aa-mnav-root";
    root.id = "aa-mobile-nav";
    root.innerHTML = `
      <div class="aa-mnav-overlay" data-aa-mnav-close></div>
      <button type="button" class="aa-mnav-close" data-aa-mnav-close aria-label="">×</button>
      <aside class="aa-mnav-panel" role="dialog" aria-modal="true" aria-label="">
        <div class="aa-mnav-top">
          <div class="aa-mnav-lang" data-aa-mnav-lang>
            <button type="button" aria-haspopup="true" aria-expanded="false" data-aa-mnav-lang-toggle>
              <span class="aa-mnav-flag gb" aria-hidden="true"></span>
              <span aria-hidden="true">▾</span>
            </button>
            <div class="aa-mnav-lang-menu" role="menu"></div>
          </div>
        </div>
        <div class="aa-mnav-stack" data-aa-mnav-stack></div>
      </aside>`;
    document.body.appendChild(root);
    stackEl = root.querySelector("[data-aa-mnav-stack]");

    root.querySelectorAll("[data-aa-mnav-close]").forEach((el) => {
      el.addEventListener("click", close);
    });
    const lang = root.querySelector("[data-aa-mnav-lang]");
    lang.querySelector("[data-aa-mnav-lang-toggle]").addEventListener("click", (e) => {
      e.stopPropagation();
      lang.classList.toggle("is-open");
      lang.querySelector("button").setAttribute("aria-expanded", lang.classList.contains("is-open") ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      if (!lang.contains(e.target)) lang.classList.remove("is-open");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("is-open")) close();
    });
    applyChromeI18n();
    return root;
  }

  function applyChromeI18n() {
    if (!root) return;
    const closeBtn = root.querySelector(".aa-mnav-close");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("closeMenu"));
    const panel = root.querySelector(".aa-mnav-panel");
    if (panel) panel.setAttribute("aria-label", t("menu"));
    const toggle = root.querySelector("[data-aa-mnav-lang-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-label", t("changeLanguage", { label: langLabel(currentLang()) }));
    }
  }

  function renderLang() {
    if (!root || !navData) return;
    applyChromeI18n();
    const menu = root.querySelector(".aa-mnav-lang-menu");
    const current = currentLang();
    const flag = root.querySelector("[data-aa-mnav-lang-toggle] .aa-mnav-flag") || root.querySelector(".aa-mnav-flag");
    if (flag) flag.className = "aa-mnav-flag " + flagClass(current);
    const langs = navData.languages || [
      { code: "en", path: "/" },
      { code: "fr", path: "/fr/" },
      { code: "de", path: "/de/" },
    ];
    menu.innerHTML = langs
      .map(
        (l) => `<button type="button" role="menuitem" data-lang-path="${esc(l.path)}" data-lang-code="${esc(l.code)}" class="${l.code === current ? "active" : ""}">
        <span class="aa-mnav-flag ${flagClass(l.code)}"></span>${esc(langLabel(l.code))}
      </button>`
      )
      .join("");
    menu.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-lang-code");
        // Apply instantly so drawer labels switch before optional reload
        try {
          localStorage.setItem("aa_lang", code);
        } catch {}
        if (window.__AA_I18N__?.setLang) {
          window.__AA_I18N__.setLang(code, { reload: true });
        } else {
          location.reload();
        }
      });
    });
  }

  function rowHtml(item) {
    const label = itemLabel(item);
    const icon = item.icon
      ? `<img src="${esc(item.icon)}" alt="" loading="lazy">`
      : `<span style="width:28px;height:28px;display:inline-block"></span>`;
    const chevron =
      item.hasChildren || (item.children && item.children.length)
        ? `<button type="button" class="aa-mnav-chevron" data-aa-mnav-open="${esc(item.path)}" aria-label="${esc(label)}">${chevronSvg}</button>`
        : `<span class="aa-mnav-chevron" aria-hidden="true"></span>`;
    return `<li class="aa-mnav-row">
      <a class="aa-mnav-link" href="${esc(item.path)}">${icon}<span>${esc(label)}</span></a>
      ${chevron}
    </li>`;
  }

  function makeView(title, items, { showBack = false, parentPath = null } = {}) {
    const view = document.createElement("div");
    view.className = "aa-mnav-view";
    const back = showBack
      ? `<button type="button" class="aa-mnav-back" data-aa-mnav-back>${backSvg}<span>${esc(title)}</span></button>`
      : "";
    const parentLink = parentPath
      ? `<a class="aa-mnav-parent-link" href="${esc(parentPath)}">${esc(t("showAllIn", { title }))}</a>`
      : "";
    view.innerHTML = `${back}${parentLink}<ul class="aa-mnav-list">${items.map(rowHtml).join("")}</ul>`;
    view.querySelectorAll("[data-aa-mnav-open]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const path = btn.getAttribute("data-aa-mnav-open");
        const item = findItem(path);
        if (item) pushPanel(item);
      });
    });
    const backBtn = view.querySelector("[data-aa-mnav-back]");
    if (backBtn) backBtn.addEventListener("click", popPanel);
    return view;
  }

  function findItem(path, items = navData.items) {
    for (const it of items) {
      if (it.path === path) return it;
      if (it.children?.length) {
        const hit = findItem(path, it.children);
        if (hit) return hit;
      }
    }
    return null;
  }

  function resetStack() {
    if (!stackEl || !navData) return;
    applyLocaleToNavData();
    stack = [];
    stackEl.innerHTML = "";
    const view = makeView(t("navCategories"), navData.items, { showBack: false });
    stackEl.appendChild(view);
    stack.push({ view, title: t("navCategories") });
  }

  function reapplyI18n() {
    ensureRoot();
    applyLocaleToNavData();
    renderLang();
    if (!navData) return;
    if (!root?.classList.contains("is-open")) return;
    const pathStack = stack
      .slice(1)
      .map((s) => s.item?.path)
      .filter(Boolean);
    resetStack();
    for (const path of pathStack) {
      const item = findItem(path);
      if (item) pushPanel(item);
    }
  }

  function pushPanel(item) {
    const current = stack[stack.length - 1]?.view;
    const title = itemLabel(item);
    const next = makeView(title, item.children || [], {
      showBack: true,
      parentPath: item.path,
    });
    next.classList.add("is-right");
    stackEl.appendChild(next);
    requestAnimationFrame(() => {
      if (current) current.classList.add("is-left");
      next.classList.remove("is-right");
    });
    stack.push({ view: next, title, item });
  }

  function popPanel() {
    if (stack.length < 2) return;
    const current = stack.pop();
    const prev = stack[stack.length - 1];
    current.view.classList.add("is-right");
    prev.view.classList.remove("is-left");
    setTimeout(() => current.view.remove(), 280);
  }

  function open() {
    window.__AA_NOFREEZE__?.quiet?.(1000);
    ensureRoot();
    if (navData) {
      applyLocaleToNavData();
      renderLang();
      resetStack();
    } else if (stackEl && !stackEl.childElementCount) {
      stackEl.innerHTML = `<div class="aa-mnav-view"><p style="padding:16px">${esc(t("loading") || "Loading…")}</p></div>`;
    }
    root.classList.add("is-open");
    root.setAttribute("data-aa-mnav-lang", currentLang());
    document.body.classList.add("aa-mnav-open", "aa-nofreeze");
    window.__AA_NOFREEZE__?.lockScroll?.("mnav");
  }

  function close() {
    if (!root) return;
    const wasOpen = root.classList.contains("is-open");
    root.classList.remove("is-open");
    document.body.classList.remove("aa-mnav-open");
    const lang = root.querySelector("[data-aa-mnav-lang]");
    if (lang) lang.classList.remove("is-open");
    if (wasOpen) window.__AA_NOFREEZE__?.unlockScroll?.("mnav");
    window.__AA_NOFREEZE__?.heal?.();
  }

  function wireTriggers() {
    const selectors = [
      ".nav-main-toggle-btn",
      "[data-off-canvas-menu]",
      "button[aria-label='Menu']",
      ".header-actions-btn.nav-main-toggle-btn",
    ];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((btn) => {
        if (btn.dataset.aaMnavWired === "1") return;
        btn.dataset.aaMnavWired = "1";
        btn.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            open();
          },
          true
        );
      });
    });
    document.querySelectorAll(".nav-main-toggle, .main-navigation-toggle").forEach((wrap) => {
      wrap.addEventListener(
        "click",
        (e) => {
          if (window.matchMedia("(max-width: 991.98px)").matches) {
            const el = e.target.closest("a,button");
            if (el && el.matches("a") && el.getAttribute("href") && el.getAttribute("href") !== "#") return;
            e.preventDefault();
            open();
          }
        },
        true
      );
    });
  }

  async function boot() {
    ensureRoot();
    wireTriggers();
    setInterval(wireTriggers, 1500);
    window.__AA_MNAV__ = { open, close, wire: wireTriggers, reapplyI18n, currentLang };
    try {
      const res = await fetch(NAV_JSON, { cache: "no-store" });
      navData = await res.json();
      applyLocaleToNavData();
      renderLang();
      if (root?.classList.contains("is-open")) resetStack();
    } catch (e) {
      console.warn("mobile nav data missing", e);
    }
    window.addEventListener("aa:lang-changed", () => {
      reapplyI18n();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
