#!/usr/bin/env bash
set -euo pipefail

REPO_URL_DEFAULT="https://github.com/LiDeChi/center-control.git"
TARGET_DIR_DEFAULT="$HOME/center-control-selfhost"
PORT_DEFAULT="3000"
RESOLVE_ENDPOINT_DEFAULT="${DEPLOY_TICKET_RESOLVE_ENDPOINT:-}"
GIT_REF_DEFAULT="main"

TICKET=""
RESOLVE_ENDPOINT="$RESOLVE_ENDPOINT_DEFAULT"
REPO_URL="$REPO_URL_DEFAULT"
TARGET_DIR="$TARGET_DIR_DEFAULT"
PORT="$PORT_DEFAULT"
GIT_REF="$GIT_REF_DEFAULT"
GITHUB_ROOT=""
OWNER_LOGIN=""
REPORT_TIME=""
TIMEZONE=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/install-center-control.sh [options]

Required:
  --ticket <token>                     One-time deploy ticket
  --resolve-endpoint <url>             resolve-deploy-ticket endpoint

Optional:
  --dir <path>                         Install directory (default: ~/center-control-selfhost)
  --port <port>                        Exposed web port (default: 3000)
  --repo <git-url>                     Override center-control repository URL
  --ref <git-ref>                      Git branch/tag/commit (default: main)
  --github-root <path>                 Host path mounted to scanner (default from ticket or ~/Documents/Github)
  --owner-login <login>                Owner login used for tracked classification
  --report-time <HH:MM>                Daily report time
  --timezone <TZ>                      Runtime timezone
  -h, --help                           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ticket)
      TICKET="$2"
      shift 2
      ;;
    --resolve-endpoint)
      RESOLVE_ENDPOINT="$2"
      shift 2
      ;;
    --dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --ref)
      GIT_REF="$2"
      shift 2
      ;;
    --github-root)
      GITHUB_ROOT="$2"
      shift 2
      ;;
    --owner-login)
      OWNER_LOGIN="$2"
      shift 2
      ;;
    --report-time)
      REPORT_TIME="$2"
      shift 2
      ;;
    --timezone)
      TIMEZONE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$TICKET" ]]; then
  echo "--ticket is required." >&2
  exit 1
fi

if [[ -z "$RESOLVE_ENDPOINT" ]]; then
  echo "--resolve-endpoint is required (or set DEPLOY_TICKET_RESOLVE_ENDPOINT)." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but not installed." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but not installed." >&2
  exit 1
fi

json_get() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
path = sys.argv[2].split(".")
current = payload

for part in path:
    if isinstance(current, dict):
        current = current.get(part)
    else:
        current = None
        break

if current is None:
    print("")
elif isinstance(current, bool):
    print("true" if current else "false")
elif isinstance(current, (dict, list)):
    print(json.dumps(current, ensure_ascii=False))
else:
    print(str(current))
PY
}

if [[ "$PORT" =~ ^[0-9]+$ ]]; then
  :
else
  echo "--port must be numeric." >&2
  exit 1
fi

request_body="$(python3 - "$TICKET" <<'PY'
import json
import sys
print(json.dumps({"ticket": sys.argv[1]}))
PY
)"

tmp_response="$(mktemp)"
http_code="$(curl -sS -o "$tmp_response" -w "%{http_code}" \
  -X POST "$RESOLVE_ENDPOINT" \
  -H "Content-Type: application/json" \
  --data "$request_body")"
response_body="$(cat "$tmp_response")"
rm -f "$tmp_response"

if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
  echo "Deploy ticket resolve failed (HTTP ${http_code})." >&2
  echo "$response_body" >&2
  exit 1
fi

resolved_ok="$(json_get "$response_body" "ok")"
if [[ "$resolved_ok" != "true" ]]; then
  echo "Deploy ticket resolve returned non-ok response." >&2
  echo "$response_body" >&2
  exit 1
fi

resolved_repo="$(json_get "$response_body" "install.repoUrl")"
resolved_ref="$(json_get "$response_body" "install.gitRef")"
resolved_port="$(json_get "$response_body" "install.defaultPort")"
resolved_root="$(json_get "$response_body" "install.defaultGithubRoot")"
resolved_owner="$(json_get "$response_body" "install.defaultOwnerLogin")"
resolved_report_time="$(json_get "$response_body" "install.defaultReportTime")"
resolved_timezone="$(json_get "$response_body" "install.defaultTimezone")"

if [[ -z "$REPO_URL" ]]; then
  REPO_URL="$resolved_repo"
fi
if [[ -z "$GIT_REF" ]]; then
  GIT_REF="$resolved_ref"
fi
if [[ -z "$PORT" ]]; then
  PORT="${resolved_port:-$PORT_DEFAULT}"
fi
if [[ -z "$GITHUB_ROOT" ]]; then
  GITHUB_ROOT="$resolved_root"
fi
if [[ -z "$OWNER_LOGIN" ]]; then
  OWNER_LOGIN="$resolved_owner"
fi
if [[ -z "$REPORT_TIME" ]]; then
  REPORT_TIME="$resolved_report_time"
fi
if [[ -z "$TIMEZONE" ]]; then
  TIMEZONE="$resolved_timezone"
fi

if [[ -z "$GITHUB_ROOT" ]]; then
  GITHUB_ROOT="$HOME/Documents/Github"
fi

if [[ "$GITHUB_ROOT" == "~/"* ]]; then
  GITHUB_ROOT="$HOME/${GITHUB_ROOT#~/}"
fi

if [[ -z "$OWNER_LOGIN" ]]; then
  OWNER_LOGIN="LiDeChi"
fi

if [[ -z "$REPORT_TIME" ]]; then
  REPORT_TIME="09:00"
fi

if [[ -z "$TIMEZONE" ]]; then
  TIMEZONE="America/New_York"
fi

if [[ -d "$TARGET_DIR/.git" ]]; then
  git -C "$TARGET_DIR" fetch --all --tags --prune
  git -C "$TARGET_DIR" checkout "$GIT_REF"
  git -C "$TARGET_DIR" pull --ff-only || true
else
  rm -rf "$TARGET_DIR"
  git clone "$REPO_URL" "$TARGET_DIR"
  git -C "$TARGET_DIR" checkout "$GIT_REF"
fi

(
  cd "$TARGET_DIR"
  WEB_PORT="$PORT" \
  GITHUB_ROOT="$GITHUB_ROOT" \
  OWNER_LOGIN="$OWNER_LOGIN" \
  REPORT_TIME="$REPORT_TIME" \
  TZ="$TIMEZONE" \
  HOST_GITHUB_ROOT="$GITHUB_ROOT" \
  docker compose up -d --build
)

echo
echo "Center Control deployment completed."
echo "URL: http://localhost:${PORT}"
echo
echo "Runtime parameters:"
echo "  GITHUB_ROOT=${GITHUB_ROOT}"
echo "  OWNER_LOGIN=${OWNER_LOGIN}"
echo "  REPORT_TIME=${REPORT_TIME}"
echo "  TZ=${TIMEZONE}"
echo
echo "Manage service:"
echo "  cd \"${TARGET_DIR}\" && WEB_PORT=${PORT} GITHUB_ROOT=\"${GITHUB_ROOT}\" docker compose ps"
echo "  cd \"${TARGET_DIR}\" && WEB_PORT=${PORT} GITHUB_ROOT=\"${GITHUB_ROOT}\" docker compose logs -f"
echo "  cd \"${TARGET_DIR}\" && WEB_PORT=${PORT} GITHUB_ROOT=\"${GITHUB_ROOT}\" docker compose down"
