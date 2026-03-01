#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

echo "[acceptance] starting docker compose"
docker compose up -d --build

echo "[acceptance] waiting for web"
WEB_PORT=${WEB_PORT:-3000}
for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${WEB_PORT}/api/reports?limit=1" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

echo "[acceptance] verifying report output"
LATEST_REPORT=$(ls -1 data/reports/*.md 2>/dev/null | tail -n 1 || true)
if [ -z "${LATEST_REPORT}" ]; then
  echo "[acceptance] expected at least one report markdown under data/reports/"
  exit 1
fi

if [ ! -f "data/exports/projects.json" ]; then
  echo "[acceptance] expected export data/exports/projects.json not found"
  exit 1
fi

echo "[acceptance] verifying project and codex APIs"
PROJECTS_JSON=$(curl -fsS "http://localhost:${WEB_PORT}/api/projects?scope=tracked&sort=activity")
FIRST_PROJECT_ID=$(printf "%s" "${PROJECTS_JSON}" | python3 -c 'import json,sys; data=json.load(sys.stdin); projects=data.get("projects") or []; print((projects[0].get("id") if projects else ""), end="")')
if [ -z "${FIRST_PROJECT_ID}" ]; then
  echo "[acceptance] expected at least one tracked project from /api/projects"
  exit 1
fi

CODEX_RESPONSE=$(curl -fsS -X POST "http://localhost:${WEB_PORT}/api/codex" \
  -H "content-type: application/json" \
  -d "{\"projectId\":\"${FIRST_PROJECT_ID}\",\"message\":\"acceptance smoke\"}")
CODEX_OK=$(printf "%s" "${CODEX_RESPONSE}" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(str(bool(data.get("ok"))).lower(), end="")')
if [ "${CODEX_OK}" != "true" ]; then
  echo "[acceptance] /api/codex did not return ok=true"
  exit 1
fi

PRODUCTION_PROJECT_ID=$(PROJECTS_JSON="${PROJECTS_JSON}" python3 - <<'PY'
import json
import os

data = json.loads(os.environ.get("PROJECTS_JSON", "{}"))
projects = data.get("projects") or []
found = ""
for project in projects:
    if project.get("productionUrl") or project.get("demoUrl") or project.get("sourceUrl"):
        found = project.get("id", "")
        break
print(found, end="")
PY
)

if [ -n "${PRODUCTION_PROJECT_ID}" ]; then
  ACTION_RESPONSE=$(curl -fsS -X POST "http://localhost:${WEB_PORT}/api/project-actions" \
    -H "content-type: application/json" \
    -d "{\"projectId\":\"${PRODUCTION_PROJECT_ID}\",\"action\":\"open-production\"}")
  ACTION_OK=$(printf "%s" "${ACTION_RESPONSE}" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(str(bool(data.get("ok"))).lower(), end="")')
  if [ "${ACTION_OK}" != "true" ]; then
    echo "[acceptance] /api/project-actions open-production did not return ok=true"
    exit 1
  fi
fi

echo "[acceptance] done"
