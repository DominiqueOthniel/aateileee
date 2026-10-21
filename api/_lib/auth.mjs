import { createHash, timingSafeEqual } from "node:crypto";
import { put } from "@vercel/blob";

export const DEFAULT_HASH =
  "8a3290ab5d1c5d79c50819359d7208c47404f0d57609ba502358f626fccdc52e";

export const PASSWORD_HASH_KEY = "appdata/settings/admin-password-hash.json";
export const CONTACT_KEY = "appdata/settings/contact.json";

export const BLOB_PUBLIC_BASE =
  process.env.BLOB_PUBLIC_BASE ||
  "https://47sii87xn2moiwd4.public.blob.vercel-storage.com";

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

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || "";
}

export async function blobGetJson(pathname) {
  const url = `${BLOB_PUBLIC_BASE}/${pathname.replace(/^\//, "")}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function blobPutJson(pathname, data) {
  const token = blobToken();
  if (!token) throw new Error("blob_token_missing");
  const body = JSON.stringify(data);
  return put(pathname, body, {
    access: "public",
    token,
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/**
 * Password hash priority:
 * 1) Blob appdata/settings/admin-password-hash.json
 * 2) AA_ADMIN_PASSWORD env
 * 3) AA_ADMIN_PASSWORD_HASH env
 * 4) baked-in DEFAULT_HASH
 */
export async function resolvePasswordHash() {
  const data = await blobGetJson(PASSWORD_HASH_KEY);
  const hash = String(data?.hash || "").toLowerCase();
  if (/^[a-f0-9]{64}$/.test(hash)) return hash;
  if (process.env.AA_ADMIN_PASSWORD) {
    return sha256(process.env.AA_ADMIN_PASSWORD);
  }
  if (process.env.AA_ADMIN_PASSWORD_HASH) {
    return String(process.env.AA_ADMIN_PASSWORD_HASH).toLowerCase();
  }
  return DEFAULT_HASH;
}

export function bearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return m ? m[1].trim() : "";
}

export async function isAuthorized(req) {
  const token = bearerToken(req);
  if (!token) return false;
  const expected = await resolvePasswordHash();
  return safeEqualHex(sha256(token), expected);
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, PUT, POST, OPTIONS"
  );
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}
