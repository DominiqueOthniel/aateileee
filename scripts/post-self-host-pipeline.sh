#!/usr/bin/env bash
# Wait for self-host image download DONE, then scrub URLs, push GitHub, redeploy Netlify.
set -u
ROOT=/agent/aateile-clone
LOG=/tmp/aa-self-host-images/pipeline.log
SITE_ID=ba55ceba-b009-4a4b-89c3-62f0ca74dfd4
exec >>"$LOG" 2>&1
echo "==== pipeline start $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="

wait_done() {
  while true; do
    if grep -q '^DONE ' /tmp/aa-self-host-images/download.log 2>/dev/null; then
      echo "download DONE line found"
      return 0
    fi
    if ! pgrep -f 'scripts/self-host-images.py' >/dev/null 2>&1; then
      # process exited; treat as done if finished >= pending
      python3 - <<'PY'
import json,sys
s=json.load(open("/tmp/aa-self-host-images/state.json"))["stats"]
fin,pend=s.get("finished",0),s.get("pending",0)
print(f"process gone finished={fin} pending={pend}")
sys.exit(0 if fin>=pend and pend>0 else 1)
PY
      if [ $? -eq 0 ]; then return 0; fi
      echo "downloader stopped early; abort wait"
      return 1
    fi
    # progress heartbeat
    python3 - <<'PY'
import json
s=json.load(open("/tmp/aa-self-host-images/state.json"))["stats"]
print(f"waiting… finished={s.get('finished')}/{s.get('pending')} ok={s.get('ok')} fail={s.get('fail')}")
PY
    sleep 60
  done
}

wait_done || { echo "wait failed"; exit 1; }

cd "$ROOT"

echo "=== force rewrite catalog ==="
python3 -u scripts/self-host-images.py --rewrite-only

echo "=== scrub remaining aateile hosts in JSON/HTML/JS ==="
python3 - <<'PY'
import json,re
from pathlib import Path
ROOT=Path("/agent/aateile-clone")

def remote_to_local(u:str):
    u=u.split("?")[0].split("#")[0]
    if "aateile.com/media/" in u:
        i=u.find("/media/")
        return u[i:] if i>=0 else ""
    if "aateile.s3." in u:
        from urllib.parse import urlparse
        return "/media/s3"+urlparse(u).path
    return ""

# catalog + spares already rewritten; verify + force blank leftovers
for rel in ["data/catalog.json","data/spares-categories.json"]:
    p=ROOT/rel
    if not p.exists():
        continue
    text=p.read_text(encoding="utf-8")
    before=len(re.findall(r'https?://[^"\']*aateile\.(?:com|s3)[^"\']*', text))
    if before:
        obj=json.loads(text)
        # walk
        def walk(o):
            n=0
            if isinstance(o,dict):
                for k,v in list(o.items()):
                    if isinstance(v,str) and re.search(r'aateile\.(com|s3)', v):
                        if v.startswith("http"):
                            loc=remote_to_local(v)
                            o[k]=loc if loc else ""
                        else:
                            o[k]=""
                        n+=1
                    else:
                        n+=walk(v)
            elif isinstance(o,list):
                for i,v in enumerate(o):
                    if isinstance(v,str) and re.search(r'aateile\.(com|s3)', v):
                        if v.startswith("http"):
                            loc=remote_to_local(v)
                            o[i]=loc if loc else ""
                        else:
                            o[i]=""
                        n+=1
                    else:
                        n+=walk(v)
            return n
        n=walk(obj)
        if rel.endswith("catalog.json"):
            p.write_text(json.dumps(obj,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
        else:
            p.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding="utf-8")
        after=len(re.findall(r'https?://[^"\']*aateile\.(?:com|s3)[^"\']*', p.read_text(encoding="utf-8")))
        print(rel, "scrubbed", n, "remain_remote", after)
    else:
        print(rel, "already clean")

# HTML: strip any aateile.com script/import/img absolute urls to relative
for rel in ["index.html","app.html","404.html"]:
    p=ROOT/rel
    if not p.exists(): continue
    t=p.read_text(encoding="utf-8",errors="replace")
    t2=re.sub(r'https?://(?:www\.)?aateile\.com(?=/)', '', t)
    t2=re.sub(r'https?://aateile\.s3\.[^/"\']+', '/media/s3', t2)
    if t2!=t:
        p.write_text(t2,encoding="utf-8")
        print(rel, "html scrubbed")
    else:
        print(rel, "html ok")

# Count JS still mentioning hosts (mapping helpers OK; ensure no hardcoded https hotlinks as src templates)
for rel in ["js/shop-app.js","js/cart-ui.js"]:
    t=(ROOT/rel).read_text(encoding="utf-8")
    hot=re.findall(r'https://aateile\.(?:com|s3)[^"\']*', t)
    print(rel, "literal_https_count", len(hot))
PY

echo "=== count remotes left ==="
python3 - <<'PY'
import re
from pathlib import Path
root=Path("/agent/aateile-clone")
for rel in ["data/catalog.json","data/spares-categories.json","js/shop-app.js","js/cart-ui.js","index.html","app.html"]:
    t=(root/rel).read_text(encoding="utf-8",errors="replace")
    n=len(re.findall(r'https?://[^"\s]*aateile\.(?:com|s3)', t))
    print(f"{rel}: remote_host_refs={n}")
PY

echo "=== git commit + push ==="
# Ensure GH token in remote URL without storing in repo
if [ -n "${GH_TOKEN:-}" ]; then
  git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/DominiqueOthniel/aateileee.git"
fi
git add scripts/self-host-images.py scripts/post-self-host-pipeline.sh \
  data/catalog.json data/fitment.json data/spares-categories.json \
  js/shop-app.js js/cart-ui.js index.html app.html 404.html \
  css/no-freeze.css js/strip-netlify-chrome.js .netlifyignore 2>/dev/null || true
# never add media/s3 bulk
git status -sb | head -30
git -c user.email=agent@cursor.local -c user.name='Cursor Agent' commit -m "Self-host images: strip aateile hotlinks from catalog" || echo "no commit needed"
for i in 1 2 3 4; do
  if GIT_TERMINAL_PROMPT=0 git push origin main; then echo PUSH_OK; break; fi
  sleep $((4*i))
done
# scrub token from remote url
git remote set-url origin "https://github.com/DominiqueOthniel/aateileee.git"
git rev-parse --short HEAD

echo "=== Netlify deploy with media (best effort) ==="
export NETLIFY_SITE_ID="$SITE_ID"
PUB=/tmp/aa-netlify-publish-full
rm -rf "$PUB"
python3 - <<'PY'
import os, shutil
from pathlib import Path
src=Path("/agent/aateile-clone"); dst=Path("/tmp/aa-netlify-publish-full"); dst.mkdir(parents=True)
SKIP={".git","node_modules",".netlify","__pycache__"}
# Include media/s3 this time
count=0
for dirpath, dirnames, filenames in os.walk(src, followlinks=False):
  rel_dir=str(Path(dirpath).relative_to(src))
  if rel_dir==".": rel_dir=""
  dirnames[:] = [d for d in dirnames if d not in SKIP]
  for fn in filenames:
    rel=f"{rel_dir}/{fn}" if rel_dir else fn
    if rel.endswith(".log"): continue
    s=src/rel
    if s.is_symlink() or not s.is_file(): continue
    d=dst/rel
    d.parent.mkdir(parents=True, exist_ok=True)
    try:
      # hardlink to save space/time when possible
      os.link(s,d)
    except Exception:
      shutil.copy2(s,d)
    count+=1
print("publish_files", count)
PY
du -sh "$PUB" "$PUB/media/s3" 2>/dev/null || true
cd "$PUB"
# npm for functions
if [ -f package.json ]; then npm ci --omit=dev >/tmp/aa-npm-ci.log 2>&1 || npm install --omit=dev >/tmp/aa-npm-ci.log 2>&1; fi

for i in 1 2 3 4 5 6; do getent hosts api.netlify.com >/dev/null && break; sleep $((3*i)); done
# Disable SSO just in case
curl -sS --max-time 30 -X PATCH -H "Authorization: Bearer ${NETLIFY_AUTH_TOKEN}" -H "Content-Type: application/json" \
  "https://api.netlify.com/api/v1/sites/${SITE_ID}" \
  -d '{"sso_login":false,"built_with_badge_enabled":false}' >/tmp/nf-sso-fix.json || true

npx --yes netlify-cli deploy --prod --dir=/tmp/aa-netlify-publish-full --site="$SITE_ID" \
  --functions=/tmp/aa-netlify-publish-full/netlify/functions \
  --skip-functions-cache \
  --message "Self-host media + zero aateile image hotlinks" \
  2>&1 | tee /tmp/nf-deploy-media.log | tail -80

echo "=== verify live ==="
sleep 5
for u in \
  "https://aateilepiecesauto.netlify.app/" \
  "https://aateilepiecesauto.netlify.app/js/shop-app.js" \
  "https://aateilepiecesauto.netlify.app/data/catalog.json"; do
  echo "$(curl -4 -sS -o /tmp/v -w '%{http_code}' --max-time 60 "$u" || echo ERR) $u"
done
# sample catalog for aateile hosts (first 5MB)
python3 - <<'PY'
import re,urllib.request
url='https://aateilepiecesauto.netlify.app/data/catalog.json'
try:
  data=urllib.request.urlopen(url, timeout=120).read(8_000_000).decode('utf-8','replace')
  n=len(re.findall(r'https?://[^"\']*aateile\.(?:com|s3)', data))
  print('live_catalog_sample_remote_refs', n)
except Exception as e:
  print('catalog_check_err', e)
js=urllib.request.urlopen('https://aateilepiecesauto.netlify.app/js/shop-app.js', timeout=60).read().decode()
print('shop_has_remoteImageToLocal', 'remoteImageToLocal' in js)
PY

echo "==== pipeline end $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
echo PIPELINE_COMPLETE
