import { createHash, timingSafeEqual } from "node:crypto";

export const DEFAULT_HASH =
  "8a3290ab5d1c5d79c50819359d7208c47404f0d57609ba502358f626fccdc52e";

export const PASSWORD_HASH_KEY = "settings/admin-password-hash";
export const CONTACT_KEY = "settings/contact";

export const FIXED_WHATSAPP = {
  whatsappDigits: "33644684920",
  whatsappDisplay: "+33 6 44 68 49 20",
};

export const DEFAULT_EMAIL = "aateilepieceauto1@gmail.com";

export function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), "utf8");
    const bb = Buffer.from(String(b), "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Password hash priority (Blob wins so admin can change password without redeploy):
 * 1) Blobs settings/admin-password-hash
 * 2) AA_ADMIN_PASSWORD env (cleartext → hashed)
 * 3) AA_ADMIN_PASSWORD_HASH env
 * 4) baked-in DEFAULT_HASH
 */
export async function resolvePasswordHash(store) {
  if (store) {
    try {
      const data = await store.get(PASSWORD_HASH_KEY, { type: "json" });
      const hash = String(data?.hash || "").toLowerCase();
      if (/^[a-f0-9]{64}$/.test(hash)) return hash;
    } catch {
      /* fall through */
    }
  }
  if (process.env.AA_ADMIN_PASSWORD) {
    return sha256(process.env.AA_ADMIN_PASSWORD);
  }
  if (process.env.AA_ADMIN_PASSWORD_HASH) {
    return String(process.env.AA_ADMIN_PASSWORD_HASH).toLowerCase();
  }
  return DEFAULT_HASH;
}

export function bearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : "";
}

export async function isAuthorized(event, store) {
  const token = bearerToken(event);
  if (!token) return false;
  const expected = await resolvePasswordHash(store);
  return safeEqualHex(sha256(token), expected);
}

export function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}
