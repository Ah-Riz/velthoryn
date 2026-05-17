#!/usr/bin/env bash
# Run the full Anchor integration suite against a persistent local validator.
# Avoids flaky "Blockhash not found" failures from anchor test's bundled validator
# (especially on Solana CLI 3.x).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VALIDATOR_URL="${VALIDATOR_URL:-http://127.0.0.1:8899}"
SKIP_BUILD="${TEST_SKIP_BUILD:-0}"

wait_for_validator() {
  for i in $(seq 1 30); do
    if solana cluster-version --url "$VALIDATOR_URL" >/dev/null 2>&1; then
      echo "Validator ready at $VALIDATOR_URL (${i}s)"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: no validator at $VALIDATOR_URL after 30s"
  exit 1
}

if ! solana cluster-version --url "$VALIDATOR_URL" >/dev/null 2>&1; then
  echo "Starting solana-test-validator --reset ..."
  solana-test-validator --reset --quiet &
  wait_for_validator
else
  echo "Using existing validator at $VALIDATOR_URL"
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  anchor build
  ANCHOR_TEST_ARGS=()
else
  echo "TEST_SKIP_BUILD=1 — skipping anchor build"
  ANCHOR_TEST_ARGS=(--skip-build)
fi

anchor test --skip-local-validator "${ANCHOR_TEST_ARGS[@]}" "$@"
