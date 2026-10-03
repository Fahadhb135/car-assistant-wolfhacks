#!/usr/bin/env bash
# Starts the cloud service with ../.env loaded. Usage: cloud/run.sh [port]
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../.env ] && { set -a; . ../.env; set +a; } || echo "warning: no ../.env, running with fallbacks only"
exec .venv/bin/uvicorn app.main:app_factory --factory --host 0.0.0.0 --port "${1:-8000}"
