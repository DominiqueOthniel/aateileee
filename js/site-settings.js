(function () {
  "use strict";
  const ENDPOINT = "/api/settings";
  // WhatsApp / phone is fixed in the site; only email is loaded from settings.
  const FIXED = {
    whatsappDigits: "33644684920",
    whatsappDisplay: "+33 6 44 68 49 20",
  };
  const DEFAULT_EMAIL = "aateilepieceauto1@gmail.com";

  const contact = {
    whatsappDigits: FIXED.whatsappDigits,
    whatsappDisplay: FIXED.whatsappDisplay,
    email: DEFAULT_EMAIL,
  };
  window.__AA_CONTACT__ = contact;

  function applyEmail(email) {
    if (!email) return;
    contact.email = String(email);
    // Never allow API to override fixed WhatsApp
    contact.whatsappDigits = FIXED.whatsappDigits;
    contact.whatsappDisplay = FIXED.whatsappDisplay;
    window.__AA_CONTACT__ = contact;

    document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (
        !/aateilepieceauto1@gmail\.com/i.test(href) &&
        !a.hasAttribute("data-aa-email") &&
        !/@/.test(a.textContent || "")
      ) {
        return;
      }
      // Only rewrite known contact mailto / marked nodes / previous contact emails
      if (
        a.hasAttribute("data-aa-email") ||
        /aateilepieceauto1@gmail\.com/i.test(href) ||
        /@/.test(a.textContent || "")
      ) {
        a.href = "mailto:" + contact.email;
        a.setAttribute("data-aa-email", "1");
        if ((a.textContent || "").includes("@") && !a.querySelector("img,svg")) {
          a.textContent = contact.email;
        }
      }
    });

    try {
      window.dispatchEvent(new CustomEvent("aa:contact-updated", { detail: { ...contact } }));
    } catch {
      /* ignore */
    }
  }

  window.aaGetContact = function () {
    return { ...contact };
  };

  fetch(ENDPOINT, { cache: "no-store", credentials: "omit" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && data.email) applyEmail(data.email);
    })
    .catch(() => {
      /* keep default email */
    });
})();
