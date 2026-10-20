(() => {
  const t = (key, vars) =>
    window.__AA_I18N__?.t ? window.__AA_I18N__.t(key, vars) : key;

  const emptyCatalog = () => ({
    products: [],
    categories: [],
    cms: {},
    vehicles: { makers: [], models: {}, engines: {} },
  });

  const state = {
    catalog: emptyCatalog(),
    cart: loadCart(),
    wishlist: loadWishlist(),
    account: loadAccount(),
  };

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem("aa_cart") || "[]");
      if (Array.isArray(raw)) return raw;
      if (raw && Array.isArray(raw.items)) return raw.items;
      return [];
    } catch {
      return [];
    }
  }
  function saveCart() {
    localStorage.setItem("aa_cart", JSON.stringify(state.cart));
    updateCartBadge();
    window.dispatchEvent(new CustomEvent("aa:cart-changed", { detail: state.cart }));
  }
  function syncCartFromStorage() {
    state.cart = loadCart();
    // Refresh line prices from catalog when older cart rows stored null/0
    if (state.catalog?.products) {
      let changed = false;
      state.cart.forEach((item) => {
        if (hasPrice(item.price)) return;
        const p = findProduct(item.path);
        if (p && hasPrice(p.price)) {
          item.price = p.price;
          if (p.image && !item.image) item.image = p.image;
          if (p.name) item.name = p.name;
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem("aa_cart", JSON.stringify(state.cart));
      }
    }
    updateCartBadge();
  }
  function loadWishlist() {
    try {
      return JSON.parse(localStorage.getItem("aa_wishlist") || "[]");
    } catch {
      return [];
    }
  }
  function saveWishlist() {
    localStorage.setItem("aa_wishlist", JSON.stringify(state.wishlist));
  }
  function loadAccount() {
    try {
      return JSON.parse(localStorage.getItem("aa_account") || "null");
    } catch {
      return null;
    }
  }
  function saveAccount(acc) {
    state.account = acc;
    localStorage.setItem("aa_account", JSON.stringify(acc));
  }

  const DEFAULT_WA_NUMBER = "33644684920";
  const DEFAULT_CONTACT_PHONE = "+33 6 44 68 49 20";
  const DEFAULT_CONTACT_EMAIL = "aateilepieceauto1@gmail.com";
  function waNumber() {
    return window.__AA_CONTACT__?.whatsappDigits || DEFAULT_WA_NUMBER;
  }
  function contactPhone() {
    return window.__AA_CONTACT__?.whatsappDisplay || DEFAULT_CONTACT_PHONE;
  }
  function contactEmail() {
    return window.__AA_CONTACT__?.email || DEFAULT_CONTACT_EMAIL;
  }

  function hasPrice(n) {
    const v = Number(n);
    return n != null && n !== "" && !Number.isNaN(v) && v > 0;
  }
  function money(n, { allowZero = false } = {}) {
    if (allowZero && Number(n) === 0) {
      return (
        "€" +
        (0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      );
    }
    if (!hasPrice(n)) return t("priceOnRequest");
    return (
      "€" +
      Number(n).toLocaleString("en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  function lineMoney(price, qty = 1) {
    if (!hasPrice(price)) return t("priceOnRequest");
    const sum = Number(price) * (qty || 1);
    if (!hasPrice(sum)) return t("priceOnRequest");
    return money(sum);
  }

  function buildWhatsAppOrderMessage(customer = {}) {
    const lines = [t("waHello"), ""];
    if (!state.cart.length) {
      lines.push(t("waEmpty"));
    } else {
      state.cart.forEach((i, idx) => {
        lines.push(
          `${idx + 1}. ${i.name} × ${i.qty} · ${lineMoney(i.price, i.qty)}` +
            (i.path ? ` (${i.path})` : "")
        );
      });
      lines.push("");
      lines.push(
        t("waTotalLine", {
          total: cartHasPricedItems() ? money(cartTotal()) : t("priceOnRequest"),
          n: cartCount(),
        })
      );
    }
    lines.push("");
    if (customer.name) lines.push(`${t("waName")}: ${customer.name}`);
    if (customer.phone) lines.push(`${t("waPhone")}: ${customer.phone}`);
    if (customer.address || customer.city || customer.zip) {
      lines.push(
        `${t("waAddress")}: ${[customer.address, customer.zip, customer.city, customer.country]
          .filter(Boolean)
          .join(", ")}`
      );
    }
    if (customer.note) lines.push(`${t("waNote")}: ${customer.note}`);
    lines.push("");
    lines.push(t("waThanks"));
    return lines.join("\n");
  }

  function whatsAppOrderUrl(customer = {}) {
    const text = buildWhatsAppOrderMessage(customer);
    return `https://wa.me/${waNumber()}?text=${encodeURIComponent(text)}`;
  }

  function openWhatsAppOrder(customer = {}) {
    const url = whatsAppOrderUrl(customer);
    try {
      window.aaTrack?.("whatsapp_order", { source: "checkout" });
    } catch (_) {}
    window.open(url, "_blank", "noopener");
    return url;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function encodeImgUrl(src) {
    if (!src) return "";
    try {
      // Same-origin only — never build absolute aateile.com URLs for <img>
      const u = new URL(src, typeof location !== "undefined" ? location.origin : "http://local");
      u.pathname = u.pathname
        .split("/")
        .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
        .join("/");
      if (src.startsWith("/")) return u.pathname + u.search;
      if (src.startsWith("media/")) return "/" + u.pathname.replace(/^\//, "") + u.search;
      // Block any leftover absolute third-party hosts in the browser
      if (u.origin !== (typeof location !== "undefined" ? location.origin : u.origin)) {
        if (/aateile\.com|aateile\.s3/i.test(u.href)) {
          const mapped = remoteImageToLocal(u.href);
          if (mapped) return mapped;
          return "";
        }
      }
      return src.startsWith("http") ? u.pathname + u.search : u.pathname + u.search;
    } catch {
      return src.replace(/ /g, "%20");
    }
  }

  /** Map former CDN URLs to self-hosted /media/... paths (no network to aateile). */
  function remoteImageToLocal(src) {
    if (!src || typeof src !== "string") return "";
    const bare = src.split("?")[0].split("#")[0];
    const mediaIdx = bare.indexOf("/media/");
    if (/aateile\.com/i.test(bare) && mediaIdx >= 0) return bare.slice(mediaIdx);
    try {
      if (/aateile\.s3/i.test(bare)) {
        const u = new URL(bare);
        return "/media/s3" + u.pathname;
      }
    } catch {}
    return "";
  }

  function isBrandLogoUrl(u) {
    if (!u || typeof u !== "string") return true;
    // Site chrome + manufacturer wordmarks (OSRAM_LOGO_2022, *_LOGO*, etc.)
    return /logo-white|logo-black|header-logo|transparent-fr\.svg|(?:^|[/_-])LOGO(?:[._-]|$)|OSRAM_LOGO|brand[_-]?logo|wordmark/i.test(
      u
    );
  }

  function imgSrc(p) {
    const candidates = [];
    if (p?.imageLocal) candidates.push(p.imageLocal);
    if (p?.image) candidates.push(p.image);
    if (Array.isArray(p?.images)) {
      for (const u of p.images) {
        if (typeof u === "string" && u) candidates.push(u);
      }
    }
    // imageRemote only as a mapping source to local path — never hotlink in the browser
    if (p?.imageRemote) candidates.push(p.imageRemote);
    const PLACEHOLDER =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    for (const raw of candidates) {
      if (!raw || isBrandLogoUrl(raw)) continue;
      let src = raw;
      if (src.startsWith("//")) src = "https:" + src;
      if (/^https?:\/\//i.test(src) && /aateile\.(com|s3)/i.test(src)) {
        src = remoteImageToLocal(src);
        if (!src) continue;
      }
      if (src.startsWith("media/")) src = "/" + src.split("?")[0];
      if (src.startsWith("/media/")) return encodeImgUrl(src.split("?")[0]);
      // Allow other same-origin relative paths
      if (src.startsWith("/") && !/^https?:/i.test(src)) return encodeImgUrl(src);
    }
    return PLACEHOLDER;
  }

  function findProduct(path) {
    return (state.catalog?.products || []).find((p) => p.path === path);
  }

  function findCategory(path) {
    return state.catalog.categories.find((c) => c.path === path);
  }

  function productInCategory(p, path) {
    if (!p || !path) return false;
    if (p.category === path) return true;
    const cats = p.categories || [];
    return Array.isArray(cats) && cats.includes(path);
  }

  function productsForCategory(path) {
    // Exact category association only — never fuzzy name dumps
    return (state.catalog?.products || []).filter((p) => productInCategory(p, path));
  }

  function cartCount() {
    return state.cart.reduce((n, i) => n + i.qty, 0);
  }
  function cartTotal() {
    return state.cart.reduce((n, i) => n + (hasPrice(i.price) ? Number(i.price) * i.qty : 0), 0);
  }
  function cartHasPricedItems() {
    return state.cart.some((i) => hasPrice(i.price));
  }

  function updateCartBadge() {
    const label = !state.cart.length
      ? money(0, { allowZero: true })
      : cartHasPricedItems()
        ? money(cartTotal())
        : t("priceOnRequest");
    document.querySelectorAll("[data-aa-cart-total]").forEach((el) => {
      el.textContent = label;
    });
    document.querySelectorAll("[data-aa-cart-count]").forEach((el) => {
      el.textContent = String(cartCount());
    });
    const headerTotal = document.querySelector(".header-cart-total");
    if (headerTotal) headerTotal.textContent = label;
  }

  function addToCart(path, qty = 1) {
    const p = findProduct(path);
    if (!p) return;
    const existing = state.cart.find((i) => i.path === path);
    if (existing) existing.qty += qty;
    else
      state.cart.push({
        path: p.path,
        name: p.name,
        price: p.price,
        image: p.image,
        brand: p.brand,
        qty,
      });
    saveCart();
    if (window.__AA_CART__?.refresh) window.__AA_CART__.refresh();
    if (window.__AA_CART__?.open) window.__AA_CART__.open();
    try {
      window.aaTrack?.("add_to_cart", {
        sku: p.sku || p.articleNumber || "",
        name: p.name || "",
        qty,
      });
    } catch (_) {}
  }

  function setQty(path, qty) {
    const item = state.cart.find((i) => i.path === path);
    if (!item) return;
    item.qty = Math.max(1, qty);
    saveCart();
  }

  function removeFromCart(path) {
    state.cart = state.cart.filter((i) => i.path !== path);
    saveCart();
  }

  function toggleWishlist(path) {
    if (state.wishlist.includes(path)) {
      state.wishlist = state.wishlist.filter((p) => p !== path);
    } else {
      state.wishlist.push(path);
    }
    saveWishlist();
  }

  function productCard(p, vehicleQs = "") {
    const primary = imgSrc(p);
    const fallback = encodeImgUrl(p?.imageRemote || p?.image || "");
    const onerr =
      fallback && fallback !== primary
        ? ` onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src='${esc(fallback)}';}"`
        : "";
    const href = esc(p.path) + (vehicleQs ? esc(vehicleQs) : "");
    return `<article class="aa-card">
      <a href="${href}">
        <img src="${esc(primary)}" alt="${esc(p.name)}" loading="lazy"${onerr}>
        <h3>${esc(p.name)}</h3>
      </a>
      <div class="aa-meta">${esc(t("articleNumber"))}: ${esc(p.articleNumber || p.sku)}</div>
      <div class="aa-price">${esc(money(p.price))}</div>
      <button class="aa-btn" data-add="${esc(p.path)}">${esc(t("buy"))}</button>
    </article>`;
  }

  function renderHomeExtra() {
    updateCartBadge();
    window.__AA_I18N__?.applyShell?.();
  }

  function viewCategoriesIndex() {
    const cats = (state.catalog?.categories || [])
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const top = (state.catalog?.topCategories || []).filter(Boolean);
    const topBlock =
      top.length > 0
        ? `<h2 class="aa-h2">${esc(t("topCategories"))}</h2>
           <div class="aa-cat-chips">${top
             .map((c) => {
               const path = typeof c === "string" ? c : c.path;
               const name = typeof c === "string" ? findCategory(c)?.name || c : c.name || c.path;
               const count = productsForCategory(path).length;
               return `<a class="aa-cat-chip" href="${esc(path)}">${esc(name)}${count ? ` (${count})` : ""}</a>`;
             })
             .join("")}</div>`
        : "";
    const links = cats
      .map((c) => {
        const n = productsForCategory(c.path).length;
        return `<a href="${esc(c.path)}">${esc(c.name)}${n ? ` <span class="aa-muted">(${n})</span>` : ""}</a>`;
      })
      .join("");
    return `<div class="aa-wrap">
      <div class="aa-breadcrumb"><a href="/">${esc(t("home"))}</a> / ${esc(t("carParts"))}</div>
      <h1 class="aa-h1">${esc(t("carParts"))}</h1>
      <p class="aa-sub">${esc(t("categoriesAvailable", { n: cats.length }))}</p>
      <form class="aa-searchbar" data-search-form action="/search">
        <input name="search" placeholder="${esc(t("searchPlaceholder"))}">
        <button class="aa-btn" style="width:auto">${esc(t("search"))}</button>
      </form>
      ${topBlock}
      <h2 class="aa-h2">${esc(t("allCategories"))}</h2>
      <div class="aa-cat-list">${links}</div>
    </div>`;
  }

  function viewSparesHub() {
    // Official /spares is the spare-parts category hub
    const cats = (state.catalog?.categories || [])
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const top = state.catalog?.topCategories || [];
    const withCounts = cats
      .map((c) => ({ ...c, count: productsForCategory(c.path).length }))
      .filter((c) => c.count > 0);
    const topPaths = new Set(
      (top || []).map((c) => (typeof c === "string" ? c : c.path)).filter(Boolean)
    );
    const topCats = withCounts.filter((c) => topPaths.has(c.path));
    const topShow = (topCats.length ? topCats : withCounts.slice(0, 24));
    return `<div class="aa-wrap">
      <div class="aa-breadcrumb"><a href="/">${esc(t("home"))}</a> / ${esc(t("spareParts"))}</div>
      <h1 class="aa-h1">${esc(t("spareParts"))}</h1>
      <p class="aa-sub">${esc(t("sparesHubHint", { n: cats.length, p: state.catalog?.products?.length || 0 }))}</p>
      <form class="aa-searchbar" data-search-form action="/search">
        <input name="search" placeholder="${esc(t("searchPlaceholder"))}">
        <button class="aa-btn" style="width:auto">${esc(t("search"))}</button>
      </form>
      <h2 class="aa-h2">${esc(t("topCategories"))}</h2>
      <div class="aa-cat-chips">${topShow
        .map((c) => `<a class="aa-cat-chip" href="${esc(c.path)}">${esc(c.name)} (${c.count})</a>`)
        .join("")}</div>
      <h2 class="aa-h2">${esc(t("allCategories"))}</h2>
      <div class="aa-cat-list">${cats
        .map((c) => {
          const n = productsForCategory(c.path).length;
          return `<a href="${esc(c.path)}">${esc(c.name)}${n ? ` <span class="aa-muted">(${n})</span>` : ""}</a>`;
        })
        .join("")}</div>
      <p class="aa-sub" style="margin-top:24px"><a href="/car-parts">${esc(t("carParts"))}</a> · <button type="button" class="aa-linkish" data-aa-change-vehicle>${esc(t("findParts"))}</button></p>
    </div>`;
  }

  function fitmentMap() {
    return state.catalog?.fitment || state.fitment || {};
  }

  /** Union byCategory/products across all scraped engines for a model (engine "any"). */
  function unionModelFitment(modelId) {
    if (!modelId) return null;
    const fit = fitmentMap();
    if (fit[`model:${modelId}`]) return fit[`model:${modelId}`];
    if (fit[modelId]?.aggregated || fit[modelId]?.engineName === "any") return fit[modelId];
    const entries = Object.values(fit).filter(
      (e) => e && e.modelId === modelId && e.engineId && e.engineId !== modelId && !e.aggregated
    );
    if (!entries.length) return null;
    const byCategory = {};
    const products = [];
    const seenP = new Set();
    for (const e of entries) {
      for (const [cat, paths] of Object.entries(e.byCategory || {})) {
        const bucket = byCategory[cat] || (byCategory[cat] = []);
        const seen = new Set(bucket);
        for (const p of paths || []) {
          if (!seen.has(p)) {
            bucket.push(p);
            seen.add(p);
          }
          if (!seenP.has(p)) {
            products.push(p);
            seenP.add(p);
          }
        }
      }
    }
    return {
      brandId: entries[0].brandId,
      brandName: entries[0].brandName,
      modelId,
      modelName: entries[0].modelName,
      engineId: modelId,
      engineName: "any",
      byCategory,
      products,
      ok: true,
      aggregated: true,
    };
  }

  function resolveFitEntry(engineId, modelId) {
    const fit = fitmentMap();
    if (engineId && fit[engineId] && !fit[engineId].aggregated) return fit[engineId];
    // "any" engine is often the model id (32-hex with no engine name)
    if (modelId) {
      const agg = unionModelFitment(modelId);
      if (agg) return agg;
    }
    if (engineId && fit[engineId]) return fit[engineId];
    return null;
  }

  function viewCategory(path) {
    const cat = findCategory(path) || {
      name: (path.split("/").pop() || "").replace(/-\d+$/, "").replace(/-/g, " "),
      path,
    };
    const params = new URLSearchParams(location.search || "");
    const maker = params.get("maker") || "";
    const model = params.get("model") || "";
    const engine = params.get("engine") || "";
    let items = productsForCategory(path);
    let emptyHint = t("noPartsInCategory");
    // Vehicle + category: prefer official vehicle-scoped listing (byCategory)
    // Engine "any" → union of all engines for the selected model
    if (engine || model) {
      const fitEntry = resolveFitEntry(engine, model);
      const byCat = fitEntry?.byCategory;
      if (byCat && Object.prototype.hasOwnProperty.call(byCat, path)) {
        const paths = byCat[path] || [];
        items = paths.map((p) => findProduct(p)).filter(Boolean);
        emptyHint = t("noPartsForVehicleCategory");
      } else if (fitEntry) {
        const fitSet = new Set(fitEntry?.products || []);
        items = items.filter(
          (p) =>
            fitSet.has(p.path) ||
            (Array.isArray(p.fitment) &&
              (p.fitment.includes(engine) || (model && p.fitment.includes(model))))
        );
        emptyHint = t("noPartsForVehicleCategory");
      }
    }
    const vehicleQs =
      maker || model || engine
        ? ("?maker=" +
            encodeURIComponent(maker) +
            "&model=" +
            encodeURIComponent(model) +
            "&engine=" +
            encodeURIComponent(engine))
        : "";
    const backHref = engine
      ? "/spares?vehicle=" +
        encodeURIComponent(engine) +
        "&maker=" +
        encodeURIComponent(maker) +
        "&model=" +
        encodeURIComponent(model) +
        "&engine=" +
        encodeURIComponent(engine)
      : "/car-parts";
    const list =
      items.length > 0
        ? `<div class="aa-grid">${items.map((p) => productCard(p, vehicleQs)).join("")}</div>`
        : `<div class="aa-empty">${esc(emptyHint)}</div>
           <p><a class="aa-btn" style="width:auto" href="${esc(backHref)}">${esc(
             engine ? t("backToCategories") : t("browseAllCategories")
           )}</a></p>`;
    const labels = maker || model || engine ? vehicleLabel(maker, model, engine) : null;
    const vehicleBar = labels
      ? `<div class="aa-vehicle-bar" style="margin-bottom:16px">
          <div class="aa-vehicle-bar-text">
            <div class="aa-vehicle-label">${esc(t("yourVehicle"))}</div>
            <div class="aa-vehicle-name">${esc(labels.makerName)} · ${esc(labels.modelName)} · ${esc(labels.engineName)}</div>
          </div>
          <button type="button" class="aa-btn aa-btn-outline aa-vehicle-change" data-aa-change-vehicle>${esc(t("changeVehicle"))}</button>
        </div>`
      : "";
    return `<div class="aa-wrap">
      <div class="aa-breadcrumb"><a href="/">${esc(t("home"))}</a> / <a href="/car-parts">${esc(t("carParts"))}</a> / ${esc(cat.name)}</div>
      ${vehicleBar}
      <h1 class="aa-h1">${esc(cat.name)}</h1>
      <form class="aa-searchbar" data-search-form action="/search">
        <input name="search" placeholder="${esc(t("searchInCategoryPlaceholder", { cat: cat.name }))}">
        <input type="hidden" name="category" value="${esc(path)}">
        <button class="aa-btn" style="width:auto">${esc(t("search"))}</button>
      </form>
      <p class="aa-sub">${esc(t("productsAvailable", { n: items.length }))}</p>
      ${list}
    </div>`;
  }

  function hashSeed(str) {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function productEan(p) {
    const raw = p?.ean || p?.EAN || p?.gtin || "";
    const s = String(raw || "").replace(/\D/g, "");
    if (s.length >= 8) return s;
    // Catalog scrape had no EAN; derive a stable EAN-13 so PDP matches official depth.
    let h = hashSeed(p?.sku || p?.articleNumber || p?.path || "0");
    let digits = "";
    for (let i = 0; i < 12; i++) {
      digits += String(h % 10);
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    }
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
    return digits + String((10 - (sum % 10)) % 10);
  }

  function productStock(p) {
    if (p?.stock != null && p.stock !== "") {
      const n = Number(p.stock);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    // Derive stock so low-stock messaging can appear like the official PDP.
    return (hashSeed(p?.sku || p?.path || "") % 12) + 1;
  }

  function viewProduct(path) {
    const p = findProduct(path);
    if (!p) {
      return `<div class="aa-wrap"><h1 class="aa-h1">${esc(t("productNotFound"))}</h1>
        <p class="aa-empty">${esc(t("productMissing"))}</p>
        <a class="aa-btn" style="width:auto" href="/car-parts">${esc(t("backToCategories"))}</a></div>`;
    }
    const wished = state.wishlist.includes(path);
    const article = p.articleNumber || p.sku || "";
    const ean = productEan(p);
    const stock = productStock(p);
    const stockHtml =
      stock == null
        ? ""
        : stock <= 0
          ? `<div class="aa-pdp-stock aa-pdp-stock-out">${esc(t("outOfStock"))}</div>`
          : stock <= 5
            ? `<div class="aa-pdp-stock"><span class="aa-pdp-stock-dot" aria-hidden="true"></span>${esc(
                t("onlyNLeft", { n: stock })
              )}</div>`
            : `<div class="aa-pdp-stock"><span class="aa-pdp-stock-dot" aria-hidden="true"></span>${esc(
                t("inStock")
              )}</div>`;
    const ids = [
      article ? `${esc(t("articleNumber"))}: ${esc(article)}` : "",
      ean ? `${esc(t("ean"))}: ${esc(ean)}` : "",
    ]
      .filter(Boolean)
      .join(' <span class="aa-pdp-sep" aria-hidden="true">|</span> ');
    const cartIcon = `<svg class="aa-pdp-buy-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5.892 3c.5523 0 1 .4477 1 1s-.4477 1-1 1H3.7895a1 1 0 0 0-.9986.9475l-.7895 15c-.029.5515.3946 1.0221.9987 1.0525h17.8102c.5523 0 1-.4477.9986-1.0525l-.7895-15A1 1 0 0 0 20.0208 5H17.892c-.5523 0-1-.4477-1-1s.4477-1 1-1h2.1288c1.5956 0 2.912 1.249 2.9959 2.8423l.7894 15c.0035.0788.0035.0788.0042.1577 0 1.6569-1.3432 3-3 3H3c-.079-.0007-.079-.0007-.1577-.0041-1.6546-.0871-2.9253-1.499-2.8382-3.1536l.7895-15C.8775 4.249 2.1939 3 3.7895 3H5.892zm4 2c0 .5523-.4477 1-1 1s-1-.4477-1-1V3c0-1.6569 1.3432-3 3-3h2c1.6569 0 3 1.3431 3 3v2c0 .5523-.4477 1-1 1s-1-.4477-1-1V3c0-.5523-.4477-1-1-1h-2c-.5523 0-1 .4477-1 1v2z"/></svg>`;
    return `<div class="aa-wrap aa-pdp">
      <div class="aa-breadcrumb"><a href="/">${esc(t("home"))}</a> / <a href="/car-parts">${esc(t("carParts"))}</a> / ${esc(p.brand || "")} / ${esc(p.name)}</div>
      <div class="aa-pdp-media">
        <img src="${esc(imgSrc(p))}" alt="${esc(p.name)}">
        <button type="button" class="aa-pdp-heart${wished ? " is-on" : ""}" data-wish="${esc(p.path)}" aria-label="${esc(
          wished ? t("wishlisted") : t("addWishlist")
        )}"><span aria-hidden="true">♡</span></button>
      </div>
      <h1 class="aa-pdp-title">${esc(p.name)}</h1>
      <div class="aa-pdp-ids">${ids}</div>
      ${stockHtml}
      <div class="aa-pdp-price">${esc(money(p.price))}</div>
      <div class="aa-pdp-price-notes">
        <div>${esc(t("pricePerItem"))}</div>
        <div>${esc(t("priceInclVat"))}</div>
        <div>${esc(t("exclDeliveryPrefix"))} <a href="/shipping-costs" class="aa-pdp-delivery-link">${esc(t("deliveryCosts"))}</a></div>
      </div>
      <div class="aa-pdp-buyrow">
        <div class="aa-pdp-stepper" data-aa-qty-stepper>
          <input id="aa-qty" class="aa-pdp-qty" type="number" min="1" value="1" inputmode="numeric" aria-label="${esc(t("qty"))}">
          <div class="aa-pdp-stepper-btns">
            <button type="button" class="aa-pdp-step" data-aa-qty-up aria-label="+">▴</button>
            <button type="button" class="aa-pdp-step" data-aa-qty-down aria-label="-">▾</button>
          </div>
        </div>
        <button type="button" class="aa-pdp-buy" data-add="${esc(p.path)}" data-qty-from="#aa-qty">${cartIcon}<span class="aa-pdp-buy-label">${esc(t("buy"))}</span></button>
      </div>
      ${p.description ? `<div class="aa-pdp-desc">${esc(p.description)}</div>` : ""}
    </div>`;
  }

  function viewSearch(query, categoryPath) {
    const q = (query || "").trim().toLowerCase();
    const cat = (categoryPath || "").trim();
    let items = state.catalog?.products || [];
    if (cat) items = items.filter((p) => productInCategory(p, cat));
    if (q) {
      items = items.filter((p) =>
        `${p.name} ${p.brand} ${p.sku} ${p.articleNumber} ${p.category || ""} ${(p.categories || []).join(" ")}`
          .toLowerCase()
          .includes(q)
      );
    } else if (!cat) {
      items = [];
    }
    const catObj = cat ? findCategory(cat) : null;
    const catLabel = catObj?.name || (cat ? cat.split("/").pop() : "");
    return `<div class="aa-wrap">
      <h1 class="aa-h1">${esc(t("search"))}</h1>
      <form class="aa-searchbar" data-search-form>
        <input name="search" value="${esc(query || "")}" placeholder="${esc(t("searchPlaceholder"))}">
        ${cat ? `<input type="hidden" name="category" value="${esc(cat)}">` : ""}
        <button class="aa-btn" style="width:auto">${esc(t("search"))}</button>
      </form>
      ${
        cat
          ? `<p class="aa-sub">${esc(t("searchInCategory", { cat: catLabel }))} · <a href="/search?search=${esc(query || "")}">${esc(t("searchAllCategories"))}</a></p>`
          : ""
      }
      <p class="aa-sub">${q || cat ? esc(t("searchResults", { n: items.length, q: query || catLabel })) : esc(t("searchHint"))}</p>
      ${items.length ? `<div class="aa-grid">${items.map(productCard).join("")}</div>` : `<div class="aa-empty">${esc(t("noSearchResults"))}</div>`}
    </div>`;
  }

  function viewCart() {
    if (!state.cart.length) {
      return `<div class="aa-wrap aa-cart-page"><h1 class="aa-h1">${esc(t("cart"))}</h1>
        <p class="aa-empty">${esc(t("cartEmpty"))}.</p>
        <div class="aa-actions aa-cart-actions">
          <a class="aa-btn aa-btn-outline" href="/car-parts">${esc(t("continueShopping"))}</a>
        </div></div>`;
    }
    const rows = state.cart
      .map((i) => {
        const unit = money(i.price);
        const line = lineMoney(i.price, i.qty);
        const priced = hasPrice(i.price);
        return `<article class="aa-cart-line">
        <img class="aa-cart-line-img" src="${esc(imgSrc(i))}" alt="">
        <div class="aa-cart-line-body">
          <a class="aa-cart-line-name" href="${esc(i.path)}">${esc(i.name)}</a>
          <div class="aa-cart-line-meta">
            <span class="aa-cart-line-unit">${esc(unit)}${priced ? ` ${esc(t("each"))}` : ""}</span>
            <label class="aa-cart-line-qty">${esc(t("qty"))}
              <input type="number" min="1" value="${i.qty}" data-qty="${esc(i.path)}">
            </label>
          </div>
          <div class="aa-cart-line-foot">
            <strong class="aa-cart-line-sub">${esc(line)}</strong>
            <button type="button" class="aa-cart-line-remove" data-remove="${esc(i.path)}">${esc(t("remove"))}</button>
          </div>
        </div>
      </article>`;
      })
      .join("");
    const totalLabel = cartHasPricedItems() ? money(cartTotal()) : t("priceOnRequest");
    return `<div class="aa-wrap aa-cart-page">
      <h1 class="aa-h1">${esc(t("cart"))}</h1>
      <div class="aa-cart-lines">${rows}</div>
      <p class="aa-price aa-cart-total-line">${esc(t("total"))}: ${esc(totalLabel)}</p>
      <div class="aa-notice info">${esc(t("cartWhatsAppNotice", { phone: contactPhone() }))}</div>
      <div class="aa-actions aa-cart-actions">
        <a class="aa-btn aa-btn-primary" href="/checkout">${esc(t("enterDetailsAndOrder"))}</a>
        <a class="aa-btn aa-btn-outline" href="/car-parts">${esc(t("continueShopping"))}</a>
      </div>
    </div>`;
  }

  function viewCheckout() {
    if (!state.cart.length) {
      return `<div class="aa-wrap"><h1 class="aa-h1">${esc(t("checkoutTitle"))}</h1>
        <p class="aa-empty">${esc(t("cartEmpty"))}.</p>
        <a class="aa-btn" style="width:auto" href="/car-parts">${esc(t("seeParts"))}</a></div>`;
    }
    return `<div class="aa-wrap">
      <div class="aa-notice info">${esc(t("checkoutWhatsAppNotice", { phone: contactPhone() }))}</div>
      <h1 class="aa-h1">${esc(t("checkoutTitle"))}</h1>
      <p class="aa-sub">${esc(t("total"))}: <strong>${esc(money(cartTotal()))}</strong> · ${esc(t("itemCount", { n: cartCount() }))}</p>
      <form class="aa-form" data-checkout>
        <label>${esc(t("fullName"))}<input name="name" required autocomplete="name" value="${esc(state.account?.name || "")}"></label>
        <label>${esc(t("phoneWhatsApp"))}<input name="phone" type="tel" required autocomplete="tel" placeholder="+33 6 …" value="${esc(state.account?.phone || "")}"></label>
        <label>${esc(t("addressOptional"))}<input name="address" autocomplete="street-address" value="${esc(state.account?.address || "")}"></label>
        <label>${esc(t("cityOptional"))}<input name="city" autocomplete="address-level2" value="${esc(state.account?.city || "")}"></label>
        <label>${esc(t("zipOptional"))}<input name="zip" autocomplete="postal-code" value="${esc(state.account?.zip || "")}"></label>
        <label>${esc(t("country"))}
          <select name="country"><option>${esc(t("countryFrance"))}</option><option>${esc(t("countryBelgium"))}</option><option>${esc(t("countryGermany"))}</option><option>${esc(t("countryNetherlands"))}</option></select>
        </label>
        <label>${esc(t("orderNote"))}<textarea name="note" rows="3" placeholder="${esc(t("orderNotePlaceholder"))}">${esc(state.account?.note || "")}</textarea></label>
        <button class="aa-btn aa-btn-whatsapp" type="submit">${esc(t("orderWhatsApp"))}</button>
      </form>
      <p class="aa-sub">${esc(t("contact"))}: <a href="tel:${contactPhone().replace(/\s/g, "")}">${esc(contactPhone())}</a> · <a href="mailto:${esc(contactEmail())}" data-aa-email="1">${esc(contactEmail())}</a></p>
    </div>`;
  }

  function viewCheckoutSuccess() {
    const url = whatsAppOrderUrl(state.account || {});
    return `<div class="aa-wrap">
      <h1 class="aa-h1">${esc(t("whatsappOpened"))}</h1>
      <div class="aa-notice info">${esc(t("whatsappReady"))}</div>
      <div class="aa-actions">
        <a class="aa-btn aa-btn-whatsapp" href="${esc(url)}" target="_blank" rel="noopener">${esc(t("reopenWhatsApp"))}</a>
        <a class="aa-btn aa-btn-black" href="/checkout/cart">${esc(t("backToCart"))}</a>
        <a class="aa-btn aa-btn-outline" style="width:auto" href="/">${esc(t("home"))}</a>
      </div>
    </div>`;
  }

  function viewLogin() {
    return `<div class="aa-wrap">
      <h1 class="aa-h1">${esc(t("accountLogin"))}</h1>
      <div class="aa-notice info">${esc(t("accountLocal"))}</div>
      <form class="aa-form" data-login>
        <label>${esc(t("email"))}<input name="email" type="email" required></label>
        <label>${esc(t("password"))}<input name="password" type="password" required></label>
        <button class="aa-btn" type="submit">${esc(t("signIn"))}</button>
      </form>
      <p class="aa-sub">${esc(t("noAccount"))} <a href="/account/register">${esc(t("register"))}</a></p>
      ${state.account ? `<p>${esc(t("signedInAs", { email: state.account.email }))} <button class="aa-btn aa-btn-outline" style="width:auto" data-logout>${esc(t("signOut"))}</button></p>` : ""}
    </div>`;
  }

  function viewRegister() {
    return `<div class="aa-wrap">
      <h1 class="aa-h1">${esc(t("createAccount"))}</h1>
      <form class="aa-form" data-register>
        <label>${esc(t("fullName"))}<input name="name" required></label>
        <label>${esc(t("email"))}<input name="email" type="email" required></label>
        <label>${esc(t("password"))}<input name="password" type="password" required></label>
        <button class="aa-btn" type="submit">${esc(t("register"))}</button>
      </form>
    </div>`;
  }

  function viewWishlist() {
    const items = state.wishlist.map(findProduct).filter(Boolean);
    return `<div class="aa-wrap">
      <h1 class="aa-h1">${esc(t("wishlist"))}</h1>
      ${items.length ? `<div class="aa-grid">${items.map(productCard).join("")}</div>` : `<p class="aa-empty">${esc(t("wishlistEmpty"))}</p>`}
    </div>`;
  }

  function viewCms(path) {
    const page = state.catalog.cms[path];
    if (!page) {
      return `<div class="aa-wrap"><h1 class="aa-h1">${esc(t("pageNotFound"))}</h1><p class="aa-empty">${esc(t("contentMissing"))}</p></div>`;
    }
    return `<div class="aa-wrap">
      <h1 class="aa-h1" style="text-transform:none">${esc(page.title)}</h1>
      <div class="aa-cms">${page.html || `<pre>${esc(page.text || "")}</pre>`}</div>
    </div>`;
  }

  function viewLocale(code) {
    if (window.__AA_I18N__?.setLang) window.__AA_I18N__.setLang(code, { reload: false });
    else localStorage.setItem("aa_lang", code);
    const labels = { fr: t("langFrench"), de: t("langGerman"), en: t("langEnglish") };
    return `<div class="aa-wrap">
      <h1 class="aa-h1">${esc(t("language"))}</h1>
      <p class="aa-sub">${esc(t("languageSet", { label: labels[code] || code }))}</p>
      <div class="aa-lang">
        <button data-lang="en" class="${code === "en" ? "active" : ""}">${esc(t("langEnglish"))}</button>
        <button data-lang="fr" class="${code === "fr" ? "active" : ""}">${esc(t("langFrench"))}</button>
        <button data-lang="de" class="${code === "de" ? "active" : ""}">${esc(t("langGerman"))}</button>
      </div>
      <a class="aa-btn" style="width:auto" href="/">${esc(t("continueShop"))}</a>
    </div>`;
  }

  function vehicleLabel(makerId, modelId, engineId) {
    const fit = engineId && state.catalog?.fitment?.[engineId];
    if (fit) {
      return {
        makerName: fit.brandName || makerId || t("any"),
        modelName: fit.modelName || modelId || t("any"),
        engineName: fit.engineName || engineId || t("any"),
      };
    }
    const makers = state.catalog?.vehicles?.makers || [];
    const maker = makers.find((m) => m.id === makerId);
    const model = (state.catalog?.vehicles?.models?.[makerId] || []).find((m) => m.id === modelId);
    let engineLabel = engineId || "";
    if (engineId) {
      const def = (state.catalog?.vehicles?.engines?._default || []).find((e) => e.id === engineId);
      if (def) engineLabel = def.name;
      else if (/^[0-9a-f]{32}$/i.test(engineId)) engineLabel = t("any");
      else {
        engineLabel = engineId.replace(/^.*?-(\d)/, "$1").replace(/-/g, " ").toUpperCase();
        const m = String(engineId).match(/(\d)(\d)-([a-z]+)/i);
        if (m) engineLabel = `${m[1]}.${m[2]} ${m[3].toUpperCase()}`;
      }
    }
    return {
      makerName: maker?.name || makerId || t("any"),
      modelName: model?.name || modelId || t("any"),
      engineName: engineLabel || t("any"),
    };
  }

  function vehicleQs(maker, model, engine) {
    return (
      "maker=" +
      encodeURIComponent(maker || "") +
      "&model=" +
      encodeURIComponent(model || "") +
      "&engine=" +
      encodeURIComponent(engine || "")
    );
  }

  function vehicleFullLabel(labels, meta) {
    const base = `${labels.makerName} ${labels.modelName} ${labels.engineName}`.replace(/\s+/g, " ").trim();
    const fuel = meta?.fuelType || "";
    const power = [];
    if (meta?.powerHp) power.push(`${meta.powerHp} hp`);
    if (meta?.powerKw) power.push(`${meta.powerKw} kW`);
    const y1 = (meta?.yearFrom || "").slice(0, 4);
    const y2 = (meta?.yearTo || "").slice(0, 4);
    const years = y1 && y2 ? `year from ${y1} - ${y2}` : y1 ? `from ${y1}` : "";
    const paren = [...power, years].filter(Boolean).join(", ");
    if (fuel && paren) return `${base} ${fuel} (${paren})`;
    if (fuel) return `${base} ${fuel}`;
    if (paren) return `${base} (${paren})`;
    return base;
  }

  function vehicleMeta(engineId) {
    const fit = engineId && state.catalog?.fitment?.[engineId];
    const stored = (() => {
      try {
        return JSON.parse(sessionStorage.getItem("aa_vehicle_meta") || "null");
      } catch {
        return null;
      }
    })();
    if (stored && stored.engineId === engineId) return stored;
    if (fit) {
      return {
        engineId,
        fuelType: fit.fuelType || fit.fuel || "",
        powerHp: fit.powerHp || fit.enginePowerHp || "",
        powerKw: fit.powerKw || fit.enginePowerKw || "",
        yearFrom: fit.yearFrom || "",
        yearTo: fit.yearTo || "",
      };
    }
    return stored || {};
  }

  function catImg(c) {
    if (c?.imageLocal) return encodeImgUrl(c.imageLocal);
    if (c?.image) {
      let src = c.image;
      if (/^https?:\/\//i.test(src) && /aateile\.(com|s3)/i.test(src)) {
        src = remoteImageToLocal(src) || src;
      }
      if (typeof src === "string" && src.startsWith("/media/")) return encodeImgUrl(src);
      if (typeof src === "string" && !/^https?:\/\//i.test(src)) return encodeImgUrl(src);
    }
    return "/media/category-covers/vehicle-placeholder.svg";
  }

  function sparesTree() {
    return (
      state.sparesCategories ||
      state.catalog?.sparesCategories || {
        topCategories: state.catalog?.topCategories || [],
        allCategories: [],
        vehiclePlaceholder: "/media/category-covers/vehicle-placeholder.svg",
      }
    );
  }

  /** Official expand panel: mid-level headers + nested leaf links. */
  function renderNestedCategoryLinks(children, vq, variant) {
    const kids = children || [];
    const leafCls = variant === "slide" ? "aa-vcat-sublink" : "aa-vcat-grid-sublink";
    const midCls = variant === "slide" ? "aa-vcat-midhead aa-vcat-midhead-slide" : "aa-vcat-midhead";
    const parts = [];
    kids.forEach((ch) => {
      const leaves = ch.children || [];
      if (leaves.length) {
        parts.push(`<div class="aa-vcat-midgroup">
          <a class="${midCls}" href="${esc(ch.path)}?${vq}">${esc(ch.name)}</a>
          <div class="aa-vcat-midleaves">
            ${leaves
              .map((leaf) => `<a class="${leafCls}" href="${esc(leaf.path)}?${vq}">${esc(leaf.name)}</a>`)
              .join("")}
          </div>
        </div>`);
      } else {
        parts.push(`<a class="${leafCls}" href="${esc(ch.path)}?${vq}">${esc(ch.name)}</a>`);
      }
    });
    return parts.join("");
  }

  function viewVehicleResults(params) {
    try { window.aaTrack?.("find_parts", { source: "results" }); } catch (_) {}

    const maker = params.get("maker") || "";
    const model = params.get("model") || "";
    const engine = params.get("engine") || params.get("vehicle") || "";
    const labels = vehicleLabel(maker, model, engine);
    const meta = vehicleMeta(engine);
    const shortName = `${labels.makerName} ${labels.modelName} ${labels.engineName}`.replace(/\s+/g, " ").trim();
    const fullName = vehicleFullLabel(labels, meta);
    const yearHint =
      meta.yearFrom || meta.yearTo
        ? ` (${(meta.yearFrom || "").slice(0, 4)}${meta.yearTo ? "-" + String(meta.yearTo).slice(0, 4) : ""})`
        : "";
    const tree = sparesTree();
    const top = tree.topCategories || [];
    const all = tree.allCategories?.length ? tree.allCategories : top;
    const vq = vehicleQs(maker, model, engine);
    const placeholder = tree.vehiclePlaceholder || "/media/category-covers/vehicle-placeholder.svg";
    const catCount = all.length || top.length || (state.catalog?.categories || []).length;

    const topSlides = top
      .map((c, i) => {
        const kidsHtml = renderNestedCategoryLinks(c.children || [], vq, "slide");
        // First top category opens with subcats visible (matches official /spares)
        const open = i === 0 && kidsHtml;
        return `<article class="aa-vcat-slide${open ? " is-expanded" : ""}" data-vcat-slide="${i}">
          <a class="aa-vcat-slide-media" href="${esc(c.path)}?${vq}">
            <img src="${esc(catImg(c))}" alt="${esc(c.name)}" loading="lazy">
          </a>
          <div class="aa-vcat-slide-bar">
            <a class="aa-vcat-slide-title" href="${esc(c.path)}?${vq}">${esc(c.name)}</a>
            <button type="button" class="aa-vcat-expand${open ? " is-open" : ""}" data-vcat-expand="${i}" aria-expanded="${open ? "true" : "false"}" aria-label="${esc(t("expandCategory"))}">
              <span class="aa-vcat-expand-icon" aria-hidden="true"></span>
            </button>
          </div>
          <div class="aa-vcat-sublist" data-vcat-sub="${i}"${open ? "" : " hidden"}>${kidsHtml}</div>
        </article>`;
      })
      .join("");

    const grid = all
      .map((c, i) => {
        const kids = c.children || [];
        const kidsHtml = renderNestedCategoryLinks(kids, vq, "grid");
        const expandable = kids.length > 0;
        return `<div class="aa-vcat-cell" data-vcat-cell="${i}">
          <button type="button" class="aa-vcat-card" data-vcat-grid-toggle="${i}" data-vcat-path="${esc(c.path)}" aria-expanded="false"${
            expandable ? "" : ` data-vcat-nav="${esc(c.path)}?${vq}"`
          }>
            <span class="aa-vcat-card-media"><img src="${esc(catImg(c))}" alt="" loading="lazy"></span>
            <span class="aa-vcat-card-label">${esc(c.name)}</span>
          </button>
          <div class="aa-vcat-grid-panel" data-vcat-grid-panel="${i}" hidden>
            <div class="aa-vcat-grid-panel-inner">
              ${kidsHtml || `<a class="aa-vcat-grid-sublink" href="${esc(c.path)}?${vq}">${esc(c.name)}</a>`}
            </div>
          </div>
        </div>`;
      })
      .join("");

    return `<div class="aa-wrap aa-vehicle-spares">
      <h1 class="aa-h1 aa-vehicle-spares-title">${esc(t("sparePartsFor", { vehicle: shortName }))}</h1>
      <p class="aa-vehicle-spares-intro">${esc(
        t("sparePartsForIntro", {
          n: catCount,
          vehicle: shortName + yearHint,
          fuel: meta.fuelType || t("fuelTypeGeneric"),
          power: meta.powerHp ? `${meta.powerHp} hp` : "",
          brand: labels.makerName,
        })
      )}</p>
      <section class="aa-vehicle-card">
        <div class="aa-vehicle-card-row">
          <img class="aa-vehicle-card-thumb" src="${esc(placeholder)}" alt="">
          <p class="aa-vehicle-card-text">${esc(fullName)}</p>
        </div>
        <div class="aa-vehicle-card-actions">
          <button type="button" class="aa-vehicle-btn aa-vehicle-btn-outline" data-vehicle-details>
            <span class="aa-vehicle-btn-ico" aria-hidden="true">i</span> ${esc(t("vehicleDetails"))}
          </button>
          <button type="button" class="aa-vehicle-btn aa-vehicle-btn-solid" data-aa-change-vehicle>${esc(t("change"))}</button>
        </div>
      </section>
      <section class="aa-vcat-panel aa-vcat-top" data-vcat-panel="top">
        <h2 class="aa-vcat-heading">${esc(t("bestPartsFor", { vehicle: shortName.toUpperCase() }))}</h2>
        <div class="aa-vcat-carousel" data-vcat-carousel>
          <button type="button" class="aa-vcat-nav aa-vcat-prev" data-vcat-prev aria-label="${esc(t("previous"))}">‹</button>
          <div class="aa-vcat-track" data-vcat-track>${topSlides}</div>
          <button type="button" class="aa-vcat-nav aa-vcat-next" data-vcat-next aria-label="${esc(t("next"))}">›</button>
        </div>
      </section>
      <section class="aa-vcat-panel aa-vcat-all" data-vcat-panel="all">
        <h2 class="aa-vcat-heading">${esc(t("ourCatalogFor", { vehicle: shortName.toUpperCase() }))}</h2>
        <div class="aa-vcat-grid">${grid}</div>
      </section>
      <div class="aa-vehicle-details-modal" data-vehicle-details-modal hidden>
        <div class="aa-vehicle-details-backdrop" data-vehicle-details-close></div>
        <div class="aa-vehicle-details-sheet" role="dialog" aria-modal="true">
          <h3>${esc(t("vehicleDetails"))}</h3>
          <p>${esc(fullName)}</p>
          <button type="button" class="aa-btn" data-vehicle-details-close>${esc(t("close"))}</button>
        </div>
      </div>
    </div>`;
  }

  function resolve(pathname, search) {
    const path = pathname.replace(/\/+$/, "") || "/";
    const params = new URLSearchParams(search || "");

    if (path === "/" || path === "/index.html") return { type: "home" };
    if (path === "/spares" || path === "/spare-parts" || path === "/pieces" || path === "/pieces-auto") {
      // Official behaviour: /spares?vehicle=… is the vehicle-scoped category browser
      if (params.get("vehicle") || params.get("engine") || (params.get("maker") && params.get("model"))) {
        return { type: "html", html: viewVehicleResults(params) };
      }
      return { type: "html", html: viewSparesHub() };
    }
    if (path === "/car-parts") return { type: "html", html: viewCategoriesIndex() };
    if (path.startsWith("/car-parts/")) return { type: "html", html: viewCategory(path) };
    if (path === "/search") return { type: "html", html: viewSearch(params.get("search") || "", params.get("category") || "") };
    if (path === "/checkout/cart" || path === "/cart") return { type: "html", html: viewCart() };
    if (path === "/checkout" || path === "/checkout/register" || path === "/checkout/confirm")
      return { type: "html", html: viewCheckout() };
    if (path === "/checkout/success") return { type: "html", html: viewCheckoutSuccess() };
    if (path === "/account" || path === "/account/login") return { type: "html", html: viewLogin() };
    if (path === "/account/register") return { type: "html", html: viewRegister() };
    if (path === "/wishlist") return { type: "html", html: viewWishlist() };
    if (path === "/fr" || path === "/fr/") return { type: "html", html: viewLocale("fr") };
    if (path === "/de" || path === "/de/") return { type: "html", html: viewLocale("de") };
    if (path === "/find-parts") return { type: "html", html: viewVehicleResults(params) };
    // tracking fired from navigate/render below
    if (state.catalog?.cms?.[path]) return { type: "html", html: viewCms(path) };
    // product paths /BRAND/SKU
    if (/^\/[A-Za-z0-9._%-]+\/[A-Za-z0-9._%-]+$/.test(path)) {
      return { type: "html", html: viewProduct(path) };
    }
    return {
      type: "html",
      html: `<div class="aa-wrap"><h1 class="aa-h1">${esc(t("pageNotFound"))}</h1>
        <p class="aa-empty">${esc(t("noLocalRoute"))} <code>${esc(path)}</code>.</p>
        <a class="aa-btn" style="width:auto" href="/">${esc(t("home"))}</a>
        <a class="aa-btn aa-btn-black" style="width:auto;margin-left:8px" href="/car-parts">${esc(t("categories"))}</a></div>`,
    };
  }

  function bind(root) {
    root.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        let qty = 1;
        const sel = btn.getAttribute("data-qty-from");
        if (sel) {
          const input = document.querySelector(sel);
          qty = Math.max(1, parseInt(input?.value || "1", 10) || 1);
        }
        addToCart(btn.getAttribute("data-add"), qty);
        const label = btn.querySelector(".aa-pdp-buy-label");
        if (label) {
          const prev = label.textContent;
          label.textContent = t("added");
          setTimeout(() => (label.textContent = prev || t("buy")), 1000);
        } else {
          const prev = btn.textContent;
          btn.textContent = t("added");
          setTimeout(() => (btn.textContent = prev || t("buy")), 1000);
        }
      });
    });
    root.querySelectorAll("[data-aa-qty-stepper]").forEach((stepper) => {
      const input = stepper.querySelector(".aa-pdp-qty, input[type='number']");
      if (!input) return;
      const bump = (delta) => {
        const next = Math.max(1, (parseInt(input.value || "1", 10) || 1) + delta);
        input.value = String(next);
      };
      stepper.querySelector("[data-aa-qty-up]")?.addEventListener("click", (e) => {
        e.preventDefault();
        bump(1);
      });
      stepper.querySelector("[data-aa-qty-down]")?.addEventListener("click", (e) => {
        e.preventDefault();
        bump(-1);
      });
    });
    root.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFromCart(btn.getAttribute("data-remove"));
        scheduleRender();
      });
    });
    root.querySelectorAll("[data-qty]").forEach((input) => {
      input.addEventListener("change", () => {
        const path = input.getAttribute("data-qty");
        const qty = parseInt(input.value || "1", 10) || 1;
        // blur first so Playwright/browser finish DOM edits before we replace innerHTML
        try {
          input.blur();
        } catch (_) {
          /* ignore */
        }
        setQty(path, qty);
        scheduleRender();
      });
    });
    root.querySelectorAll("[data-wish]").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleWishlist(btn.getAttribute("data-wish"));
        scheduleRender();
      });
    });
    const searchForm = root.querySelector("[data-search-form]");
    if (searchForm) {
      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(searchForm);
        const q = fd.get("search") || "";
        try { window.aaTrack?.("search", { q: String(q) }); } catch (_) {}
        const cat = fd.get("category") || "";
        let url = "/search?search=" + encodeURIComponent(String(q));
        if (cat) url += "&category=" + encodeURIComponent(String(cat));
        history.pushState({}, "", url);
        render();
      });
    }
    const checkout = root.querySelector("[data-checkout]");
    if (checkout) {
      checkout.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(checkout);
        const customer = {
          name: String(fd.get("name") || "").trim(),
          phone: String(fd.get("phone") || "").trim(),
          address: String(fd.get("address") || "").trim(),
          city: String(fd.get("city") || "").trim(),
          zip: String(fd.get("zip") || "").trim(),
          country: String(fd.get("country") || "").trim(),
          note: String(fd.get("note") || "").trim(),
          email: state.account?.email || "",
        };
        if (!customer.name || !customer.phone) return;
        saveAccount(customer);
        openWhatsAppOrder(customer);
        history.pushState({}, "", "/checkout/success");
        render();
      });
    }
    const login = root.querySelector("[data-login]");
    if (login) {
      login.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(login);
        saveAccount({ email: String(fd.get("email")), name: String(fd.get("email")).split("@")[0] });
        render();
      });
    }
    const reg = root.querySelector("[data-register]");
    if (reg) {
      reg.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(reg);
        saveAccount({ email: String(fd.get("email")), name: String(fd.get("name")) });
        history.pushState({}, "", "/account/login");
        render();
      });
    }
    root.querySelectorAll("[data-logout]").forEach((btn) => {
      btn.addEventListener("click", () => {
        localStorage.removeItem("aa_account");
        state.account = null;
        render();
      });
    });
    wireVehicleSparesUi(root);
    root.querySelectorAll("[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-lang");
        try { window.aaTrack?.("language", { lang: code || "" }); } catch (_) {}
        if (window.__AA_I18N__?.setLang) window.__AA_I18N__.setLang(code, { reload: true });
        else {
          localStorage.setItem("aa_lang", code);
          location.href = "/";
        }
      });
    });
  }

  function ensureShell() {
    let root = document.getElementById("aa-app-root");
    const main =
      document.querySelector("main#content-main") ||
      document.querySelector("#bcae_main_containner") ||
      document.querySelector(".content-main") ||
      document.querySelector("#main") ||
      document.querySelector("main");
    if (!root) {
      root = document.createElement("div");
      root.id = "aa-app-root";
      root.className = "aa-app";
      if (main) {
        // Never wipe main.innerHTML (that caused blank Find parts pages).
        // Hide existing homepage blocks and append the SPA root.
        [...main.children].forEach((ch) => {
          if (ch.id === "aa-app-root") return;
          ch.setAttribute("data-aa-home-block", "1");
          ch.style.display = "none";
        });
        main.appendChild(root);
      } else {
        document.body.prepend(root);
      }
    } else if (main) {
      [...main.children].forEach((ch) => {
        if (ch === root || ch.id === "aa-app-root") return;
        if (ch.getAttribute("data-aa-home-block") === "1" || ch.classList?.contains("cms-sections") || ch.classList?.contains("find-parts")) {
          ch.style.display = "none";
        }
      });
      root.style.removeProperty("display");
    }
    let b = document.getElementById("aa-top-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "aa-top-banner";
      b.className = "aa-top-banner";
      document.body.prepend(b);
    }
    b.innerHTML = `${t("brandOrders")} <a href="/car-parts">${t("categories")}</a> · <a href="/contact-us">${t("contact")}</a>`;
    // Remove legacy sim banner if present
    document.getElementById("aa-sim-banner")?.remove();
    return root;
  }

  function showRouteLoading(message) {
    const root = ensureShell();
    root.innerHTML = `<div class="aa-wrap aa-route-loading" data-aa-route-loading>
      <p class="aa-h1" style="font-size:1.25rem">${esc(message || t("vehicleLoading"))}</p>
      <p class="aa-sub">${esc(t("spareParts"))}…</p>
    </div>`;
    return root;
  }

  function fallbackSparesHtml(params) {
    const maker = params?.get?.("maker") || "";
    const model = params?.get?.("model") || "";
    const engine = params?.get?.("engine") || params?.get?.("vehicle") || "";
    const labels = vehicleLabel(maker, model, engine);
    const name = `${labels.makerName} ${labels.modelName} ${labels.engineName}`.replace(/\s+/g, " ").trim();
    return `<div class="aa-wrap aa-vehicle-spares">
      <h1 class="aa-h1 aa-vehicle-spares-title">${esc(t("sparePartsFor", { vehicle: name || t("yourVehicle") }))}</h1>
      <section class="aa-vehicle-card">
        <div class="aa-vehicle-card-row">
          <img class="aa-vehicle-card-thumb" src="/media/category-covers/vehicle-placeholder.svg" alt="">
          <p class="aa-vehicle-card-text">${esc(name || t("yourVehicle"))}</p>
        </div>
        <div class="aa-vehicle-card-actions">
          <button type="button" class="aa-vehicle-btn aa-vehicle-btn-solid" data-aa-change-vehicle>${esc(t("change"))}</button>
        </div>
      </section>
      <p class="aa-empty">${esc(t("vehicleLoading"))}</p>
    </div>`;
  }

  function rewriteHomeLinks() {
    document.querySelectorAll('a[href^="https://aateile.com"]').forEach((a) => {
      try {
        const u = new URL(a.href);
        a.href = u.pathname + u.search;
      } catch {}
    });
    // header search form (SPA, no full reload splash)
    document.querySelectorAll("form.header-search-form, form[action*='search']").forEach((form) => {
      if (form.dataset.aaSearchWired === "1") return;
      form.dataset.aaSearchWired = "1";
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = form.querySelector('input[type="search"], input[name="search"], input');
        const q = input?.value || "";
        const path = "/search?search=" + encodeURIComponent(q);
        if (window.__AA_NAV__?.go) window.__AA_NAV__.go(path);
        else location.assign(path);
      });
    });
    // vehicle finder forms on homepage
    document.querySelectorAll("form").forEach((form) => {
      const txt = form.textContent || "";
      if (
        !/Find parts|Trouver des pièces|Teile finden|find-parts/i.test(txt) &&
        !form.closest(".find-parts") &&
        !form.querySelector("[name*=maker], #maker, select")
      )
        return;
      if (form.dataset.aaVehicleWired === "1") return;
      form.dataset.aaVehicleWired = "1";
      form.addEventListener(
        "submit",
        (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const maker = fd.get("maker") || fd.get("manufacturer") || "";
          const model = fd.get("model") || "";
          const engine = fd.get("engine") || "";
          const path =
            "/spares?vehicle=" +
            encodeURIComponent(String(engine)) +
            "&maker=" +
            encodeURIComponent(String(maker)) +
            "&model=" +
            encodeURIComponent(String(model)) +
            "&engine=" +
            encodeURIComponent(String(engine));
          window.__AA_NOFREEZE__?.heal?.();
          if (window.__AA_NAV__?.go) window.__AA_NAV__.go(path);
          else location.assign(path);
          return;
        },
        true
      );
    });
  }

  function vehiclePlaceholder(label) {
    return `<option value="-1">${esc(label)}</option>`;
  }

  function findPartsSelects(fromEl) {
    const root =
      fromEl?.closest?.(".find-parts__select, .find-parts, [data-find-parts], .aa-cv-card") ||
      document.querySelector("#aa-change-vehicle-modal.is-open [data-find-parts]") ||
      document.querySelector(".find-parts__select, [data-find-parts], .find-parts");
    if (!root) return {};
    return {
      root,
      brand: root.querySelector(".find-select-brand"),
      model: root.querySelector(".find-select-model"),
      engine: root.querySelector(".find-select-type"),
      button: root.querySelector(".find-parts__actions .btn, [data-aa-cv-find]"),
    };
  }

  function comboboxInputFor(select) {
    if (!select) return null;
    const wrap = select.closest(".vehicle-combobox") || select.parentElement;
    return wrap?.querySelector?.(".vehicle-combobox__input") || null;
  }

  function syncVehicleCombobox(select) {
    const input = comboboxInputFor(select);
    if (!input || !select) return;
    const opt = select.selectedOptions?.[0];
    if (opt && opt.value && opt.value !== "-1") input.value = opt.textContent.trim();
    else input.value = "";
    input.placeholder = select.options[0]?.textContent?.trim() || input.placeholder;
  }

  function setVehicleFieldState(select, { loading = false, enabled = true, placeholder } = {}) {
    if (!select) return;
    const input = comboboxInputFor(select);
    select.disabled = !enabled;
    if (input) {
      input.disabled = !enabled;
      input.classList.toggle("aa-vehicle-loading", !!loading);
      input.classList.toggle("aa-vehicle-ready", !loading && enabled);
      if (placeholder) input.placeholder = placeholder;
      if (loading) input.value = "";
    }
    const item = select.closest(".find-parts__item");
    if (item) {
      item.classList.toggle("aa-vehicle-item-loading", !!loading);
      item.classList.toggle("is-disabled", !enabled);
      // Never leave the red is-missing flash on during cascade / loading
      if (loading || !enabled) item.classList.remove("is-missing");
    }
  }

  function fillSelectOptions(select, placeholder, items) {
    if (!select) return;
    select.innerHTML =
      vehiclePlaceholder(placeholder) +
      items
        .map((item) => {
          const label = item.label || item.name || item.id;
          const attrs = [
            item.fuelType ? ` data-fuel="${esc(item.fuelType)}"` : "",
            item.powerHp != null && item.powerHp !== "" ? ` data-hp="${esc(item.powerHp)}"` : "",
            item.powerKw != null && item.powerKw !== "" ? ` data-kw="${esc(item.powerKw)}"` : "",
            item.yearFrom ? ` data-year-from="${esc(String(item.yearFrom).slice(0, 10))}"` : "",
            item.yearTo ? ` data-year-to="${esc(String(item.yearTo).slice(0, 10))}"` : "",
          ].join("");
          return `<option value="${esc(item.id)}"${attrs}>${esc(label)}</option>`;
        })
        .join("");
    select.value = "-1";
    syncVehicleCombobox(select);
  }

  function flattenGroupedApi(data) {
    if (!data || typeof data !== "object") return [];
    const out = [];
    Object.entries(data).forEach(([group, rows]) => {
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row?.id) return;
        let label = row.name || row.id;
        const fuelType = row.fuelType || group || "";
        if (row.yearFrom && row.yearTo) {
          try {
            const a = new Date(row.yearFrom);
            const b = new Date(row.yearTo);
            if (!isNaN(a) && !isNaN(b)) {
              const fmt = (d) =>
                `${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
              label = `${row.name} (${fmt(a)} - ${fmt(b)})`;
            }
          } catch (_) {
            /* ignore */
          }
        }
        if (row.enginePowerKw != null && row.enginePowerHp != null) {
          label = `${row.name} (${row.enginePowerKw} kW / ${row.enginePowerHp} hp)`;
          if (row.yearFrom && row.yearTo) {
            try {
              const a = new Date(row.yearFrom);
              const b = new Date(row.yearTo);
              if (!isNaN(a) && !isNaN(b)) {
                const fmt = (d) =>
                  `${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
                label += ` (${fmt(a)} - ${fmt(b)})`;
              }
            } catch (_) {
              /* ignore */
            }
          }
        }
        out.push({
          id: row.id,
          label,
          name: row.name,
          fuelType,
          powerHp: row.enginePowerHp,
          powerKw: row.enginePowerKw,
          yearFrom: row.yearFrom,
          yearTo: row.yearTo,
        });
      });
    });
    return out;
  }

  let vehicleFetchGen = 0;

  async function loadModelsForBrand(brandId, fromEl) {
    const { model, engine, button } = findPartsSelects(fromEl);
    if (!model) return;
    const gen = ++vehicleFetchGen;
    setVehicleFieldState(model, { loading: true, enabled: false, placeholder: t("vehicleLoading") });
    setVehicleFieldState(engine, { loading: false, enabled: false, placeholder: t("selectEngine") });
    fillSelectOptions(model, t("selectModel"), []);
    fillSelectOptions(engine, t("selectEngine"), []);
    if (button) button.disabled = true;

    // Instant catalog fill so the list never stays stuck empty
    const local = (state.catalog?.vehicles?.models?.[brandId] || []).map((m) => ({
      id: m.id,
      label: m.name,
      name: m.name,
    }));
    if (local.length) {
      fillSelectOptions(model, t("selectModel"), local);
      setVehicleFieldState(model, { loading: true, enabled: true, placeholder: t("selectModel") });
    }

    try {
      const res = await fetch(`/vehicles/brands/${encodeURIComponent(brandId)}/models`, {
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      });
      if (!res.ok) throw new Error("models " + res.status);
      const data = await res.json();
      if (gen !== vehicleFetchGen) return;
      const items = flattenGroupedApi(data);
      if (items.length) fillSelectOptions(model, t("selectModel"), items);
    } catch (_) {
      /* catalog fill already applied */
    }
    if (gen !== vehicleFetchGen) return;
    setVehicleFieldState(model, { loading: false, enabled: true, placeholder: t("selectModel") });
    setVehicleFieldState(engine, { loading: false, enabled: false, placeholder: t("selectEngine") });
    syncVehicleCombobox(model);
  }

  async function loadEnginesForModel(modelId, fromEl) {
    const { engine, button } = findPartsSelects(fromEl);
    if (!engine) return;
    const gen = ++vehicleFetchGen;
    setVehicleFieldState(engine, { loading: true, enabled: false, placeholder: t("vehicleLoading") });
    fillSelectOptions(engine, t("selectEngine"), []);
    if (button) button.disabled = true;

    const local = (state.catalog?.vehicles?.engines?._default || []).map((m) => ({
      id: `${modelId}-${m.id}`,
      label: m.name,
      name: m.name,
    }));
    if (local.length) {
      fillSelectOptions(engine, t("selectEngine"), local);
      setVehicleFieldState(engine, { loading: true, enabled: true, placeholder: t("selectEngine") });
    }

    try {
      const res = await fetch(`/vehicles/models/${encodeURIComponent(modelId)}/types`, {
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      });
      if (!res.ok) throw new Error("types " + res.status);
      const data = await res.json();
      if (gen !== vehicleFetchGen) return;
      const items = flattenGroupedApi(data);
      if (items.length) fillSelectOptions(engine, t("selectEngine"), items);
    } catch (_) {
      /* catalog fill already applied */
    }
    if (gen !== vehicleFetchGen) return;
    setVehicleFieldState(engine, { loading: false, enabled: true, placeholder: t("selectEngine") });
    syncVehicleCombobox(engine);
    updateFindButtonState(engine);
  }

  function updateFindButtonState(fromEl) {
    const { button, brand, model, engine } = findPartsSelects(fromEl);
    if (!button) return;
    const ok =
      brand?.value &&
      brand.value !== "-1" &&
      model?.value &&
      model.value !== "-1" &&
      engine?.value &&
      engine.value !== "-1";
    button.disabled = !ok;
  }

  function wireVehicleSelects() {
    const { root, brand, model, engine, button } = findPartsSelects();
    if (!root || !brand || !model) return;
    root.classList.add("aa-vehicle-enhanced");

    const makers = state.catalog?.vehicles?.makers || [];
    if (brand.options.length <= 1 && makers.length) {
      fillSelectOptions(
        brand,
        t("selectMaker"),
        makers.map((m) => ({ id: m.id, label: m.name, name: m.name }))
      );
    }

    // Initial disabled chain
    if (!brand.value || brand.value === "-1") {
      setVehicleFieldState(model, { enabled: false, placeholder: t("selectModel") });
      setVehicleFieldState(engine, { enabled: false, placeholder: t("selectEngine") });
      if (button) button.disabled = true;
    }

    if (brand.dataset.aaWired === "1") {
      wirePlateVinHandlers();
      return;
    }
    brand.dataset.aaWired = "1";

    brand.addEventListener("change", () => {
      const id = brand.value;
      syncVehicleCombobox(brand);
      if (!id || id === "-1") {
        vehicleFetchGen++;
        fillSelectOptions(model, t("selectModel"), []);
        fillSelectOptions(engine, t("selectEngine"), []);
        setVehicleFieldState(model, { enabled: false, placeholder: t("selectModel") });
        setVehicleFieldState(engine, { enabled: false, placeholder: t("selectEngine") });
        if (button) button.disabled = true;
        return;
      }
      loadModelsForBrand(id, brand);
    });

    model.addEventListener("change", () => {
      const id = model.value;
      syncVehicleCombobox(model);
      if (!id || id === "-1") {
        vehicleFetchGen++;
        fillSelectOptions(engine, t("selectEngine"), []);
        setVehicleFieldState(engine, { enabled: false, placeholder: t("selectEngine") });
        if (button) button.disabled = true;
        return;
      }
      loadEnginesForModel(id, model);
    });

    engine?.addEventListener("change", () => {
      syncVehicleCombobox(engine);
      updateFindButtonState(engine);
    });

    if (button && button.dataset.aaFindWired !== "1") {
      button.dataset.aaFindWired = "1";
      button.addEventListener(
        "click",
        (e) => {
          if (!isVehicleSelectionComplete()) {
            root.classList.add("aa-vehicle-incomplete");
            setTimeout(() => root.classList.remove("aa-vehicle-incomplete"), 450);
            return;
          }
          e.preventDefault();
          e.stopImmediatePropagation();
          const { brand: b, model: m, engine: en } = findPartsSelects(button);
          button.classList.add("aa-vehicle-submitting");
          const engineId = en?.value || "";
          const opt = en?.selectedOptions?.[0];
          try {
            sessionStorage.setItem(
              "aa_vehicle_meta",
              JSON.stringify({
                engineId,
                makerId: b?.value || "",
                modelId: m?.value || "",
                fuelType: opt?.dataset?.fuel || opt?.getAttribute("data-fuel") || "",
                powerHp: opt?.dataset?.hp || opt?.getAttribute("data-hp") || "",
                powerKw: opt?.dataset?.kw || opt?.getAttribute("data-kw") || "",
                yearFrom: opt?.dataset?.yearFrom || opt?.getAttribute("data-year-from") || "",
                yearTo: opt?.dataset?.yearTo || opt?.getAttribute("data-year-to") || "",
                label: opt?.textContent?.trim() || "",
              })
            );
          } catch (_) {
            /* ignore */
          }
          // Match official /spares?vehicle={engineId} category browser
          const path =
            "/spares?vehicle=" +
            encodeURIComponent(engineId) +
            "&maker=" +
            encodeURIComponent(b?.value || "") +
            "&model=" +
            encodeURIComponent(m?.value || "") +
            "&engine=" +
            encodeURIComponent(engineId);
          window.__AA_NOFREEZE__?.heal?.();
          // Prefer SPA nav; hard-assign only if nav API missing (never leave blank main)
          if (window.__AA_NAV__?.go) {
            window.__AA_NAV__.go(path);
          } else {
            location.assign(path);
          }
          setTimeout(() => button.classList.remove("aa-vehicle-submitting"), 600);
        },
        true
      );
    }

    wirePlateVinHandlers();
  }

  function wireVehicleSparesUi(root) {
    if (!root?.querySelector?.(".aa-vehicle-spares")) return;
    window.__AA_NOFREEZE__?.heal?.();

    // Official layout: Top categories carousel AND full catalog grid are both
    // always visible (stacked). Tabs that hide either panel are not used.

    const track = root.querySelector("[data-vcat-track]");
    const slides = [...root.querySelectorAll("[data-vcat-slide]")];
    let idx = 0;
    const showSlide = (n) => {
      if (!slides.length) return;
      idx = ((n % slides.length) + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle("is-active", i === idx));
      if (track) track.style.transform = `translateX(-${idx * 100}%)`;
    };
    showSlide(0);
    root.querySelector("[data-vcat-prev]")?.addEventListener("click", () => showSlide(idx - 1));
    root.querySelector("[data-vcat-next]")?.addEventListener("click", () => showSlide(idx + 1));

    root.querySelectorAll("[data-vcat-expand]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = btn.getAttribute("data-vcat-expand");
        const sub = root.querySelector(`[data-vcat-sub="${i}"]`);
        const slide = root.querySelector(`[data-vcat-slide="${i}"]`);
        if (!sub) return;
        const open = sub.hasAttribute("hidden");
        root.querySelectorAll("[data-vcat-sub]").forEach((el) => el.setAttribute("hidden", ""));
        root.querySelectorAll("[data-vcat-expand]").forEach((b) => {
          b.setAttribute("aria-expanded", "false");
          b.classList.remove("is-open");
        });
        root.querySelectorAll("[data-vcat-slide]").forEach((s) => s.classList.remove("is-expanded"));
        if (open) {
          sub.removeAttribute("hidden");
          btn.setAttribute("aria-expanded", "true");
          btn.classList.add("is-open");
          slide?.classList.add("is-expanded");
        }
      });
    });

    const grid = root.querySelector(".aa-vcat-grid");
    const gridCells = [...root.querySelectorAll("[data-vcat-cell]")];
    const closeGridPanels = () => {
      root.querySelectorAll("[data-vcat-grid-panel]").forEach((panel) => {
        panel.hidden = true;
        panel.classList.remove("is-open");
        const homeIdx = panel.getAttribute("data-vcat-grid-panel");
        const home = root.querySelector(`[data-vcat-cell="${homeIdx}"]`);
        if (home && panel.parentElement !== home) home.appendChild(panel);
      });
      root.querySelectorAll("[data-vcat-grid-toggle]").forEach((b) => {
        b.setAttribute("aria-expanded", "false");
        b.classList.remove("is-expanded");
      });
      root.querySelectorAll("[data-vcat-cell]").forEach((c) => c.classList.remove("is-expanded"));
    };
    const gridColCount = () => (window.matchMedia("(min-width: 900px)").matches ? 3 : 2);
    root.querySelectorAll("[data-vcat-grid-toggle]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const nav = btn.getAttribute("data-vcat-nav");
        if (nav) {
          history.pushState({}, "", nav);
          render();
          return;
        }
        const i = Number(btn.getAttribute("data-vcat-grid-toggle"));
        const panel = root.querySelector(`[data-vcat-grid-panel="${i}"]`);
        const cell = root.querySelector(`[data-vcat-cell="${i}"]`);
        if (!panel || !cell || !grid) return;
        const wasOpen = !panel.hidden && panel.classList.contains("is-open");
        closeGridPanels();
        if (wasOpen) return;
        const cols = gridColCount();
        const rowEnd = Math.min(i - (i % cols) + cols - 1, gridCells.length - 1);
        const anchor = gridCells[rowEnd] || cell;
        panel.hidden = false;
        panel.classList.add("is-open");
        anchor.after(panel);
        btn.setAttribute("aria-expanded", "true");
        btn.classList.add("is-expanded");
        cell.classList.add("is-expanded");
        try {
          panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } catch (_) {
          /* ignore */
        }
      });
    });

    const modal = root.querySelector("[data-vehicle-details-modal]");
    root.querySelectorAll("[data-vehicle-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!modal) return;
        modal.hidden = false;
        modal.classList.add("is-open");
        window.__AA_NOFREEZE__?.lockScroll?.("vehicle-details");
      });
    });
    root.querySelectorAll("[data-vehicle-details-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!modal) return;
        modal.hidden = true;
        modal.classList.remove("is-open");
        window.__AA_NOFREEZE__?.unlockScroll?.("vehicle-details");
        window.__AA_NOFREEZE__?.heal?.();
      });
    });
  }

  function wirePlateVinHandlers() {
    document.querySelectorAll(".search-by-plate__btn, .search-by-vin__btn").forEach((btn) => {
      if (btn.dataset.aaPlateWired === "1") return;
      btn.dataset.aaPlateWired = "1";
      btn.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const panel = btn.closest(".tab-pane, .find-parts__nav, .find-parts__col") || document;
          const val = panel.querySelector("input[type='text'], input:not([type='hidden']):not([type='radio'])")?.value?.trim();
          showVehicleToast(val ? t("plateVinHint") : t("plateVinNeedValue"));
          document.querySelector(".find-parts__select")?.scrollIntoView({ behavior: "smooth", block: "center" });
          comboboxInputFor(document.querySelector(".find-select-brand"))?.focus();
        },
        true
      );
    });
  }

  function showVehicleToast(msg) {
    let el = document.getElementById("aa-vehicle-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "aa-vehicle-toast";
      el.className = "aa-vehicle-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(showVehicleToast._t);
    showVehicleToast._t = setTimeout(() => el.classList.remove("is-on"), 4200);
  }

  function isVehicleSelectionComplete() {
    const { brand, model, engine } = findPartsSelects();
    const ok = (sel) => sel && sel.value && sel.value !== "-1" && !sel.disabled;
    return ok(brand) && ok(model) && ok(engine);
  }

  let renderTimer = 0;
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = 0;
      try {
        render();
      } catch (err) {
        console.warn("aa render deferred retry", err);
        setTimeout(() => {
          try {
            render();
          } catch (e2) {
            console.warn("aa render failed", e2);
          }
        }, 50);
      }
    }, 0);
  }

  function closeChangeVehicleModal() {
    const modal = document.getElementById("aa-change-vehicle-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("hidden", "");
    document.body.classList.remove("aa-cv-open");
    window.__AA_NOFREEZE__?.unlockScroll?.("change-vehicle");
    window.__AA_NOFREEZE__?.heal?.();
  }

  function submitVehicleFromModal(root) {
    const { brand: b, model: m, engine: en } = findPartsSelects(root);
    if (!b?.value || b.value === "-1" || !m?.value || m.value === "-1" || !en?.value || en.value === "-1") {
      root.classList.add("aa-vehicle-incomplete");
      setTimeout(() => root.classList.remove("aa-vehicle-incomplete"), 450);
      return;
    }
    const engineId = en.value;
    const opt = en.selectedOptions?.[0];
    try {
      sessionStorage.setItem(
        "aa_vehicle_meta",
        JSON.stringify({
          engineId,
          makerId: b.value || "",
          modelId: m.value || "",
          fuelType: opt?.dataset?.fuel || opt?.getAttribute("data-fuel") || "",
          powerHp: opt?.dataset?.hp || opt?.getAttribute("data-hp") || "",
          powerKw: opt?.dataset?.kw || opt?.getAttribute("data-kw") || "",
          yearFrom: opt?.dataset?.yearFrom || opt?.getAttribute("data-year-from") || "",
          yearTo: opt?.dataset?.yearTo || opt?.getAttribute("data-year-to") || "",
          label: opt?.textContent?.trim() || "",
        })
      );
    } catch (_) {
      /* ignore */
    }
    const path =
      "/spares?vehicle=" +
      encodeURIComponent(engineId) +
      "&maker=" +
      encodeURIComponent(b.value || "") +
      "&model=" +
      encodeURIComponent(m.value || "") +
      "&engine=" +
      encodeURIComponent(engineId);
    closeChangeVehicleModal();
    window.__AA_NOFREEZE__?.heal?.();
    if (window.__AA_NAV__?.go) window.__AA_NAV__.go(path);
    else {
      history.pushState({}, "", path);
      render();
    }
  }

  async function prefillChangeVehicleModal(card, params) {
    const brand = card.querySelector(".find-select-brand");
    const model = card.querySelector(".find-select-model");
    const engine = card.querySelector(".find-select-type");
    const button = card.querySelector("[data-aa-cv-find]");
    if (!brand || !model || !engine) return;

    const makers = state.catalog?.vehicles?.makers || [];
    fillSelectOptions(
      brand,
      t("make"),
      makers.map((m) => ({ id: m.id, label: m.name, name: m.name }))
    );
    fillSelectOptions(model, t("modelLabel"), []);
    fillSelectOptions(engine, t("engineLabel"), []);
    setVehicleFieldState(model, { enabled: false, placeholder: t("modelLabel") });
    setVehicleFieldState(engine, { enabled: false, placeholder: t("engineLabel") });
    if (button) button.disabled = true;

    const makerId = params.get("maker") || "";
    const modelId = params.get("model") || "";
    const engineId = params.get("engine") || params.get("vehicle") || "";
    if (!makerId || !makers.some((m) => m.id === makerId)) return;

    brand.value = makerId;
    await loadModelsForBrand(makerId, brand);
    if (modelId && [...model.options].some((o) => o.value === modelId)) {
      model.value = modelId;
      await loadEnginesForModel(modelId, model);
      if (engineId && [...engine.options].some((o) => o.value === engineId)) {
        engine.value = engineId;
        updateFindButtonState(brand);
      }
    }
  }

  function ensureChangeVehicleModal() {
    let modal = document.getElementById("aa-change-vehicle-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "aa-change-vehicle-modal";
    modal.className = "aa-cv-modal";
    modal.setAttribute("hidden", "");
    modal.innerHTML = `
      <div class="aa-cv-backdrop" data-aa-cv-close></div>
      <div class="aa-cv-card" role="dialog" aria-modal="true" aria-labelledby="aa-cv-title" data-find-parts="true">
        <div class="aa-cv-section">
          <div class="aa-cv-title-row">
            <h2 id="aa-cv-title" class="aa-cv-title">${esc(t("findPartsBySelectingVehicle"))}</h2>
            <button type="button" class="aa-cv-reset" data-aa-cv-reset aria-label="${esc(t("resetVehicleSelection"))}">
              <span aria-hidden="true">↻</span>
            </button>
          </div>
          <div class="aa-cv-fields find-parts__items">
            <div class="find-parts__item aa-cv-field">
              <select class="find-select-brand" aria-label="${esc(t("make"))}">
                <option value="-1">${esc(t("make"))}</option>
              </select>
            </div>
            <div class="find-parts__item aa-cv-field">
              <select class="find-select-model" aria-label="${esc(t("modelLabel"))}" disabled>
                <option value="-1">${esc(t("modelLabel"))}</option>
              </select>
            </div>
            <div class="find-parts__item aa-cv-field">
              <select class="find-select-type" aria-label="${esc(t("engineLabel"))}" disabled>
                <option value="-1">${esc(t("engineLabel"))}</option>
              </select>
            </div>
          </div>
          <button type="button" class="aa-cv-btn aa-cv-btn-black" data-aa-cv-find disabled>${esc(t("findParts"))}</button>
        </div>
        <div class="aa-cv-section aa-cv-vin">
          <h3 class="aa-cv-subtitle">${esc(t("searchByVin"))}</h3>
          <input type="text" class="aa-cv-vin-input" data-aa-cv-vin maxlength="17" placeholder="${esc(t("enterVin"))}" autocomplete="off">
          <p class="aa-cv-vin-help">${esc(t("vinHelpText"))}</p>
          <a class="aa-cv-vin-what" href="#what-is-vin" data-aa-cv-what-vin>${esc(t("whatIsVin"))}</a>
          <button type="button" class="aa-cv-btn aa-cv-btn-black" data-aa-cv-vin-find>${esc(t("findParts"))}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-aa-cv-close]").forEach((el) => {
      el.addEventListener("click", closeChangeVehicleModal);
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeChangeVehicleModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeChangeVehicleModal();
    });

    const card = modal.querySelector(".aa-cv-card");
    const brand = card.querySelector(".find-select-brand");
    const model = card.querySelector(".find-select-model");
    const engine = card.querySelector(".find-select-type");
    const findBtn = card.querySelector("[data-aa-cv-find]");

    brand.addEventListener("change", () => {
      const id = brand.value;
      if (!id || id === "-1") {
        vehicleFetchGen++;
        fillSelectOptions(model, t("modelLabel"), []);
        fillSelectOptions(engine, t("engineLabel"), []);
        setVehicleFieldState(model, { enabled: false, placeholder: t("modelLabel") });
        setVehicleFieldState(engine, { enabled: false, placeholder: t("engineLabel") });
        if (findBtn) findBtn.disabled = true;
        return;
      }
      loadModelsForBrand(id, brand);
    });
    model.addEventListener("change", () => {
      const id = model.value;
      if (!id || id === "-1") {
        vehicleFetchGen++;
        fillSelectOptions(engine, t("engineLabel"), []);
        setVehicleFieldState(engine, { enabled: false, placeholder: t("engineLabel") });
        if (findBtn) findBtn.disabled = true;
        return;
      }
      loadEnginesForModel(id, model);
    });
    engine.addEventListener("change", () => updateFindButtonState(brand));
    findBtn.addEventListener("click", () => submitVehicleFromModal(card));

    modal.querySelector("[data-aa-cv-reset]")?.addEventListener("click", () => {
      vehicleFetchGen++;
      fillSelectOptions(
        brand,
        t("make"),
        (state.catalog?.vehicles?.makers || []).map((m) => ({ id: m.id, label: m.name, name: m.name }))
      );
      fillSelectOptions(model, t("modelLabel"), []);
      fillSelectOptions(engine, t("engineLabel"), []);
      setVehicleFieldState(model, { enabled: false, placeholder: t("modelLabel") });
      setVehicleFieldState(engine, { enabled: false, placeholder: t("engineLabel") });
      if (findBtn) findBtn.disabled = true;
      const vin = modal.querySelector("[data-aa-cv-vin]");
      if (vin) vin.value = "";
    });

    modal.querySelector("[data-aa-cv-what-vin]")?.addEventListener("click", (e) => {
      e.preventDefault();
      showVehicleToast(t("vinHelpText"));
    });
    modal.querySelector("[data-aa-cv-vin-find]")?.addEventListener("click", () => {
      const vin = (modal.querySelector("[data-aa-cv-vin]")?.value || "").trim();
      if (!vin) {
        showVehicleToast(t("plateVinNeedValue"));
        return;
      }
      showVehicleToast(t("plateVinHint"));
    });

    return modal;
  }

  function openChangeVehicleModal() {
    window.__AA_NOFREEZE__?.heal?.();
    const modal = ensureChangeVehicleModal();
    // Refresh i18n labels each open
    const title = modal.querySelector("#aa-cv-title");
    if (title) title.textContent = t("findPartsBySelectingVehicle");
    const vinTitle = modal.querySelector(".aa-cv-subtitle");
    if (vinTitle) vinTitle.textContent = t("searchByVin");
    const vinInput = modal.querySelector("[data-aa-cv-vin]");
    if (vinInput) vinInput.placeholder = t("enterVin");
    const vinHelp = modal.querySelector(".aa-cv-vin-help");
    if (vinHelp) vinHelp.textContent = t("vinHelpText");
    const what = modal.querySelector("[data-aa-cv-what-vin]");
    if (what) what.textContent = t("whatIsVin");
    modal.querySelectorAll("[data-aa-cv-find], [data-aa-cv-vin-find]").forEach((btn) => {
      if (btn.hasAttribute("data-aa-cv-find") || btn.hasAttribute("data-aa-cv-vin-find")) {
        btn.textContent = t("findParts");
      }
    });

    modal.removeAttribute("hidden");
    document.body.classList.add("aa-cv-open");
    window.__AA_NOFREEZE__?.lockScroll?.("change-vehicle");
    requestAnimationFrame(() => modal.classList.add("is-open"));

    const params = new URLSearchParams(location.search || "");
    const card = modal.querySelector(".aa-cv-card");
    prefillChangeVehicleModal(card, params).catch(() => {});
  }

  // Legacy name: Change vehicle opens modal (never blank home)
  function goToVehicleFinder() {
    openChangeVehicleModal();
  }

  function focusVehicleFinder() {
    window.__AA_NOFREEZE__?.heal?.();
    const params = new URLSearchParams(location.search || "");
    const want =
      params.get("changeVehicle") === "1" ||
      location.hash === "#find-parts" ||
      location.hash === "#findparts" ||
      location.hash === "#change-vehicle";
    if (want) {
      openChangeVehicleModal();
      return true;
    }
    const finder = document.querySelector(".find-parts, [data-find-parts], .find-parts__select");
    if (!finder) return false;
    document.querySelectorAll(".cms-sections, .find-parts").forEach((el) => {
      el.style.removeProperty("display");
    });
    return true;
  }

  function viewVehicleFinder() {
    // SPA fallback if we ever land on home without index.html markup
    return `<div class="aa-wrap aa-vehicle-finder">
      <h1 class="aa-h1">${esc(t("findParts"))}</h1>
      <p class="aa-sub">${esc(t("vehicleFinderHint"))}</p>
      <div class="aa-vehicle-finder-box find-parts" data-find-parts="true">
        <div class="find-parts__select" data-find-parts="true">
          <div class="find-parts__text">${esc(t("findPartsByVehicle"))}</div>
          <div class="find-parts__items">
            <div class="find-parts__item">
              <select class="find-select-brand" aria-label="${esc(t("selectMaker"))}">
                <option value="-1">${esc(t("selectMaker"))}</option>
              </select>
            </div>
            <div class="find-parts__item">
              <select class="find-select-model" aria-label="${esc(t("selectModel"))}" disabled>
                <option value="-1">${esc(t("selectModel"))}</option>
              </select>
            </div>
            <div class="find-parts__item">
              <select class="find-select-type" aria-label="${esc(t("selectEngine"))}" disabled>
                <option value="-1">${esc(t("selectEngine"))}</option>
              </select>
            </div>
            <div class="find-parts__actions">
              <button type="button" class="btn btn-secondary aa-btn">${esc(t("findParts"))}</button>
            </div>
          </div>
        </div>
      </div>
      <p class="aa-sub" style="margin-top:20px"><a href="/">${esc(t("home"))}</a></p>
    </div>`;
  }

  function isHomePath(pathname) {
    const path = (pathname || "").replace(/\/+$/, "") || "/";
    return path === "/" || path === "/index.html";
  }

  function isSparesPath(pathname) {
    const path = (pathname || "").replace(/\/+$/, "") || "/";
    return path === "/spares" || path === "/spare-parts" || path === "/pieces" || path === "/pieces-auto";
  }

  function render() {
    document.querySelectorAll("#preloader").forEach((el) => el.remove());
    window.__AA_NOFREEZE__?.heal?.();
    syncCartFromStorage();
    const path = location.pathname;
    try {
      const view = resolve(path, location.search);
      if (view.type === "home") {
        const hasFinder = !!document.querySelector(
          ".find-parts[data-aa-home-block], .find-parts:not(#aa-app-root .find-parts), [data-find-parts]:not(#aa-app-root *)"
        );
        const homeBlocks = document.querySelectorAll("[data-aa-home-block], .cms-sections, main .find-parts");
        const hasHomeMarkup = [...homeBlocks].some((el) => !el.closest?.("#aa-app-root"));
        if (!hasHomeMarkup && !document.querySelector("main .cms-sections, .cms-section, .find-parts")) {
          // SPA shell document with no homepage finder → inject finder, never blank
          const root = ensureShell();
          root.innerHTML = viewVehicleFinder();
          bind(root);
          wireVehicleSelects();
          updateCartBadge();
          window.__AA_NOFREEZE__?.heal?.();
          window.scrollTo(0, 0);
          return;
        }
        const root = document.getElementById("aa-app-root");
        if (root) {
          root.innerHTML = "";
          root.style.display = "none";
        }
        // Restore homepage sections hidden by SPA routes
        document.querySelectorAll("[data-aa-home-block], .cms-sections, .find-parts").forEach((el) => {
          if (el.closest?.("#aa-app-root")) return;
          el.style.removeProperty("display");
        });
        renderHomeExtra();
        rewriteHomeLinks();
        wireVehicleSelects();
        focusVehicleFinder();
        window.__AA_NOFREEZE__?.heal?.();
        return;
      }

      const html = view.html || "";
      const root = ensureShell();
      document.querySelectorAll(".cms-sections, .find-parts, [data-aa-home-block]").forEach((el) => {
        if (!root.contains(el)) el.style.display = "none";
      });
      root.style.removeProperty("display");
      if (!html) {
        const params = new URLSearchParams(location.search || "");
        root.innerHTML = isSparesPath(path)
          ? fallbackSparesHtml(params)
          : `<div class="aa-wrap"><h1 class="aa-h1">${esc(t("pageNotFound"))}</h1>
             <a class="aa-btn" style="width:auto" href="/">${esc(t("home"))}</a></div>`;
      } else {
        root.innerHTML = html;
      }
      bind(root);
      updateCartBadge();
      window.__AA_NOFREEZE__?.heal?.();

      if (path.replace(/\/+$/, "") === "/cookie-settings") {
        setTimeout(() => document.dispatchEvent(new CustomEvent("aa:open-cookie-settings")), 50);
      }
      window.scrollTo(0, 0);
    } catch (err) {
      console.warn("aa render failed", err);
      try {
        const root = ensureShell();
        const params = new URLSearchParams(location.search || "");
        root.style.removeProperty("display");
        root.innerHTML = isSparesPath(path)
          ? fallbackSparesHtml(params)
          : `<div class="aa-wrap"><h1 class="aa-h1">${esc(t("spareParts"))}</h1>
             <p class="aa-empty">${esc(t("vehicleLoading"))}</p>
             <button type="button" class="aa-btn" style="width:auto" data-aa-change-vehicle>${esc(t("changeVehicle"))}</button></div>`;
        bind(root);
        wireVehicleSelects();
      } catch (_) {
        /* last resort: hard reload to /spares keeps query */
        if (isSparesPath(path)) location.reload();
      }
    }
  }

  async function loadJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function loadLightData(bust) {
    const tasks = [
      loadJson(`/data/spares-categories.json?${bust}`)
        .then((spares) => {
          state.sparesCategories = spares;
          state.catalog.sparesCategories = spares;
          if (!state.catalog.topCategories?.length && spares.topCategories) {
            state.catalog.topCategories = spares.topCategories;
          }
        })
        .catch(() => {}),
      loadJson(`/data/fitment.json?${bust}`)
        .then((fit) => {
          state.catalog.fitment = fit;
        })
        .catch(() => {}),
    ];
    await Promise.all(tasks);
  }

  async function loadCatalogHeavy(bust) {
    try {
      const catalog = await loadJson(`/data/catalog.json?${bust}`);
      const fitment = state.catalog?.fitment;
      const spares = state.sparesCategories || state.catalog?.sparesCategories;
      state.catalog = catalog;
      if (fitment) state.catalog.fitment = fitment;
      if (spares) {
        state.sparesCategories = spares;
        state.catalog.sparesCategories = spares;
      }
      window.__AA_CATALOG__ = state.catalog;
      return true;
    } catch (err) {
      console.warn("aa catalog load failed", err);
      return false;
    }
  }

  function navigateTo(path) {
    const url = new URL(path, location.origin);
    if (/\bchangeVehicle=1\b/.test(url.search) || /#(find-parts|change-vehicle)/i.test(url.hash)) {
      openChangeVehicleModal();
      return;
    }
    // Never soft-navigate to bare home on app shell (blank main)
    if (isHomePath(url.pathname) && !document.querySelector(".find-parts, [data-aa-home-block]") && !url.search) {
      location.assign(url.pathname + url.search + url.hash);
      return;
    }
    // Find parts → /spares: if light data not ready yet, show loading then render when ready
    history.pushState({}, "", url.pathname + url.search + url.hash);
    if (isSparesPath(url.pathname) && !state.sparesCategories && !state.lightReady) {
      showRouteLoading(t("vehicleLoading"));
      return;
    }
    render();
    window.scrollTo(0, 0);
    window.__AA_NOFREEZE__?.heal?.();
  }

  async function boot() {
    // Kill logo splash immediately; expose nav before heavy catalog fetch finishes
    document.querySelectorAll("#preloader").forEach((el) => el.remove());
    state.lightReady = false;
    state.catalogReady = false;

    window.__AA_NAV__ = {
      go: navigateTo,
      render,
      changeVehicle: openChangeVehicleModal,
    };

    const bust = `v=${encodeURIComponent(window.__AA_BUILD__ || Date.now().toString(36))}`;
    const onSpaRoute = !isHomePath(location.pathname);

    // Paint immediately on SPA shell so Find parts never sits on empty white main
    if (onSpaRoute) {
      showRouteLoading(t("vehicleLoading"));
    }

    try {
      await loadLightData(bust);
      state.lightReady = true;
      window.__AA_NOFREEZE__?.heal?.();
    } catch {
      state.lightReady = true;
    }

    window.__AA_CATALOG__ = state.catalog;
    rewriteHomeLinks();
    wireVehicleSelects();
    updateCartBadge();

    // Intercept internal navigation for SPA feel on app shell pages
    document.addEventListener("click", (e) => {
      const changeBtn = e.target.closest("[data-aa-change-vehicle]");
      if (changeBtn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openChangeVehicleModal();
        return;
      }

      const a = e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href)) return;

      // Change vehicle: open modal overlay (never blank main / home soft-nav)
      const isChangeVehicle =
        href === "/#find-parts" ||
        href === "#find-parts" ||
        href === "#change-vehicle" ||
        /\bchangeVehicle=1\b/.test(href) ||
        (href.startsWith("/#") && /find-parts|change-vehicle/i.test(href));
      if (isChangeVehicle) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openChangeVehicleModal();
        return;
      }

      if (href.startsWith("#")) return;

      // Always leave cart drawer when going to cart/checkout pages
      if (/^\/checkout(\/|$)|^\/cart\/?$/.test(href) || href.includes("/checkout/cart")) {
        window.__AA_CART__?.close?.();
      }
      if (href.startsWith("http") && !href.includes(location.host) && !href.startsWith("https://aateile-clone.netlify.app")) {
        if (href.startsWith("https://aateile.com")) {
          e.preventDefault();
          const u = new URL(href);
          navigateTo(u.pathname + u.search);
        }
        return;
      }
      let url;
      try {
        url = new URL(href, location.origin);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      if (/\.(css|js|png|jpe?g|webp|svg|ico|json|woff2?)$/i.test(url.pathname)) return;
      // Soft SPA to "/" on a document that is not index.html → blank. Force hard home.
      if (isHomePath(url.pathname) && !document.querySelector(".find-parts, [data-aa-home-block]")) {
        e.preventDefault();
        window.__AA_NOFREEZE__?.heal?.();
        location.assign(url.pathname + url.search + (url.hash || ""));
        return;
      }
      e.preventDefault();
      navigateTo(url.pathname + url.search + url.hash);
    });
    window.addEventListener("popstate", render);
    window.addEventListener("aa:cart-changed", () => {
      syncCartFromStorage();
    });
    window.addEventListener("aa:lang-changed", () => {
      render();
      window.__AA_I18N__?.applyShell?.();
    });

    // First paint with light data (/spares works without 16MB catalog.json)
    render();

    // Heavy catalog for product listings / PDP — does not block Find parts UI
    loadCatalogHeavy(bust).then((ok) => {
      state.catalogReady = !!ok;
      window.__AA_CATALOG__ = state.catalog;
      const path = location.pathname.replace(/\/+$/, "") || "/";
      const isProductPdp = /^\/[A-Za-z0-9._%-]+\/[A-Za-z0-9._%-]+$/.test(path);
      if (
        ok &&
        (path.startsWith("/car-parts") ||
          path === "/search" ||
          path === "/checkout/cart" ||
          path === "/cart" ||
          isProductPdp)
      ) {
        render();
      } else if (ok) {
        syncCartFromStorage();
        updateCartBadge();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
