#!/usr/bin/env bash
# Runs the full test suite: vitest unit tests plus TypeScript typecheck of every workspace.
# Usage: ./run_tests.sh [--coverage] [extra vitest args...]
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Unit tests (vitest)"
npx vitest run "$@"

echo ""
echo "==> Typecheck (tsc --noEmit, all workspaces)"
npm run typecheck

echo ""
echo "All tests and typechecks passed."
