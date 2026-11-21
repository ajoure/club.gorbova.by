#!/usr/bin/env bash
# Build the frontend of the test copy (new.gorbova.by) from an exact checkout.
# Usage: build_copy_frontend.sh <checkout_dir> <out_dir>
# Points the app at the copy project, closes it from indexing. The anon key is
# public by design; it is read from the logged-in Supabase CLI, not printed.
set -euo pipefail
SRC=$1; OUT=$2
COPY=ypwsuumurrtkxatoyqhk; SOURCE=hdjgkjceownmmnrqqtuz
ANON=$(supabase projects api-keys --project-ref "$COPY" -o json 2>/dev/null \
  | python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))")
cd "$SRC"
[ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error
rm -rf "$OUT"
VITE_SUPABASE_URL="https://$COPY.supabase.co" VITE_SUPABASE_PROJECT_ID="$COPY" \
VITE_SUPABASE_PUBLISHABLE_KEY="$ANON" npx vite build --outDir "$OUT" >/dev/null
# index.html carries hard-coded preconnect/preload links to the source backend.
grep -rl "$SOURCE" "$OUT" | xargs -r sed -i '' "s/$SOURCE/$COPY/g"
sed -i '' 's#<head>#<head>\n    <meta name="robots" content="noindex, nofollow" />#' "$OUT/index.html"
printf 'User-agent: *\nDisallow: /\n' > "$OUT/robots.txt"
# SPA fallback for Cloudflare Pages.
printf '/*  /index.html  200\n' > "$OUT/_redirects"
if grep -rq "$SOURCE" "$OUT"; then echo "source_reference_left" >&2; exit 1; fi
echo "built $(git rev-parse HEAD) -> $OUT"
