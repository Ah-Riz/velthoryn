#!/usr/bin/env bash
# Run the full Anchor integration suite against a persistent local validator.
# Avoids flaky "Blockhash not found" failures from anchor test's bundled validator
# (especially on Solana CLI 3.x).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Keep BPF artifacts in-repo (Cursor sandbox otherwise builds under /tmp/.../cargo-target).
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

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
elif [[ "${TEST_RESET_VALIDATOR:-1}" == "1" ]]; then
  echo "Resetting existing validator at $VALIDATOR_URL (TEST_RESET_VALIDATOR=1) ..."
  pkill -f solana-test-validator 2>/dev/null || true
  sleep 2
  solana-test-validator --reset --quiet &
  wait_for_validator
else
  echo "Using existing validator at $VALIDATOR_URL (set TEST_RESET_VALIDATOR=1 to reset)"
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  anchor build --ignore-keys
  ANCHOR_TEST_ARGS=()
else
  echo "TEST_SKIP_BUILD=1 — skipping anchor build"
  ANCHOR_TEST_ARGS=(--skip-build)
fi

PROGRAM_ID="G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu"
KEYPAIR="${ROOT}/target/deploy/vesting-keypair.json"
if [[ ! -f "$KEYPAIR" ]]; then
  echo "ERROR: $KEYPAIR not found — run anchor build first"
  exit 1
fi
DEPLOYER="${SOLANA_KEYPAIR:-$HOME/.config/solana/id.json}"
if [[ ! -f "$DEPLOYER" ]]; then
  echo "ERROR: deployer keypair not found at $DEPLOYER"
  exit 1
fi
PAYER=$(solana-keygen pubkey "$DEPLOYER")
echo "Airdropping SOL to deployer $PAYER ..."
solana airdrop 10 "$PAYER" --url "$VALIDATOR_URL" || true
echo "Deploying program $PROGRAM_ID on local validator..."
solana program deploy "$ROOT/target/deploy/vesting.so" \
  --program-id "$KEYPAIR" \
  --keypair "$DEPLOYER" \
  --url "$VALIDATOR_URL"

anchor test --skip-local-validator "${ANCHOR_TEST_ARGS[@]}" "$@"
