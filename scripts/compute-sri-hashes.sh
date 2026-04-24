#!/usr/bin/env bash
# Regenerate SRI integrity hashes for the CDN scripts in
# src/daddy_agent/viz/static/index.html and replace the placeholders.
#
# Why: SRI protects the dashboard against CDN tampering. Version pins alone
# do NOT — a republished tag (intentional or malicious) loads whatever the
# CDN currently serves. Running this before every deploy closes that gap.
set -euo pipefail

INDEX="src/daddy_agent/viz/static/index.html"
declare -A URLS=(
  [graphology]="https://cdn.jsdelivr.net/npm/graphology@0.25.4/dist/graphology.umd.min.js"
  [forceatlas2]="https://cdn.jsdelivr.net/npm/graphology-layout-forceatlas2@0.10.1/build/graphology-layout-forceatlas2.min.js"
  [sigma]="https://cdn.jsdelivr.net/npm/sigma@3.0.1/build/sigma.min.js"
)

for name in graphology forceatlas2 sigma; do
  url="${URLS[$name]}"
  hash=$(curl -fsSL "$url" | openssl dgst -sha384 -binary | openssl base64 -A)
  sri="sha384-${hash}"
  # Replace the placeholder that immediately follows the matching src= line.
  python3 - "$INDEX" "$url" "$sri" <<'PY'
import sys, re, pathlib
path, url, sri = sys.argv[1], sys.argv[2], sys.argv[3]
src = pathlib.Path(path).read_text()
# Find the <script ... src="$url" ...> block and replace its integrity value.
pat = re.compile(
    r'(src="' + re.escape(url) + r'"\s*\n\s*integrity=")[^"]+"',
    re.MULTILINE,
)
new, n = pat.subn(lambda m: m.group(1) + sri + '"', src)
if n == 0:
    sys.exit(f"no match for {url!r} in {path}")
pathlib.Path(path).write_text(new)
PY
  echo "  $name  $sri"
done

# Remove the regen marker once every hash has been rewritten above.
if ! grep -q "PLACEHOLDER-REGENERATE-BEFORE-DEPLOY" "$INDEX"; then
  sed -i.bak '/<!-- REQUIRES_SRI_REGEN -->/d' "$INDEX" && rm -f "${INDEX}.bak"
  echo "SRI hashes updated; REQUIRES_SRI_REGEN marker removed."
else
  echo "WARNING: some placeholders remain — inspect $INDEX before deploying."
  exit 1
fi
