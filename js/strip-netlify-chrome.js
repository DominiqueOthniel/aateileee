/**
 * Remove Netlify injectors / built-with badge / identity widgets from the DOM.
 * Platform badge can also be toggled via Netlify API (built_with_badge_enabled).
 */
(function () {
  var SELECTORS = [
    "#preloader",
    ".preloader",
    ".page-loader",
    ".sw-loader",
    ".ajax-loader",
    ".loaderImage",
    'iframe[src*="netlify"]',
    'iframe[src*="identity.netlify"]',
    "a[href*='netlify.com'][href*='built']",
    "a[href*='www.netlify.com/?utm']",
    "#netlify-badge",
    ".netlify-badge",
    "[data-netlify-badge]",
    "[data-nf-badge]",
    "div[id^='netlify']",
    "script[src*='netlify-identity']",
    "script[src*='identity.netlify.com']",
    "script[src*='netlify.com/assets']",
  ];

  function scrub() {
    SELECTORS.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (el) {
          try {
            el.remove();
          } catch (e) {
            el.style.cssText =
              "display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important";
          }
        });
      } catch (e) {}
    });
    // Anchors that only say "Powered by Netlify" / "Built with Netlify"
    document.querySelectorAll("a[href*='netlify.com']").forEach(function (a) {
      var t = (a.textContent || "").toLowerCase();
      if (/powered by|built with|netlify/.test(t) && t.length < 80) {
        try {
          a.remove();
        } catch (e) {}
      }
    });
  }

  scrub();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scrub);
  }
  setInterval(scrub, 1500);
  try {
    new MutationObserver(scrub).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (e) {}
})();
