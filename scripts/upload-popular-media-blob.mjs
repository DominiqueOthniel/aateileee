#!/usr/bin/env node
import { put } from "@vercel/blob";
import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE = "/tmp/aa-blob-upload-state.json";
const BUDGET = 920 * 1024 * 1024;

function loadEnvLocal() {
  const p = path.join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("BLOB_READ_WRITE_TOKEN missing");
  process.exit(1);
}

let state = { done: {} };
try {
  state = JSON.parse(readFileSync(STATE, "utf8"));
} catch {
  /* empty */
}

let used = 0;
for (const [k, v] of Object.entries(state.done || {})) {
  if (k.startsWith("media/s3/") && v.size) used += v.size;
}
console.log(
  "state media bytes",
  used,
  "files",
  Object.keys(state.done).filter((k) => k.startsWith("media/")).length
);

const rg = spawnSync(
  "rg",
  ["-o", String.raw`/media/s3/[^"']+`, "data/catalog.json"],
  { encoding: "utf8", maxBuffer: 300 * 1024 * 1024, cwd: ROOT }
);
if (rg.status !== 0 && !rg.stdout) {
  console.error("rg failed", rg.stderr);
  process.exit(1);
}
const counts = new Map();
for (const line of (rg.stdout || "").split("\n")) {
  if (!line) continue;
  const url = line.split("?")[0];
  counts.set(url, (counts.get(url) || 0) + 1);
}
const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log("unique refs", ranked.length, "top", ranked.slice(0, 3));

let uploaded = 0;
let skipped = 0;
let failed = 0;
let i = 0;
const concurrency = 4;
let stop = false;

async function worker() {
  while (!stop && i < ranked.length) {
    if (used >= BUDGET) {
      stop = true;
      return;
    }
    const idx = i++;
    const [url] = ranked[idx];
    const rel = url.replace(/^\//, "");
    const local = path.join(ROOT, rel);
    if (!existsSync(local)) {
      skipped++;
      continue;
    }
    if (state.done[rel]) {
      skipped++;
      continue;
    }
    const size = statSync(local).size;
    if (used + size > BUDGET) {
      skipped++;
      continue;
    }
    try {
      await put(
        rel,
        size > 4 * 1024 * 1024 ? createReadStream(local) : readFileSync(local),
        {
          access: "public",
          token,
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "image/jpeg",
          multipart: size > 8 * 1024 * 1024,
        }
      );
      state.done[rel] = { size, at: new Date().toISOString() };
      used += size;
      uploaded++;
      if (uploaded % 100 === 0) {
        writeFileSync(STATE, JSON.stringify(state));
        console.log("uploaded", uploaded, "usedMB", (used / 1e6).toFixed(1));
      }
    } catch (e) {
      failed++;
      const msg = String(e?.message || e);
      if (msg.includes("quota") || msg.includes("Too many requests")) {
        console.error("STOP", msg);
        stop = true;
        writeFileSync(STATE, JSON.stringify(state));
        return;
      }
      if (failed < 15) console.error("fail", rel, msg);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
writeFileSync(STATE, JSON.stringify(state));
console.log(
  "DONE uploaded",
  uploaded,
  "skipped",
  skipped,
  "failed",
  failed,
  "usedMB",
  (used / 1e6).toFixed(1)
);
