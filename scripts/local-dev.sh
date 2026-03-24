#!/usr/bin/env bash
set -euo pipefail

# Council Platform — Local Dev Startup
#
# Designed to be called from local-dev/up.sh as a stage, or run standalone.
# Expects the following env vars to be set by the caller:
#
#   COUNCIL_PLATFORM_PATH  — path to council-platform repo
#   PG_PORT                — PostgreSQL port (shared with provider-platform)
#   COUNCIL_PORT           — council-platform HTTP port (default: 3015)
#   COUNCIL_SK             — council admin secret key
#   OPEX_PUBLIC            — OpEx public key
#   OPEX_SECRET            — OpEx secret key
#   CHANNEL_AUTH_ID        — Channel Auth contract ID
#   STELLAR_RPC_PORT       — Stellar RPC port
#   SERVICE_AUTH_SECRET     — JWT signing secret (optional, auto-generated in dev)
#   DENO_BIN               — path to deno binary
#   SCRIPT_DIR             — local-dev script directory (for PID/log files)
#
# Database: creates a council_platform_db in the shared PostgreSQL container.

COUNCIL_PLATFORM_PATH="${COUNCIL_PLATFORM_PATH:-$HOME/repos/council-platform}"
COUNCIL_PORT="${COUNCIL_PORT:-3015}"
PG_PORT="${PG_PORT:-5442}"
PG_CONTAINER="${PG_CONTAINER:-provider-platform-db}"
DENO_BIN="${DENO_BIN:-deno}"
SCRIPT_DIR="${SCRIPT_DIR:-.}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }

# Create council database in the shared PostgreSQL container
info "Creating council_platform_db in shared PostgreSQL..."
docker exec "$PG_CONTAINER" psql -U "${ACCT_ADMIN:-admin}" -tc \
  "SELECT 1 FROM pg_database WHERE datname = 'council_platform_db'" | grep -q 1 || \
  docker exec "$PG_CONTAINER" psql -U "${ACCT_ADMIN:-admin}" -c \
  "CREATE DATABASE council_platform_db"

COUNCIL_DATABASE_URL="postgresql://${ACCT_ADMIN:-admin}:${POSTGRES_PASSWORD:-devpass}@localhost:${PG_PORT}/council_platform_db"

cd "$COUNCIL_PLATFORM_PATH"

# Run migrations
info "Running council-platform migrations..."
DATABASE_URL="$COUNCIL_DATABASE_URL" "$DENO_BIN" task db:push 2>/dev/null || \
  warn "Migration push failed (may need manual db:migrate)"

# Start council-platform
info "Starting council-platform (background, port $COUNCIL_PORT)..."
COUNCIL_LOG="$SCRIPT_DIR/council-platform.log"

PORT=$COUNCIL_PORT \
MODE=development \
LOG_LEVEL=TRACE \
DATABASE_URL="$COUNCIL_DATABASE_URL" \
NETWORK=local \
NETWORK_FEE=1000000000 \
STELLAR_RPC_URL="http://localhost:${STELLAR_RPC_PORT:-8000}/soroban/rpc" \
CHANNEL_AUTH_ID="${CHANNEL_AUTH_ID}" \
COUNCIL_SK="${COUNCIL_SK}" \
OPEX_PUBLIC="${OPEX_PUBLIC}" \
OPEX_SECRET="${OPEX_SECRET}" \
SERVICE_DOMAIN=localhost \
SERVICE_AUTH_SECRET="${SERVICE_AUTH_SECRET:-}" \
CHALLENGE_TTL=900 \
SESSION_TTL=21600 \
nohup "$DENO_BIN" task serve > "$COUNCIL_LOG" 2>&1 &

COUNCIL_PID=$!
echo "$COUNCIL_PID" > "$SCRIPT_DIR/.council-platform.pid"
info "Council Platform running (PID $COUNCIL_PID, log: $COUNCIL_LOG)"

# Wait for health check
for i in $(seq 1 15); do
  if curl -sf "http://localhost:${COUNCIL_PORT}/api/v1/health" >/dev/null 2>&1; then
    info "Council Platform is ready."
    break
  fi
  if [ "$i" -eq 15 ]; then
    warn "Council Platform may not be ready yet. Check $COUNCIL_LOG"
  fi
  sleep 1
done

# Export for downstream stages
export COUNCIL_PORT COUNCIL_PID
