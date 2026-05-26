#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-load-test.sh — Run the k6 load test against a target environment.
#
# Usage:
#   ./tests/load/run-load-test.sh [BASE_URL]
#
# Examples:
#   ./tests/load/run-load-test.sh                         # local dev (default)
#   ./tests/load/run-load-test.sh http://localhost:3000   # explicit local
#   ./tests/load/run-load-test.sh https://staging.velthoryn.vercel.app
#
# Prerequisites:
#   - k6 installed: https://k6.io/docs/get-started/installation/
#     Ubuntu/Debian: sudo apt install k6
#     macOS:         brew install k6
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${1:-http://localhost:3000}"

echo "Running load test against: ${BASE_URL}"
echo "Script: ${SCRIPT_DIR}/api-load.js"
echo ""

k6 run \
  --env BASE_URL="${BASE_URL}" \
  "${SCRIPT_DIR}/api-load.js"
