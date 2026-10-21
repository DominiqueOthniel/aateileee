#!/usr/bin/env node
/**
 * Upload local media/s3 + large JSON to the public Vercel Blob store.
 *
 *   node scripts/upload-to-vercel-blob.mjs --data-only
 *   node scripts/upload-to-vercel-blob.mjs --fitment-only
 *   node scripts/upload-to-vercel-blob.mjs --media-only --concurrency 16
 */
import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE = path.join("/tmp", "aa-blob-upload-state.json");

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

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const concurrency = (() => {
  const i = argv.indexOf("--concurrency");
  return i >= 0 ? Math.max(1, Number(argv[i + 1]) || 12) : 12;
})();

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return { done: {} };
  }
}

function saveState(state) {
  writeFileSync(STATE, JSON.stringify(state));
}

function guessContentType(pathname) {
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

async function uploadFile(localPath, pathname, state) {
  if (state.done[pathname]) return "skip";
  const size = statSync(localPath).size;
  const body =
    size > 8 * 1024 * 1024
      ? createReadStream(localPath)
      : readFileSync(localPath);
  await put(pathname, body, {
    access: "public",
    token,
    contentType: guessContentType(pathname),
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: size > 8 * 1024 * 1024,
  });
  state.done[pathname] = { size, at: new Date().toISOString() };
  return "ok";
}

async function walkFiles(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

async function mapPool(items, limit, fn) {
  let i = 0;
  let active = 0;
  let ok = 0;
  let fail = 0;
  let skip = 0;
  return new Promise((resolve) => {
    const next = () => {
      if (i >= items.length && active === 0) {
        resolve({ ok, fail, skip });
        return;
      }
      while (active < limit && i < items.length) {
        const item = items[i++];
        active++;
        Promise.resolve(fn(item))
          .then((r) => {
            if (r === "skip") skip++;
            else ok++;
          })
          .catch((err) => {
            fail++;
            console.error("FAIL", item.remote || item, err?.message || err);
          })
          .finally(() => {
            active--;
            if ((ok + fail + skip) % 200 === 0) {
              console.log(
                `progress ok=${ok} skip=${skip} fail=${fail} queued=${items.length - i} active=${active}`
              );
            }
            next();
          });
      }
    };
    next();
  });
}

async function main() {
  const state = loadState();
  const jobs = [];

  const mediaOnly = flags.has("--media-only") || flags.has("--media");
  const dataOnly = flags.has("--data-only");
  const fitmentOnly = flags.has("--fitment-only");
  const catalogOnly = flags.has("--catalog-only");

  if (fitmentOnly) {
    jobs.push({
      local: path.join(ROOT, "data/fitment.json"),
      remote: "data/fitment.json",
    });
  } else if (catalogOnly) {
    jobs.push({
      local: path.join(ROOT, "data/catalog.json"),
      remote: "data/catalog.json",
    });
  } else if (mediaOnly) {
    const mediaRoot = path.join(ROOT, "media/s3");
    const files = await walkFiles(mediaRoot);
    console.log(`media files found: ${files.length}`);
    for (const local of files) {
      const rel = path.relative(ROOT, local).split(path.sep).join("/");
      jobs.push({ local, remote: rel });
    }
  } else {
    // default / --data-only: catalog + fitment
    for (const name of ["catalog.json", "fitment.json"]) {
      const local = path.join(ROOT, "data", name);
      if (existsSync(local)) {
        jobs.push({ local, remote: `data/${name}` });
      }
    }
    if (!dataOnly && flags.has("--with-media")) {
      const mediaRoot = path.join(ROOT, "media/s3");
      const files = await walkFiles(mediaRoot);
      for (const local of files) {
        const rel = path.relative(ROOT, local).split(path.sep).join("/");
        jobs.push({ local, remote: rel });
      }
    }
  }

  const existing = jobs.filter((j) => existsSync(j.local));
  console.log(`upload jobs=${existing.length} concurrency=${concurrency}`);
  let n = 0;
  const result = await mapPool(existing, concurrency, async (job) => {
    const r = await uploadFile(job.local, job.remote, state);
    n++;
    if (n % 25 === 0 || job.remote.endsWith(".json")) {
      saveState(state);
      if (job.remote.endsWith(".json")) {
        console.log(r, job.remote, statSync(job.local).size);
      }
    }
    return r;
  });
  saveState(state);
  console.log("DONE", result, "state", STATE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
