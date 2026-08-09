#!/usr/bin/env bash
# Manage the Mortar Mayhem production server (client + WebSocket, one process).
#
#   ./run_server.sh        start it (builds first if needed), runs in background
#   ./run_server.sh -s     status: pid, health, and join URLs
#   ./run_server.sh -r     restart
#   ./run_server.sh -k     stop
#
# Respects PORT (default 8787). Logs go to ./server.log.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8787}"
LOG="server.log"

pids() { lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null || true; }
is_running() { [ -n "$(pids)" ]; }

status() {
  if is_running; then
    echo "mortar server: running on port $PORT (pid $(pids | head -1))"
    if health=$(curl -sf "http://localhost:$PORT/healthz"); then
      echo "  health: $health"
    else
      echo "  health: port is bound but /healthz is not answering"
    fi
    { grep -E "local:|lan:" "$LOG" 2>/dev/null || true; } | tail -4 | sed 's/^/  /'
  else
    echo "mortar server: not running (port $PORT free)"
    return 1
  fi
}

stop_server() {
  if is_running; then
    kill $(pids)
    for _ in $(seq 1 20); do is_running || break; sleep 0.25; done
    if is_running; then kill -9 $(pids) 2>/dev/null || true; fi
    echo "mortar server: stopped"
  else
    echo "mortar server: not running"
  fi
}

start_server() {
  if is_running; then
    echo "mortar server: already running on port $PORT (use -r to restart)"
    exit 1
  fi
  if [ ! -f client/dist/index.html ] || [ ! -f server/dist/index.js ]; then
    echo "==> building first (client + server)"
    npm run build
  fi
  nohup npm start >"$LOG" 2>&1 &
  echo "==> starting…"
  for _ in $(seq 1 40); do
    if curl -sf "http://localhost:$PORT/healthz" >/dev/null 2>&1; then
      status
      return 0
    fi
    sleep 0.5
  done
  echo "error: server did not come up — last log lines:" >&2
  tail -15 "$LOG" >&2
  exit 1
}

case "${1:-}" in
  -s) status ;;
  -k) stop_server ;;
  -r)
    stop_server
    echo "==> rebuilding"
    npm run build >/dev/null
    start_server
    ;;
  '') start_server ;;
  *)
    echo "usage: $0 [-s status | -r restart | -k stop]" >&2
    exit 2
    ;;
esac
