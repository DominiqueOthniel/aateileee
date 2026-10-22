(function () {
  "use strict";
  const API = "/api/analytics";
  const SETTINGS_API = "/api/settings";
  const KEY = "aa_admin_token";

  const loginView = document.getElementById("login-view");
  const dashView = document.getElementById("dash-view");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const passwordInput = document.getElementById("password");
  const cards = document.getElementById("cards");
  const topPages = document.getElementById("top-pages");
  const recent = document.getElementById("recent");
  const updated = document.getElementById("updated");
  const emailForm = document.getElementById("email-form");
  const contactEmail = document.getElementById("contact-email");
  const emailStatus = document.getElementById("email-status");
  const emailError = document.getElementById("email-error");
  const passwordForm = document.getElementById("password-form");
  const pwCurrent = document.getElementById("pw-current");
  const pwNew = document.getElementById("pw-new");
  const pwConfirm = document.getElementById("pw-confirm");
  const passwordStatus = document.getElementById("password-status");
  const passwordError = document.getElementById("password-error");

  function token() {
    return sessionStorage.getItem(KEY) || "";
  }

  function setToken(v) {
    if (v) sessionStorage.setItem(KEY, v);
    else sessionStorage.removeItem(KEY);
  }

  function showLogin() {
    loginView.classList.remove("hidden");
    dashView.classList.add("hidden");
  }

  function showDash() {
    loginView.classList.add("hidden");
    dashView.classList.remove("hidden");
  }

  async function fetchSummary(pass) {
    const res = await fetch(API, {
      headers: { Authorization: "Bearer " + pass },
      cache: "no-store",
    });
    if (res.status === 401) throw new Error("bad_password");
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "load_failed");
    }
    return res.json();
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso || "";
    }
  }

  function detail(ev) {
    const p = ev.payload || {};
    const bits = [];
    if (p.q) bits.push("q=" + p.q);
    if (p.sku) bits.push("sku=" + p.sku);
    if (p.name) bits.push(p.name);
    if (p.lang) bits.push("lang=" + p.lang);
    if (p.qty) bits.push("qty=" + p.qty);
    if (p.source) bits.push(p.source);
    return bits.join(" · ");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render(data) {
    const t = data.today || {};
    const w = data.week || {};
    const items = [
      ["Pageviews today", t.pageviews || 0],
      ["Visitors today", t.visitorsApprox || 0],
      ["Pageviews (7d)", w.pageviews || 0],
      ["Cart adds (7d)", w.cartAdds || 0],
      ["WhatsApp orders (7d)", w.whatsappOrders || 0],
      ["Searches (7d)", w.searches || 0],
      ["Find parts (7d)", w.findParts || 0],
    ];
    cards.innerHTML = items
      .map(
        ([label, value]) =>
          `<article class="card"><div class="label">${label}</div><div class="value">${value}</div></article>`
      )
      .join("");

    const pages = data.topPages || [];
    topPages.innerHTML = pages.length
      ? pages
          .map(
            (p) =>
              `<tr><td><code>${escapeHtml(p.path)}</code></td><td>${p.count}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="2" class="muted">No page views yet.</td></tr>`;

    const rows = data.recent || [];
    recent.innerHTML = rows.length
      ? rows
          .map(
            (ev) => `<tr>
          <td>${escapeHtml(fmtTime(ev.ts))}</td>
          <td><span class="tag ${escapeHtml(ev.type)}">${escapeHtml(ev.type)}</span></td>
          <td><code>${escapeHtml(ev.path || "")}</code></td>
          <td>${escapeHtml(detail(ev))}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="muted">No events yet. Browse the shop to generate traffic.</td></tr>`;

    updated.textContent = data.generatedAt
      ? "Updated " + fmtTime(data.generatedAt)
      : "";
  }

  async function loadSettings() {
    const res = await fetch(SETTINGS_API, { cache: "no-store" });
    if (!res.ok) throw new Error("settings_load_failed");
    const data = await res.json();
    contactEmail.value = data.email || "";
    const fixed = document.getElementById("wa-fixed");
    if (fixed && data.whatsappDisplay) fixed.textContent = data.whatsappDisplay;
    if (data.emailUpdatedAt) {
      emailStatus.textContent = "Saved " + fmtTime(data.emailUpdatedAt);
    } else {
      emailStatus.textContent = "Using default email";
    }
    return data;
  }

  async function bootDash() {
    const pass = token();
    if (!pass) {
      showLogin();
      return;
    }
    try {
      const data = await fetchSummary(pass);
      showDash();
      render(data);
      try {
        await loadSettings();
      } catch {
        emailStatus.textContent = "Could not load settings";
      }
    } catch (e) {
      setToken("");
      showLogin();
      loginError.hidden = false;
      loginError.textContent =
        e.message === "bad_password"
          ? "Invalid password."
          : "Could not load analytics. Is /api/analytics available?";
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const pass = passwordInput.value;
    try {
      const data = await fetchSummary(pass);
      setToken(pass);
      showDash();
      render(data);
      passwordInput.value = "";
      try {
        await loadSettings();
      } catch {
        emailStatus.textContent = "Could not load settings";
      }
    } catch (err) {
      loginError.hidden = false;
      loginError.textContent =
        err.message === "bad_password"
          ? "Invalid password."
          : "Login failed. Check API / password.";
    }
  });

  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    emailError.hidden = true;
    const pass = token();
    if (!pass) {
      showLogin();
      return;
    }
    try {
      const res = await fetch(SETTINGS_API, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + pass,
        },
        body: JSON.stringify({ email: contactEmail.value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("bad_password");
      if (!res.ok) throw new Error(data.message || data.error || "save_failed");
      contactEmail.value = data.email || contactEmail.value;
      emailStatus.textContent = "Email saved · live for visitors";
    } catch (err) {
      emailError.hidden = false;
      emailError.textContent =
        err.message === "bad_password"
          ? "Session expired. Log in again."
          : String(err.message || "Save failed");
      if (err.message === "bad_password") {
        setToken("");
        showLogin();
      }
    }
  });

  passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    passwordError.hidden = true;
    passwordStatus.textContent = "";
    const pass = token();
    if (!pass) {
      showLogin();
      return;
    }
    if (pwNew.value !== pwConfirm.value) {
      passwordError.hidden = false;
      passwordError.textContent = "New password confirmation does not match.";
      return;
    }
    try {
      const res = await fetch(SETTINGS_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + pass,
        },
        body: JSON.stringify({
          action: "change_password",
          currentPassword: pwCurrent.value,
          newPassword: pwNew.value,
          confirmPassword: pwConfirm.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("bad_password");
      if (res.status === 403) throw new Error(data.message || "bad_current_password");
      if (!res.ok) throw new Error(data.message || data.error || "save_failed");
      // Update session to the new password so the admin stays logged in
      setToken(pwNew.value);
      pwCurrent.value = "";
      pwNew.value = "";
      pwConfirm.value = "";
      passwordStatus.textContent = "Password updated";
    } catch (err) {
      passwordError.hidden = false;
      passwordError.textContent = String(err.message || "Password change failed");
      if (err.message === "bad_password") {
        setToken("");
        showLogin();
      }
    }
  });

  document.getElementById("logout").addEventListener("click", () => {
    setToken("");
    showLogin();
  });
  document.getElementById("refresh").addEventListener("click", () => bootDash());

  bootDash();
})();
