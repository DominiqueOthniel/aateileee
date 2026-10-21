import {
  CONTACT_KEY,
  DEFAULT_EMAIL,
  FIXED_WHATSAPP,
  PASSWORD_HASH_KEY,
  bearerToken,
  blobGetJson,
  blobPutJson,
  isAuthorized,
  readBody,
  resolvePasswordHash,
  safeEqualHex,
  sendJson,
  sha256,
} from "./_lib/auth.mjs";

export const config = {
  maxDuration: 30,
};

async function readEmail() {
  const data = await blobGetJson(CONTACT_KEY);
  if (data && typeof data === "object" && data.email) {
    return {
      email: String(data.email).slice(0, 120),
      emailUpdatedAt: data.emailUpdatedAt || data.updatedAt || null,
    };
  }
  return { email: DEFAULT_EMAIL, emailUpdatedAt: null };
}

function publicSettings(emailInfo) {
  return {
    ...FIXED_WHATSAPP,
    email: emailInfo.email || DEFAULT_EMAIL,
    emailUpdatedAt: emailInfo.emailUpdatedAt || null,
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

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.method === "GET") {
    const emailInfo = await readEmail();
    return sendJson(res, 200, {
      ...publicSettings(emailInfo),
      source: emailInfo.emailUpdatedAt ? "blob" : "defaults",
    });
  }

  if (req.method === "PUT" || req.method === "POST") {
    if (!(await isAuthorized(req))) {
      return sendJson(res, 401, { error: "unauthorized" });
    }

    let body = {};
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }

    if (body.action === "change_password") {
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      const confirm = String(body.confirmPassword ?? body.newPassword ?? "");
      const session = bearerToken(req);

      if (!current || !next) {
        return sendJson(res, 400, {
          error: "missing_fields",
          message: "Current and new password are required.",
        });
      }
      if (next.length < 10) {
        return sendJson(res, 400, {
          error: "weak_password",
          message: "New password must be at least 10 characters.",
        });
      }
      if (next !== confirm) {
        return sendJson(res, 400, {
          error: "mismatch",
          message: "New password confirmation does not match.",
        });
      }

      const expected = await resolvePasswordHash();
      if (!safeEqualHex(sha256(current), expected)) {
        return sendJson(res, 403, {
          error: "bad_current_password",
          message: "Current password is incorrect.",
        });
      }
      if (!safeEqualHex(sha256(session), expected)) {
        return sendJson(res, 401, { error: "unauthorized" });
      }

      const hash = sha256(next);
      try {
        await blobPutJson(PASSWORD_HASH_KEY, {
          hash,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        return sendJson(res, 502, {
          error: "write_failed",
          message: String(err?.message || err),
        });
      }
      return sendJson(res, 200, {
        ok: true,
        action: "change_password",
        message: "Password updated. Use the new password next login.",
      });
    }

    if (
      body.whatsappDigits != null ||
      body.whatsappDisplay != null ||
      body.phone != null ||
      body.phoneDigits != null
    ) {
      if (body.email == null && body.action !== "change_password") {
        return sendJson(res, 400, {
          error: "phone_not_editable",
          message: "WhatsApp / phone cannot be changed from admin.",
        });
      }
    }

    const emailNorm = normalizeEmail(body.email);
    if (emailNorm.error) return sendJson(res, 400, emailNorm);

    const prev = await readEmail();
    const next = {
      email: emailNorm.email,
      emailUpdatedAt: new Date().toISOString(),
    };
    try {
      await blobPutJson(CONTACT_KEY, next);
    } catch (err) {
      return sendJson(res, 502, {
        error: "write_failed",
        message: String(err?.message || err),
      });
    }
    return sendJson(res, 200, {
      ok: true,
      ...publicSettings({
        email: next.email,
        emailUpdatedAt: next.emailUpdatedAt,
      }),
      source: "blob",
      previousEmail: prev.email,
    });
  }

  return sendJson(res, 405, { error: "method_not_allowed" });
}
