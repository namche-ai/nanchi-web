#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE="${REMOTE:-root@47.115.58.5}"
REMOTE_STATIC_DIR="${REMOTE_STATIC_DIR:-/root/official-website/static}"
REMOTE_NGINX_CONTAINER="${REMOTE_NGINX_CONTAINER:-deploy-nginx-1}"
SITE_URL="${SITE_URL:-https://www.namche.cn/}"

ALLOW_DIRTY=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy.sh [--allow-dirty]

Deploy the static Namche website to production.

Environment overrides:
  REMOTE                  SSH target. Default: root@47.115.58.5
  REMOTE_STATIC_DIR       Remote static directory. Default: /root/official-website/static
  REMOTE_NGINX_CONTAINER  Remote entry nginx container. Default: deploy-nginx-1
  SITE_URL                URL to verify after deploy. Default: https://www.namche.cn/

Options:
  --allow-dirty           Deploy with uncommitted local changes.
  -h, --help              Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd git
need_cmd rsync
need_cmd ssh
need_cmd curl

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ ! -f index.html || ! -d assets ]]; then
  echo "Deploy source is incomplete. Expected index.html and assets/ in $REPO_ROOT" >&2
  exit 1
fi

if [[ "$ALLOW_DIRTY" -ne 1 && -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit your changes first, or pass --allow-dirty." >&2
  exit 1
fi

COMMIT="$(git rev-parse --short=12 HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
REMOTE_RELEASE_DIR="/tmp/namche-web-release-${TIMESTAMP}-${COMMIT}"
REMOTE_BACKUP_DIR="/root/deploy-backups/namche-web-${TIMESTAMP}"
CHECK_FILE="$(mktemp)"

cleanup() {
  rm -f "$CHECK_FILE"
}
trap cleanup EXIT

echo "Deploying ${BRANCH}@${COMMIT} to ${REMOTE}:${REMOTE_STATIC_DIR}"

ssh "$REMOTE" "set -e
mkdir -p '$REMOTE_RELEASE_DIR' '$REMOTE_BACKUP_DIR'
if [ -d '$REMOTE_STATIC_DIR' ]; then
  cp -a '$REMOTE_STATIC_DIR' '$REMOTE_BACKUP_DIR/static'
fi
"

rsync -az --delete index.html assets/ "$REMOTE:$REMOTE_RELEASE_DIR/"

ssh "$REMOTE" "set -e
mkdir -p '$REMOTE_STATIC_DIR'
rsync -a --delete '$REMOTE_RELEASE_DIR/' '$REMOTE_STATIC_DIR/'
printf '%s\n' \
  'commit=$COMMIT' \
  'branch=$BRANCH' \
  'deployed_at=$TIMESTAMP' \
  > '$REMOTE_STATIC_DIR/.deploy-info'
rm -rf '$REMOTE_RELEASE_DIR'
docker exec '$REMOTE_NGINX_CONTAINER' nginx -t
docker exec '$REMOTE_NGINX_CONTAINER' nginx -s reload
"

HTTP_CODE="$(curl -sS -L -o "$CHECK_FILE" -w "%{http_code}" "$SITE_URL")"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Deploy verification failed: $SITE_URL returned HTTP $HTTP_CODE" >&2
  echo "Remote backup: $REMOTE_BACKUP_DIR" >&2
  exit 1
fi

if ! grep -q "南驰" "$CHECK_FILE"; then
  echo "Deploy verification failed: page content does not look like the Namche website." >&2
  echo "Remote backup: $REMOTE_BACKUP_DIR" >&2
  exit 1
fi

echo "Deploy complete: $SITE_URL"
echo "Remote backup: $REMOTE_BACKUP_DIR"
