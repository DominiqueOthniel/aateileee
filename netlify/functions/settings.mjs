import { connectLambda, getStore } from "@netlify/blobs";
import {
  CONTACT_KEY,
  DEFAULT_EMAIL,
  FIXED_WHATSAPP,
  PASSWORD_HASH_KEY,
  bearerToken,
  isAuthorized,
  json,
  resolvePasswordHash,
  safeEqualHex,
  sha256,
} from "../lib/shared-auth.mjs";

async function getStoreSafe() {
  try {
    return getStore({ name: "aa-analytics" });
  } catch {
    return getStore("aa-analytics");
  }
}

async function readEmail(store) {
  try {
    const data = await store.get(CONTACT_KEY, { type: "json" });
    if (data && typeof data === "object" && data.email) {
      return {
        email: String(data.email).slice(0, 120),
        emailUpdatedAt: data.emailUpdatedAt || data.updatedAt || null,
      };
    }
  } catch {
    /* fall through */
  }
  return { email: DEFAULT_EMAIL, emailUpdatedAt: null };
}

function publicSettings(emailInfo) {
  return {
    ...FIXED_WHATSAPP,
    email: emailInfo.email || DEFAULT_EMAIL,
    emailUpdatedAt: emailInfo.emailUpdatedAt || null,
    // Phone is fixed in code; never writable via API
    phoneEditable: false,
  };
}

function normalizeEmail(raw) {
  const email = String(raw ?? "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "invalid_email", message: "Email looks invalid." };
  }
  return { email: email.slice(0, 120) };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  try {
    connectLambda(event);
  } catch {
    /* ignore */
  }

  let store;
  try {
    store = await getStoreSafe();
  } catch (err) {
    if (event.httpMethod === "GET") {
      return json(200, {
        ...publicSettings({ email: DEFAULT_EMAIL, emailUpdatedAt: null }),
        source: "defaults",
      });
    }
    return json(503, {
      error: "blobs_unavailable",
      message: String(err?.message || err),
    });
  }

  if (event.httpMethod === "GET") {
    const emailInfo = await readEmail(store);
    return json(200, {
      ...publicSettings(emailInfo),
      source: emailInfo.emailUpdatedAt ? "blob" : "defaults",
    });
  }

  if (event.httpMethod === "PUT" || event.httpMethod === "POST") {
    if (!(await isAuthorized(event, store))) {
      return json(401, { error: "unauthorized" });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "invalid_json" });
    }

    // Password change
    if (body.action === "change_password") {
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      const confirm = String(body.confirmPassword ?? body.newPassword ?? "");
      const session = bearerToken(event);

      if (!current || !next) {
        return json(400, {
          error: "missing_fields",
          message: "Current and new password are required.",
        });
      }
      if (next.length < 10) {
        return json(400, {
          error: "weak_password",
          message: "New password must be at least 10 characters.",
        });
      }
      if (next !== confirm) {
        return json(400, {
          error: "mismatch",
          message: "New password confirmation does not match.",
        });
      }

      const expected = await resolvePasswordHash(store);
      if (!safeEqualHex(sha256(current), expected)) {
        return json(403, {
          error: "bad_current_password",
          message: "Current password is incorrect.",
        });
      }
      // Session bearer must also be the current password
      if (!safeEqualHex(sha256(session), expected)) {
        return json(401, { error: "unauthorized" });
      }

      const hash = sha256(next);
      try {
        await store.setJSON(PASSWORD_HASH_KEY, {
          hash,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        return json(502, {
          error: "write_failed",
          message: String(err?.message || err),
        });
      }
      return json(200, {
        ok: true,
        action: "change_password",
        message: "Password updated. Use the new password next login.",
      });
    }

    // Email-only update (ignore any phone fields in the body)
    if (
      body.whatsappDigits != null ||
      body.whatsappDisplay != null ||
      body.phone != null ||
      body.phoneDigits != null
    ) {
      // Explicitly reject phone mutation attempts
      if (body.email == null && body.action !== "change_password") {
        return json(400, {
          error: "phone_not_editable",
          message: "WhatsApp / phone cannot be changed from admin.",
        });
      }
    }

    const emailNorm = normalizeEmail(body.email);
    if (emailNorm.error) return json(400, emailNorm);

    const prev = await readEmail(store);
    const next = {
      email: emailNorm.email,
      emailUpdatedAt: new Date().toISOString(),
      // Do not persist phone; site uses fixed defaults
    };
    // Preserve unrelated legacy keys only if needed — write email-only document
    try {
      await store.setJSON(CONTACT_KEY, next);
    } catch (err) {
      return json(502, {
        error: "write_failed",
        message: String(err?.message || err),
      });
    }
    return json(200, {
      ok: true,
      ...publicSettings({
        email: next.email,
        emailUpdatedAt: next.emailUpdatedAt,
      }),
      source: "blob",
      previousEmail: prev.email,
    });
  }

  return json(405, { error: "method_not_allowed" });
}
