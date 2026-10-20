(() => {
  const t = (key, vars) => (window.__AA_I18N__?.t ? window.__AA_I18N__.t(key, vars) : key);
  const KEY = "aa_cart";
  function waNumber() {
    return window.__AA_CONTACT__?.whatsappDigits || "33644684920";
  }
  let catalog = null;
  let root = null;

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (Array.isArray(raw)) return raw;
      if (raw && Array.isArray(raw.items)) return raw.items;
      return [];
    } catch {
      return [];
    }
  }
  function saveCart(cart) {
    localStorage.setItem(KEY, JSON.stringify(cart));
    updateBadge(cart);
    window.dispatchEvent(new CustomEvent("aa:cart-changed", { detail: cart }));
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
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
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
  function encodeImgUrl(src) {
    if (!src) return "";
    try {
      const u = new URL(src, typeof location !== "undefined" ? location.origin : "http://local");
      u.pathname = u.pathname
        .split("/")
        .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
        .join("/");
      if (src.startsWith("/")) return u.pathname + u.search;
      if (src.startsWith("media/")) return "/" + u.pathname.replace(/^\//, "") + u.search;
      return u.pathname + u.search;
    } catch {
      return String(src).replace(/ /g, "%20");
    }
  }
  function imgSrc(item) {
    const candidates = [item?.imageLocal, item?.image, item?.imageRemote]
      .concat(Array.isArray(item?.images) ? item.images : [])
      .filter(Boolean);
    const PLACEHOLDER =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    for (const raw of candidates) {
      if (
        typeof raw !== "string" ||
        /logo-white|logo-black|header-logo|transparent-fr\.svg|(?:^|[/_-])LOGO(?:[._-]|$)|OSRAM_LOGO|brand[_-]?logo|wordmark/i.test(
          raw
        )
      ) {
        continue;
      }
      let src = raw;
      if (src.startsWith("//")) src = "https:" + src;
      if (/^https?:\/\//i.test(src) && /aateile\.(com|s3)/i.test(src)) {
        src = remoteImageToLocal(src);
        if (!src) continue;
      }
      if (src.startsWith("media/")) src = "/" + src.split("?")[0];
      if (src.startsWith("/media/")) return encodeImgUrl(src.split("?")[0]);
      if (src.startsWith("/") && !/^https?:/i.test(src)) return encodeImgUrl(src);
    }
    return PLACEHOLDER;
  }
  function cartCount(cart) {
    return cart.reduce((n, i) => n + (i.qty || 0), 0);
  }
  function cartTotal(cart) {
    return cart.reduce((n, i) => n + (hasPrice(i.price) ? Number(i.price) * (i.qty || 0) : 0), 0);
  }

  function updateBadge(cart = loadCart()) {
    const empty = !cart.length;
    const total = empty
      ? money(0, { allowZero: true })
      : cart.some((i) => hasPrice(i.price))
        ? money(cartTotal(cart))
        : t("priceOnRequest");
    const count = cartCount(cart);
    // Keep totals in DOM for any secondary widgets, but header CSS hides euro text.
    document.querySelectorAll(".header-cart-total").forEach((el) => {
      el.textContent = total;
      el.setAttribute("hidden", "");
      el.setAttribute("aria-hidden", "true");
    });
    document.querySelectorAll("[data-aa-cart-total]").forEach((el) => {
      el.textContent = total;
    });
    document.querySelectorAll("[data-aa-cart-count]").forEach((el) => {
      el.textContent = String(count);
    });
    // Icon-first header: bag glyph + red count badge (never euro amount)
    document.querySelectorAll(".header-cart-btn").forEach((btn) => {
      btn.style.position = "relative";
      ensureHeaderCartIcon(btn);
      let badge = btn.querySelector(".aa-cart-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "aa-cart-badge";
        badge.setAttribute("aria-hidden", "true");
        btn.appendChild(badge);
      }
      badge.textContent = String(count);
      badge.style.display = count ? "inline-flex" : "none";
      btn.setAttribute("aria-label", t("shoppingCartTitle") + (count ? ` (${count})` : ""));
      btn.setAttribute("title", t("shoppingCartTitle"));
    });
  }

  function ensureHeaderCartIcon(btn) {
    if (!btn) return;
    let icon = btn.querySelector(".aa-cart-bag, .header-cart-icon");
    if (!icon) {
      icon = document.createElement("span");
      icon.className = "header-cart-icon aa-cart-bag";
      btn.insertBefore(icon, btn.firstChild);
    }
    icon.classList.add("aa-cart-bag");
    // Inline path (no xlink/use) so the bag always paints on SPA shell pages
    if (!icon.querySelector("svg.aa-cart-bag-svg")) {
      icon.innerHTML = `<svg class="aa-cart-bag-svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5.892 3c.5523 0 1 .4477 1 1s-.4477 1-1 1H3.7895a1 1 0 0 0-.9986.9475l-.7895 15c-.029.5515.3946 1.0221.9987 1.0525h17.8102c.5523 0 1-.4477.9986-1.0525l-.7895-15A1 1 0 0 0 20.0208 5H17.892c-.5523 0-1-.4477-1-1s.4477-1 1-1h2.1288c1.5956 0 2.912 1.249 2.9959 2.8423l.7894 15c.0035.0788.0035.0788.0042.1577 0 1.6569-1.3432 3-3 3H3c-.079-.0007-.079-.0007-.1577-.0041-1.6546-.0871-2.9253-1.499-2.8382-3.1536l.7895-15C.8775 4.249 2.1939 3 3.7895 3H5.892zm4 2c0 .5523-.4477 1-1 1s-1-.4477-1-1V3c0-1.6569 1.3432-3 3-3h2c1.6569 0 3 1.3431 3 3v2c0 .5523-.4477 1-1 1s-1-.4477-1-1V3c0-.5523-.4477-1-1-1h-2c-.5523 0-1 .4477-1 1v2z"/></svg>`;
    }
  }

  function findProductByPath(path) {
    if (!catalog) return null;
    return catalog.products.find((p) => p.path === path) || null;
  }

  function findProductFromForm(form) {
    // Prefer nearby product link
    const box = form.closest(".product-box, .product-detail, .aa-card, article");
    if (box) {
      const a = box.querySelector('a[href^="/"][href*="/"]');
      if (a) {
        try {
          const path = new URL(a.href, location.origin).pathname;
          const p = findProductByPath(path);
          if (p) return p;
        } catch {}
      }
      const name =
        box.querySelector(".product-name, .product-title, h1, h3")?.textContent?.trim() ||
        "Product";
      const priceTxt = box.querySelector(".product-price, .price, .aa-price")?.textContent || "";
      const m = priceTxt.replace(/\s/g, " ").match(/€\s*([0-9]+(?:[.,][0-9]+)?)/);
      const img = box.querySelector("img")?.getAttribute("src") || "";
      return {
        path: a ? new URL(a.href, location.origin).pathname : "/cart-item/" + Date.now(),
        name,
        price: m ? parseFloat(m[1].replace(",", ".")) : null,
        image: img,
        brand: "",
        articleNumber: "",
      };
    }
    return null;
  }

  let justAddedQty = 0;

  function addItem(product, qty = 1) {
    if (!product?.path) return;
    const cart = loadCart();
    const existing = cart.find((i) => i.path === product.path);
    if (existing) existing.qty += qty;
    else
      cart.push({
        path: product.path,
        name: product.name,
        price: product.price,
        image: product.image,
        brand: product.brand || "",
        qty,
      });
    saveCart(cart);
    justAddedQty = Math.max(1, qty);
    openDrawer({ justAdded: true });
  }

  function scheduleDrawerRender() {
    setTimeout(() => {
      try {
        renderDrawer();
      } catch (err) {
        console.warn("aa cart drawer render", err);
      }
    }, 0);
  }

  function setQty(path, qty) {
    const cart = loadCart();
    const item = cart.find((i) => i.path === path);
    if (!item) return;
    item.qty = Math.max(1, qty);
    saveCart(cart);
    scheduleDrawerRender();
  }

  function removeItem(path) {
    saveCart(loadCart().filter((i) => i.path !== path));
    scheduleDrawerRender();
  }

  function toast(msg) {
    let el = document.getElementById("aa-cart-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "aa-cart-toast";
      el.className = "aa-cart-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("is-on");
    setTimeout(() => el.classList.remove("is-on"), 1600);
  }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "aa-cart-root";
    root.className = "aa-cart-root";
    root.innerHTML = `
      <div class="aa-cart-overlay" data-aa-cart-close></div>
      <aside class="aa-cart-panel" role="dialog" aria-modal="true" aria-label="${t("shoppingCart")}">
        <div class="aa-cart-header">
          <button type="button" class="aa-cart-back" data-aa-cart-close>
            <span class="aa-cart-back-chevron" aria-hidden="true">‹</span>
            <span data-aa-cart-back-label>${t("continueShopping")}</span>
          </button>
        </div>
        <div class="aa-cart-title-row">
          <h2 data-aa-cart-title>${t("shoppingCart")}</h2>
          <span class="aa-cart-count-label" data-aa-cart-count-label></span>
        </div>
        <div class="aa-cart-added" data-aa-cart-added hidden></div>
        <div class="aa-cart-body" data-aa-cart-body></div>
        <div class="aa-cart-footer" data-aa-cart-footer></div>
      </aside>`;
    document.body.appendChild(root);
    root.querySelectorAll("[data-aa-cart-close]").forEach((el) => {
      el.addEventListener("click", closeDrawer);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("is-open")) closeDrawer();
    });
    return root;
  }

  function renderDrawer(opts = {}) {
    ensureRoot();
    const cart = loadCart();
    const body = root.querySelector("[data-aa-cart-body]");
    const footer = root.querySelector("[data-aa-cart-footer]");
    const countLabel = root.querySelector("[data-aa-cart-count-label]");
    const addedEl = root.querySelector("[data-aa-cart-added]");
    const backLabel = root.querySelector("[data-aa-cart-back-label]");
    const title = root.querySelector("[data-aa-cart-title]");
    if (backLabel) backLabel.textContent = t("continueShopping");
    if (title) title.textContent = t("shoppingCart");
    const count = cartCount(cart);
    if (countLabel) countLabel.textContent = count ? t("itemCount", { n: count }) : "";

    const showAdded = !!(opts.justAdded || justAddedQty) && cart.length;
    if (addedEl) {
      if (showAdded) {
        const n = justAddedQty || 1;
        addedEl.hidden = false;
        const msg =
          n === 1 ? t("productAddedToCart", { n }) : t("productsAddedToCart", { n });
        addedEl.innerHTML = `<span class="aa-cart-added-check" aria-hidden="true">✓</span><span>${esc(
          msg
        )}</span>`;
      } else {
        addedEl.hidden = true;
        addedEl.innerHTML = "";
      }
    }

    if (!cart.length) {
      justAddedQty = 0;
      body.innerHTML = `<div class="aa-cart-empty">
        <strong>${t("cartEmpty")}</strong>
        <p>${t("cartEmptyHint")}</p>
        <button type="button" class="aa-btn aa-btn-primary" data-aa-cart-close>${t("continueShopping")}</button>
      </div>`;
      footer.innerHTML = "";
      footer.style.display = "none";
      body.querySelectorAll("[data-aa-cart-close]").forEach((el) => {
        el.addEventListener("click", closeDrawer);
      });
      return;
    }
    footer.style.display = "block";
    body.innerHTML = cart
      .map(
        (i) => `<div class="aa-cart-item">
        <img src="${esc(imgSrc(i))}" alt="">
        <div class="aa-cart-item-main">
          <h3><a href="${esc(i.path)}">${esc(i.name)}</a></h3>
          <div class="aa-cart-meta">${esc(money(i.price))} ${t("each")}</div>
          <div class="aa-cart-row">
            <label class="aa-cart-qty">${t("qty")}
              <input type="number" min="1" value="${i.qty}" data-aa-cart-qty="${esc(i.path)}">
            </label>
            <div class="aa-cart-price">${esc(lineMoney(i.price, i.qty))}</div>
          </div>
        </div>
        <button type="button" class="aa-cart-remove" data-aa-cart-remove="${esc(i.path)}" aria-label="${esc(t("remove"))}">×</button>
      </div>`
      )
      .join("");
    const totalLabel = cart.some((i) => hasPrice(i.price))
      ? money(cartTotal(cart))
      : t("priceOnRequest");
    footer.innerHTML = `
      <div class="aa-cart-total"><span>${t("subtotal")}</span><span>${esc(totalLabel)}</span></div>
      <div class="aa-cart-actions">
        <a class="aa-btn aa-btn-primary" href="/checkout">${t("enterDetailsAndOrder")}</a>
        <a class="aa-btn aa-btn-secondary" href="/checkout/cart" data-aa-view-cart="1">${t("viewCart")}</a>
      </div>`;
    footer.querySelectorAll("[data-aa-view-cart]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        goToCartPage();
      });
    });
    body.querySelectorAll("[data-aa-cart-qty]").forEach((input) => {
      input.addEventListener("change", () => {
        justAddedQty = 0;
        setQty(input.getAttribute("data-aa-cart-qty"), parseInt(input.value || "1", 10) || 1);
      });
    });
    body.querySelectorAll("[data-aa-cart-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        justAddedQty = 0;
        removeItem(btn.getAttribute("data-aa-cart-remove"));
      });
    });
  }

  function killShopwareOffcanvas() {
    document.body.classList.add("aa-cart-kill-sw");
    document.querySelectorAll(".offcanvas, .offcanvas-backdrop, .modal-backdrop").forEach((el) => {
      // Keep cookie/config panels alone; only nuke cart-like full overlays
      const txt = (el.textContent || "").slice(0, 200);
      const isCartish =
        el.classList.contains("offcanvas") ||
        el.classList.contains("offcanvas-backdrop") ||
        /shopping cart|line item|loaderImage/i.test(el.innerHTML || "");
      if (!isCartish && el.id === "aa-cookie-config") return;
      if (el.classList.contains("offcanvas") || el.classList.contains("offcanvas-backdrop") || el.classList.contains("modal-backdrop")) {
        el.classList.remove("show", "showing");
        el.style.setProperty("display", "none", "important");
        el.setAttribute("aria-hidden", "true");
        // If it looks like a full-page dump (logo loader), remove it
        if (el.querySelector?.(".loaderImage, .header-logo-main-img, #aa-app-root")) {
          el.remove();
        }
      }
    });
    document.body.classList.remove("modal-open", "offcanvas-open");
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("padding-right");
  }

  function openDrawer(opts = {}) {
    window.__AA_NOFREEZE__?.quiet?.(1000);
    killShopwareOffcanvas();
    ensureRoot();
    // Clear any inline hide left by unfreezePage — otherwise an invisible cart
    // scroll-locks the page (feels like a freeze).
    root.style.removeProperty("display");
    root.style.removeProperty("pointer-events");
    root.style.removeProperty("visibility");
    root.style.removeProperty("opacity");
    renderDrawer(opts);
    // Sync open flags FIRST so heal/softHeal cannot strip them mid-animation.
    document.body.classList.add("aa-cart-open", "aa-cart-kill-sw", "aa-nofreeze");
    window.__AA_NOFREEZE__?.lockScroll?.("cart");
    // Restart slide animation without losing is-open across rAF races.
    root.classList.remove("is-open");
    void root.offsetWidth;
    root.classList.add("is-open");
  }

  function closeDrawer() {
    if (!root) return;
    const wasOpen = root.classList.contains("is-open");
    justAddedQty = 0;
    root.classList.remove("is-open");
    document.body.classList.remove("aa-cart-open");
    root.style.removeProperty("display");
    root.style.removeProperty("pointer-events");
    root.style.removeProperty("visibility");
    // Let the slide-out finish, then unlock scroll
    const finish = () => {
      if (wasOpen) window.__AA_NOFREEZE__?.unlockScroll?.("cart");
      killShopwareOffcanvas();
      unfreezePage();
      window.__AA_NOFREEZE__?.heal?.();
    };
    if (wasOpen) {
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        root?.removeEventListener("transitionend", once);
        finish();
      };
      root.addEventListener("transitionend", once);
      setTimeout(once, 400);
    } else {
      finish();
    }
  }

  function killPreloader() {
    document.querySelectorAll("#preloader").forEach((el) => {
      el.classList.remove("preloader_visible");
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("pointer-events", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
      try {
        el.remove();
      } catch (_) {
        /* ignore */
      }
    });
  }

  function unfreezePage() {
    if (window.__AA_NOFREEZE__?.heal) {
      window.__AA_NOFREEZE__.heal();
    }
    const cartOpen = !!document.querySelector("#aa-cart-root.is-open");
    const mnavOpen = !!document.querySelector("#aa-mobile-nav.is-open, .aa-mnav-root.is-open");
    document.body.classList.add("aa-cart-kill-sw", "aa-nofreeze");
    document.documentElement.classList.add("aa-nofreeze");
    document.body.classList.remove("modal-open", "offcanvas-open");
    if (!cartOpen) {
      document.body.classList.remove("aa-cart-open");
      document.body.style.removeProperty("overflow");
      document.body.style.removeProperty("padding-right");
      document.documentElement.style.removeProperty("overflow");
    }
    if (!mnavOpen) {
      document.body.classList.remove("aa-mnav-open");
    }
    killPreloader();
    document.querySelectorAll(
      ".modal-backdrop, .offcanvas-backdrop, .search_popup_backdrop, .model_backdrop"
    ).forEach((el) => {
      el.classList.remove("show", "showing", "show_notify_backdrop");
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("pointer-events", "none", "important");
      try {
        el.remove();
      } catch (_) {
        /* ignore */
      }
    });
    document.querySelectorAll(".search_popup, #bcae_model_popup, .offcanvas.show, .offcanvas.showing").forEach((el) => {
      if (el.id === "aa-cookie-config") return;
      el.classList.remove("show", "showing", "show_notify_popup");
    });
    // Never inline-hide an open cart (that was the buy-click freeze).
    document.querySelectorAll("#aa-cart-root").forEach((el) => {
      el.style.removeProperty("display");
      el.style.removeProperty("pointer-events");
      el.style.removeProperty("visibility");
      el.style.removeProperty("opacity");
    });
    const cookie = document.getElementById("aa-cookie-config");
    if (cookie && !cookie.classList.contains("open")) {
      cookie.style.display = "none";
    }
  }

  function goToCartPage() {
    closeDrawer();
    killShopwareOffcanvas();
    killPreloader();
    unfreezePage();
    const target = "/checkout/cart";
    // Instant SPA navigation when shop-app is available (no white logo splash)
    if (typeof window.__AA_NAV__?.go === "function") {
      window.__AA_NAV__.go(target);
      return;
    }
    // From homepage mirror: navigate without waiting on preloader
    location.assign(target);
  }

  function goToCheckoutPage() {
    closeDrawer();
    killShopwareOffcanvas();
    killPreloader();
    unfreezePage();
    const target = "/checkout";
    if (typeof window.__AA_NAV__?.go === "function") {
      window.__AA_NAV__.go(target);
      return;
    }
    location.assign(target);
  }

  function wireCartButtons() {
    // Header bag opens the right swipe drawer (official offcanvas feel)
    document.querySelectorAll(".header-cart-btn, [data-off-canvas-cart], .header-cart a").forEach((el) => {
      if (el.dataset.aaCartWired === "1") return;
      el.dataset.aaCartWired = "1";
      el.setAttribute("href", "#cart");
      el.setAttribute("role", "button");
      el.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          justAddedQty = 0;
          openDrawer();
        },
        true
      );
    });
    document.querySelectorAll("[data-off-canvas-cart]").forEach((el) => {
      el.removeAttribute("data-off-canvas-cart");
      el.setAttribute("data-aa-cart-trigger", "true");
    });
    // Explicit view-cart links still go to the full cart page
    document.querySelectorAll('a[href="/checkout/cart"], a[href="/cart"], [data-aa-view-cart]').forEach((el) => {
      if (el.classList.contains("header-cart-btn") || el.closest(".header-cart")) return;
      if (el.dataset.aaViewCartWired === "1") return;
      el.dataset.aaViewCartWired = "1";
      el.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          goToCartPage();
        },
        true
      );
    });
    // Enter details / checkout links: SPA, never full reload splash
    document.querySelectorAll('a[href="/checkout"], a[href="/checkout/"], [data-aa-checkout]').forEach((el) => {
      if (el.dataset.aaCheckoutWired === "1") return;
      el.dataset.aaCheckoutWired = "1";
      el.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          goToCheckoutPage();
        },
        true
      );
    });
  }

  function handleBuySubmit(form) {
    const qtyInput = form.querySelector(
      'input[name="lineItems[quantity]"], input[name*="quantity"], input[type="number"]'
    );
    const qty = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);
    const product = findProductFromForm(form);
    if (product) addItem(product, qty);
    else toast(t("couldNotAdd"));
  }

  function wireBuyForms() {
    document
      .querySelectorAll(
        'form.buy-widget, form[data-add-to-cart], form[action*="line-item"], form[action*="line-item/add"]'
      )
      .forEach((form) => {
        if (form.dataset.aaCartWired === "1") return;
        form.dataset.aaCartWired = "1";
        form.addEventListener(
          "submit",
          (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            handleBuySubmit(form);
          },
          true
        );
      });
    // Buy buttons: always prevent Shopware offcanvas path
    document.querySelectorAll("button.btn-buy, button[title='Buy'], button[title='Acheter'], button[title='Kaufen']").forEach((btn) => {
      if (btn.dataset.aaCartWired === "1") return;
      btn.dataset.aaCartWired = "1";
      btn.addEventListener(
        "click",
        (e) => {
          const form = btn.closest("form");
          if (form) {
            e.preventDefault();
            e.stopImmediatePropagation();
            handleBuySubmit(form);
            return;
          }
          e.preventDefault();
          e.stopImmediatePropagation();
          const product = findProductFromForm(btn);
          if (product) addItem(product, 1);
        },
        true
      );
    });
  }

  function observeDom() {
    let timer = null;
    const mo = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        wireCartButtons();
        wireBuyForms();
        const broken = [...document.querySelectorAll(".offcanvas.show, .offcanvas.showing")].find((el) =>
          el.querySelector(".loaderImage, .header-logo-main-img, #aa-app-root")
        );
        if (broken) killShopwareOffcanvas();
        // If body scroll lock stuck without an open drawer/menu, clear it
        if (
          (document.body.style.overflow === "hidden" || document.body.classList.contains("modal-open")) &&
          !document.querySelector("#aa-cart-root.is-open") &&
          !document.querySelector("#aa-mobile-nav.is-open") &&
          !document.querySelector("#aa-cookie-config.open")
        ) {
          unfreezePage();
        }
      }, 200);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function boot() {
    document.body.classList.add("aa-cart-kill-sw");
    unfreezePage();
    window.addEventListener("pageshow", unfreezePage);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") unfreezePage();
    });
    // Keep recovery alive even if later boot steps throw
    setInterval(() => {
      try {
        wireCartButtons();
        wireBuyForms();
        updateBadge();
      } catch (_) {
        /* ignore */
      }
      const open = document.querySelector("#aa-cart-root.is-open");
      if (!open) {
        unfreezePage();
        return;
      }
      // Self-heal: is-open must stay visible (recover from any stray inline hide)
      if (getComputedStyle(open).display === "none") {
        open.style.removeProperty("display");
        open.style.removeProperty("pointer-events");
        open.style.removeProperty("visibility");
      }
    }, 2000);

    try {
      const res = await fetch("/data/catalog.json");
      catalog = await res.json();
    } catch {
      catalog = { products: [] };
    }
    try {
      updateBadge();
      ensureRoot();
      wireCartButtons();
      wireBuyForms();
      observeDom();
    } catch (err) {
      console.warn("cart-ui boot partial failure", err);
      unfreezePage();
    }

    // Expose for shop-app synergy
    window.__AA_CART__ = {
      open: openDrawer,
      close: closeDrawer,
      add: addItem,
      load: loadCart,
      refresh: () => {
        updateBadge();
        if (root?.classList.contains("is-open")) renderDrawer();
      },
    };

    // Keep drawer in sync if shop-app mutates cart
    window.addEventListener("aa:lang-changed", () => {
      if (root) {
        const panel = root.querySelector(".aa-cart-panel");
        if (panel) panel.setAttribute("aria-label", t("shoppingCart"));
        renderDrawer();
      }
      updateBadge();
    });
    window.addEventListener("aa:cart-changed", () => {
      updateBadge();
      if (root?.classList.contains("is-open")) renderDrawer();
    });

    // If landed on cart page with stuck offcanvas from previous nav, clear it
    killShopwareOffcanvas();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
