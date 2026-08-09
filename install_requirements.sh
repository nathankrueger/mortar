#!/usr/bin/env bash
# Installs all dependencies for the Mortar Mayhem monorepo (shared, client, server).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js is required but was not found. Install Node >= 22.12 from https://nodejs.org" >&2
  exit 1
fi

node -e '
const [maj, min] = process.versions.node.split(".").map(Number);
const ok = maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19);
if (!ok) {
  console.error(`error: Node ${process.versions.node} is too old; need >= 22.12 (or >= 20.19).`);
  process.exit(1);
}
'

echo "==> npm install (workspaces: shared, client, server)"
npm install

echo ""
echo "Done. Next steps:"
echo "  ./run_tests.sh          # unit tests + typecheck"
echo "  npm run dev             # dev servers (client :5173, server :8787)"
echo "  npm run build && npm start   # production build, single process on :8787"
