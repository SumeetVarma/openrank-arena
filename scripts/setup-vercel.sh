#!/usr/bin/env bash
# One-shot Vercel setup for openrank-arena.
#
# Provisions:
#   - Vercel KV (Upstash Redis) — players, submissions, scores
#   - Vercel Blob — submission zips
#   - ARENA_SHARED_PASSWORD env var
#   - Disables Deployment Protection so friends can visit without logging in
#   - Triggers a fresh production deploy
#
# Usage:
#   VERCEL_TOKEN=vcp_... bash scripts/setup-vercel.sh
#
# Pass ARENA_SHARED_PASSWORD=somepass to override the default.

set -e

: "${VERCEL_TOKEN:?Set VERCEL_TOKEN env var}"
PROJECT_ID="${VERCEL_PROJECT_ID:-prj_D71y8Fvd1cOjWiB4b8VjjgPdPFYh}"
TEAM_ID="${VERCEL_TEAM_ID:-team_nr2110y2b1Ldi69QXORunURv}"
SHARED_PASSWORD="${ARENA_SHARED_PASSWORD:-WANNABE_FOUNDERS}"

API="https://api.vercel.com"
AUTH=(-H "Authorization: Bearer $VERCEL_TOKEN")
TEAM_Q="?teamId=$TEAM_ID"

# Pretty helpers
say() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }
ok()  { printf "  \033[1;32m✓\033[0m %s\n" "$1"; }
warn(){ printf "  \033[1;33m!\033[0m %s\n" "$1"; }
err() { printf "  \033[1;31m✗\033[0m %s\n" "$1"; }

# ---------- 1. Vercel KV ----------
say "Provisioning Vercel KV (Redis)..."
KV_LIST=$(curl -sS "${AUTH[@]}" "$API/v1/storage/stores$TEAM_Q&projectId=$PROJECT_ID")
KV_ID=$(printf '%s' "$KV_LIST" | python3 -c "import sys,json
d=json.load(sys.stdin)
for s in d.get('stores', []):
    if s.get('type') == 'kv':
        print(s.get('id'))
        break" 2>/dev/null || true)

if [ -n "$KV_ID" ]; then
  ok "KV already exists: $KV_ID"
else
  KV_CREATE=$(curl -sS "${AUTH[@]}" -H "Content-Type: application/json" \
    "$API/v1/storage/stores/kv$TEAM_Q" \
    -d "{\"name\":\"openrank-arena-kv\",\"projectId\":\"$PROJECT_ID\",\"primaryRegion\":\"iad1\"}")
  KV_ID=$(printf '%s' "$KV_CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('store',{}).get('id') or '')")
  if [ -z "$KV_ID" ]; then
    err "KV create failed:"
    echo "$KV_CREATE"
    exit 1
  fi
  ok "Created KV: $KV_ID"
fi

# Connect KV to project (idempotent)
KV_CONNECT=$(curl -sS "${AUTH[@]}" -H "Content-Type: application/json" \
  "$API/v1/storage/stores/$KV_ID/connections$TEAM_Q" \
  -d "{\"projectId\":\"$PROJECT_ID\",\"envVarEnvironments\":[\"production\",\"preview\",\"development\"]}" || true)
ok "Connected KV to project"

# ---------- 2. Vercel Blob ----------
say "Provisioning Vercel Blob..."
BLOB_ID=$(printf '%s' "$KV_LIST" | python3 -c "import sys,json
d=json.load(sys.stdin)
for s in d.get('stores', []):
    if s.get('type') == 'blob':
        print(s.get('id'))
        break" 2>/dev/null || true)

if [ -n "$BLOB_ID" ]; then
  ok "Blob already exists: $BLOB_ID"
else
  BLOB_CREATE=$(curl -sS "${AUTH[@]}" -H "Content-Type: application/json" \
    "$API/v1/storage/stores/blob$TEAM_Q" \
    -d "{\"name\":\"openrank-arena-blob\",\"projectId\":\"$PROJECT_ID\"}")
  BLOB_ID=$(printf '%s' "$BLOB_CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('store',{}).get('id') or '')")
  if [ -z "$BLOB_ID" ]; then
    err "Blob create failed:"
    echo "$BLOB_CREATE"
    exit 1
  fi
  ok "Created Blob: $BLOB_ID"
fi

BLOB_CONNECT=$(curl -sS "${AUTH[@]}" -H "Content-Type: application/json" \
  "$API/v1/storage/stores/$BLOB_ID/connections$TEAM_Q" \
  -d "{\"projectId\":\"$PROJECT_ID\",\"envVarEnvironments\":[\"production\",\"preview\",\"development\"]}" || true)
ok "Connected Blob to project"

# ---------- 3. ARENA_SHARED_PASSWORD ----------
say "Setting ARENA_SHARED_PASSWORD env var..."

# Remove existing first to avoid duplicates
EXISTING=$(curl -sS "${AUTH[@]}" "$API/v9/projects/$PROJECT_ID/env$TEAM_Q")
EXISTING_ID=$(printf '%s' "$EXISTING" | python3 -c "import sys,json
d=json.load(sys.stdin)
for e in d.get('envs', []):
    if e.get('key') == 'ARENA_SHARED_PASSWORD':
        print(e.get('id'))
        break" 2>/dev/null || true)
if [ -n "$EXISTING_ID" ]; then
  curl -sS -X DELETE "${AUTH[@]}" "$API/v9/projects/$PROJECT_ID/env/$EXISTING_ID$TEAM_Q" > /dev/null
  ok "Removed stale ARENA_SHARED_PASSWORD"
fi

ENV_CREATE=$(curl -sS "${AUTH[@]}" -H "Content-Type: application/json" \
  "$API/v10/projects/$PROJECT_ID/env$TEAM_Q" \
  -d "{\"key\":\"ARENA_SHARED_PASSWORD\",\"value\":\"$SHARED_PASSWORD\",\"type\":\"plain\",\"target\":[\"production\",\"preview\",\"development\"]}")
ENV_OK=$(printf '%s' "$ENV_CREATE" | python3 -c "import sys,json
d=json.load(sys.stdin)
print('yes' if d.get('created') else d.get('error',{}).get('message','unknown'))" 2>/dev/null || echo "unknown")
ok "ARENA_SHARED_PASSWORD set ($ENV_OK)"

# ---------- 4. Disable Deployment Protection ----------
say "Disabling Deployment Protection (so friends can visit)..."
PROT=$(curl -sS -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" \
  "$API/v9/projects/$PROJECT_ID$TEAM_Q" \
  -d "{\"ssoProtection\":null,\"passwordProtection\":null}")
ok "Deployment Protection disabled"

# ---------- 5. Trigger fresh production deploy ----------
say "Triggering fresh production deploy with new env vars + storage..."

# Get latest deployment to redeploy
LATEST=$(curl -sS "${AUTH[@]}" "$API/v6/deployments$TEAM_Q&projectId=$PROJECT_ID&limit=1&target=production")
LATEST_ID=$(printf '%s' "$LATEST" | python3 -c "import sys,json
d=json.load(sys.stdin)
deps=d.get('deployments',[])
print(deps[0].get('uid') if deps else '')" 2>/dev/null || true)

if [ -z "$LATEST_ID" ]; then
  warn "No previous production deploy found — push a commit to trigger one"
else
  REDEPLOY=$(curl -sS "${AUTH[@]}" -H "Content-Type: application/json" \
    "$API/v13/deployments$TEAM_Q&forceNew=1" \
    -d "{\"name\":\"openrank-arena\",\"deploymentId\":\"$LATEST_ID\",\"target\":\"production\"}")
  NEW_URL=$(printf '%s' "$REDEPLOY" | python3 -c "import sys,json
d=json.load(sys.stdin)
print(d.get('url') or d.get('error',{}).get('message','no url'))" 2>/dev/null || echo "unknown")
  ok "Redeploy triggered: https://$NEW_URL"
fi

# ---------- Done ----------
say "Setup complete."
echo
echo "  Vercel KV:                    $KV_ID"
echo "  Vercel Blob:                  $BLOB_ID"
echo "  ARENA_SHARED_PASSWORD:        $SHARED_PASSWORD"
echo "  Deployment Protection:        disabled"
echo
echo "  Production URL:               https://openrank-arena.vercel.app"
echo "  (also https://openrank-arena-sumeetbvarma-8975s-projects.vercel.app)"
echo
echo "Friends can now run the harness with:"
echo "  ARENA_BASE_URL=https://openrank-arena.vercel.app \\"
echo "  ARENA_SHARED_PASSWORD=$SHARED_PASSWORD \\"
echo "  ANTHROPIC_API_KEY=sk-ant-... \\"
echo "  node harness/run-judge.mjs --scenario carryon --players sumeet,alice"
echo
