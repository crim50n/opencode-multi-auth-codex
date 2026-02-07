#!/usr/bin/env bash
set -euo pipefail

# Patch OpenCode's hashed entry bundle to improve Safari compatibility on plain HTTP:
# - crypto.randomUUID polyfill
# - navigator.clipboard.writeText fallback (textarea + execCommand)
#
# This script is intended to run on the VPS host.
#
# Required:
# - OpenCode upstream reachable on 127.0.0.1:4097
# - nginx serves the patched asset via alias (see nginx-opencode.conf.example)
#
# Notes:
# - We patch only the *entry module* index-<hash>.js.
# - We do NOT patch session-*.js chunks. Proxy them with no-store instead.

UPSTREAM_URL="${UPSTREAM_URL:-http://127.0.0.1:4097}"
OUT_DIR="${OUT_DIR:-/srv/opencode/overrides/assets}"
AUTH_USER="${AUTH_USER:-opencode}"
AUTH_PASS="${AUTH_PASS:-}"

if [[ -z "${AUTH_PASS}" ]]; then
  echo "AUTH_PASS is required (upstream basic auth password)." >&2
  exit 2
fi

tmp_html="$(mktemp)"
trap 'rm -f "$tmp_html"' EXIT

curl -fsSL -u "${AUTH_USER}:${AUTH_PASS}" "${UPSTREAM_URL}/" -o "$tmp_html"

if command -v rg >/dev/null 2>&1; then
  index_path="$(rg -o -m 1 '/assets/index-[^\"\\x27]+' "$tmp_html" || true)"
else
  index_path="$(grep -Eo '/assets/index-[^"'"'"']+' "$tmp_html" | head -n 1 || true)"
fi
if [[ -z "${index_path}" ]]; then
  echo "Failed to detect index bundle path from upstream HTML." >&2
  exit 3
fi

index_file="$(basename "$index_path")"
mkdir -p "$OUT_DIR"
out_path="${OUT_DIR}/${index_file}"

echo "Detected index bundle: ${index_file}"
echo "Downloading to: ${out_path}"

curl -fsSL -u "${AUTH_USER}:${AUTH_PASS}" "${UPSTREAM_URL}${index_path}" -o "$out_path"

OUT_PATH="$out_path" python3 - <<'PY'
import os
from pathlib import Path

path = Path(os.environ["OUT_PATH"])
s = path.read_text("utf-8")

if "__oc_randomUUID" in s and "__oc_clipboard_shim__" in s:
    print("Already patched.")
    raise SystemExit(0)

# Insert after the Vite modulepreload polyfill closure (first occurrence of ')();\\n')
ins_at = s.find(")();\n")
if ins_at == -1:
    raise SystemExit("Could not find insertion point in bundle.")
ins_at += len(")();\n")

patch = (
    "const __oc_randomUUID=()=>\"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx\".replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c===\"x\"?r:(r&3|8);return v.toString(16)});\n"
    "try{const c=globalThis.crypto||globalThis.msCrypto; if(c && typeof c.randomUUID!==\"function\"){c.randomUUID=__oc_randomUUID;}}catch{}\n"
    "/*__oc_clipboard_shim__*/try{\n"
    "  const n=globalThis.navigator;\n"
    "  if(n){\n"
    "    const w=(t)=>{\n"
    "      try{\n"
    "        const e=document.createElement('textarea');\n"
    "        e.value=String(t??'');\n"
    "        e.setAttribute('readonly','');\n"
    "        e.style.position='fixed';\n"
    "        e.style.top='-9999px';\n"
    "        e.style.left='-9999px';\n"
    "        document.body.appendChild(e);\n"
    "        e.select();\n"
    "        e.setSelectionRange(0,e.value.length);\n"
    "        document.execCommand('copy');\n"
    "        document.body.removeChild(e);\n"
    "      }catch{}\n"
    "      return Promise.resolve();\n"
    "    };\n"
    "    const cur=n.clipboard;\n"
    "    if(!cur||typeof cur.writeText!==\"function\"){\n"
    "      const patched=(()=>{try{return cur&&typeof cur===\"object\"?Object.assign({},cur,{writeText:w}):{writeText:w}}catch{return {writeText:w}}})();\n"
    "      let ok=false;\n"
    "      try{Object.defineProperty(n,\"clipboard\",{value:patched,configurable:true});ok=true;}catch{}\n"
    "      if(!ok){try{n.clipboard=patched;ok=true;}catch{}}\n"
    "      if(!ok){try{const proto=Object.getPrototypeOf(n);proto&&Object.defineProperty(proto,\"clipboard\",{get(){return patched},configurable:true});}catch{}}\n"
    "    }\n"
    "  }\n"
    "}catch{}\n"
)

path.write_text(s[:ins_at] + patch + s[ins_at:], "utf-8")
print("Patched.")
PY

echo "Patched bundle written: ${out_path}"
