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

# True when there is no build, or any source is newer than the built client.
# Serving a stale bundle looks exactly like "the fix didn't work", so the
# start path rebuilds instead of trusting whatever dist happens to be there.
needs_build() {
  if [ ! -f client/dist/index.html ] || [ ! -f server/dist/index.js ]; then
    return 0
  fi
  local newer
  newer=$(
    find client/src client/index.html client/public shared/src server/src \
      package.json client/package.json shared/package.json server/package.json \
      client/vite.config.ts -newer client/dist/index.html -print 2>/dev/null |
      head -1 || true
  )
  [ -n "$newer" ]
}

status() {
  if is_running; then
    echo "mortar server: running on port $PORT (pid $(pids | head -1))"
    if needs_build; then
      echo "  STALE: sources are newer than the served build — ./run_server.sh -r"
    fi
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
    if needs_build; then
      echo "  STALE: sources are newer than the served build — ./run_server.sh -r"
    fi
    exit 1
  fi
  if needs_build; then
    echo "==> sources changed since the last build — rebuilding (client + server)"
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
