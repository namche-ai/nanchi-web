#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE="${REMOTE:-root@47.115.58.5}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/root/official-website/lead-service}"
REMOTE_NGINX_CONTAINER="${REMOTE_NGINX_CONTAINER:-deploy-nginx-1}"
SITE_URL="${SITE_URL:-https://www.namche.cn/}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-deploy/.env.leads}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd git
need_cmd ssh
need_cmd scp
need_cmd tar
need_cmd curl

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ ! -f server/server.mjs || ! -f deploy/docker-compose.leads.yml ]]; then
  echo "Lead service source is incomplete." >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d%H%M%S)"
COMMIT="$(git rev-parse --short=12 HEAD)"
REMOTE_ARCHIVE="/tmp/namche-leads-${TIMESTAMP}-${COMMIT}.tar.gz"
REMOTE_ENV_FILE="/tmp/namche-leads-env-${TIMESTAMP}"
REMOTE_BACKUP_DIR="/root/deploy-backups/namche-leads-${TIMESTAMP}"
LEAD_ARCHIVE="$(mktemp)"
API_CHECK_FILE="$(mktemp)"
SSH_STATE_DIR="$REPO_ROOT/deploy/.ssh"
KNOWN_HOSTS_FILE="$SSH_STATE_DIR/known_hosts"
mkdir -p "$SSH_STATE_DIR"

SSH_ARGS=(
  -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE"
  -o StrictHostKeyChecking=accept-new
)
if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
  SSH_ARGS+=( -i "$DEPLOY_SSH_KEY" )
elif [[ -f "$SSH_STATE_DIR/namche_deploy" ]]; then
  SSH_ARGS+=( -i "$SSH_STATE_DIR/namche_deploy" )
fi

cleanup() {
  rm -f "$LEAD_ARCHIVE" "$API_CHECK_FILE"
}
trap cleanup EXIT

tar -czf "$LEAD_ARCHIVE" \
  server \
  deploy/docker-compose.leads.yml \
  deploy/nginx-leads-location.conf \
  deploy/.env.leads.example

scp "${SSH_ARGS[@]}" "$LEAD_ARCHIVE" "$REMOTE:$REMOTE_ARCHIVE"

if [[ -n "${WECHAT_WORK_WEBHOOK_URL:-}" ]]; then
  {
    printf 'WECHAT_WORK_WEBHOOK_URL=%s\n' "$WECHAT_WORK_WEBHOOK_URL"
    printf '%s\n' \
      'ALLOWED_ORIGINS=https://www.namche.cn,https://namche.cn' \
      'LEADS_DB_PATH=/data/leads.db' \
      'PORT=8787' \
      'HOST=0.0.0.0' \
      'RATE_LIMIT_WINDOW_MS=600000' \
      'RATE_LIMIT_MAX=5' \
      'RETRY_INTERVAL_MS=60000' \
      'RETRY_BASE_MS=60000' \
      'MAX_NOTIFICATION_ATTEMPTS=12' \
      'WEBHOOK_TIMEOUT_MS=8000'
  } | ssh "${SSH_ARGS[@]}" "$REMOTE" "umask 077; cat > '$REMOTE_ENV_FILE'"
elif [[ -f "$LOCAL_ENV_FILE" ]]; then
  scp "${SSH_ARGS[@]}" "$LOCAL_ENV_FILE" "$REMOTE:$REMOTE_ENV_FILE"
fi

ssh "${SSH_ARGS[@]}" "$REMOTE" "set -e
mkdir -p '$REMOTE_APP_DIR' '$REMOTE_BACKUP_DIR'
if [ -d '$REMOTE_APP_DIR/server' ] || [ -d '$REMOTE_APP_DIR/deploy' ]; then
  cp -a '$REMOTE_APP_DIR' '$REMOTE_BACKUP_DIR/lead-service'
fi
tar -xzf '$REMOTE_ARCHIVE' -C '$REMOTE_APP_DIR'
rm -f '$REMOTE_ARCHIVE'
if [ -f '$REMOTE_ENV_FILE' ]; then
  install -m 600 '$REMOTE_ENV_FILE' '$REMOTE_APP_DIR/deploy/.env.leads'
  rm -f '$REMOTE_ENV_FILE'
fi
if [ ! -f '$REMOTE_APP_DIR/deploy/.env.leads' ]; then
  echo 'Missing $REMOTE_APP_DIR/deploy/.env.leads. Set WECHAT_WORK_WEBHOOK_URL for the first deploy.' >&2
  exit 1
fi
chmod 600 '$REMOTE_APP_DIR/deploy/.env.leads'
docker compose -f '$REMOTE_APP_DIR/deploy/docker-compose.leads.yml' up -d --build
if ! docker inspect -f '{{json .NetworkSettings.Networks}}' '$REMOTE_NGINX_CONTAINER' | grep -q 'namche-leads-network'; then
  docker network connect namche-leads-network '$REMOTE_NGINX_CONTAINER'
fi
docker exec namche-lead-api node -e \"fetch('http://127.0.0.1:8787/healthz').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})\"
docker exec '$REMOTE_NGINX_CONTAINER' nginx -t
docker exec '$REMOTE_NGINX_CONTAINER' nginx -s reload
"

API_HTTP_CODE="$(curl -sS -o "$API_CHECK_FILE" -w "%{http_code}" \
  -X POST \
  -H 'Content-Type: application/json' \
  --data '{}' \
  "${SITE_URL%/}/api/leads")"

if [[ "$API_HTTP_CODE" != "400" ]] || ! grep -q '"ok":false' "$API_CHECK_FILE"; then
  echo "Lead API verification failed: ${SITE_URL%/}/api/leads returned HTTP $API_HTTP_CODE." >&2
  echo "Ensure deploy/nginx-leads-location.conf is included by the production nginx server." >&2
  exit 1
fi

echo "Lead service deployed and public API verified."
