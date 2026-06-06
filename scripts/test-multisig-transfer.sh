#!/usr/bin/env bash
# Test upgrade authority transfer on devnet.
#
# Generates a fresh test keypair, deploys the program, transfers upgrade
# authority to a second test keypair (simulating a multisig), verifies the
# transfer, then restores the original authority on cleanup.
#
# Usage: ./scripts/test-multisig-transfer.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

DEPLOYER="${SOLANA_KEYPAIR:-$HOME/.config/solana/id.json}"
URL="${SOLANA_URL:-https://api.devnet.solana.com}"
TEST_DIR="$CARGO_TARGET_DIR/multisig-test"

cleanup() {
  echo ""
  echo "=== Cleanup ==="
  if [[ -n "${ORIGINAL_AUTH:-}" && -n "${PROGRAM_ID:-}" && -f "$TEST_KEYPAIR" ]]; then
    echo "Restoring upgrade authority to $ORIGINAL_AUTH ..."
    solana program set-upgrade-authority "$PROGRAM_ID" \
      --new-authority "$ORIGINAL_AUTH" \
      --url "$URL" \
      --keypair "$TEST_KEYPAIR" 2>/dev/null || echo "WARNING: could not restore authority (may have expired)"
  fi
  echo "Test artifacts in $TEST_DIR (remove manually if needed)"
}
trap cleanup EXIT

echo "=== Multisig Authority Transfer Test (devnet) ==="
echo "URL: $URL"
echo ""

# ── Step 1: Generate fresh test keypairs ────────────────────────────

echo "--- Step 1: Generate test keypairs ---"
mkdir -p "$TEST_DIR"

TEST_KEYPAIR="$TEST_DIR/test-deployer.json"
MULTISIG_KEYPAIR="$TEST_DIR/test-multisig.json"

if [[ ! -f "$TEST_KEYPAIR" ]]; then
  solana-keygen new --no-bip39-passphrase --outfile "$TEST_KEYPAIR" || true
fi
if [[ ! -f "$MULTISIG_KEYPAIR" ]]; then
  solana-keygen new --no-bip39-passphrase --outfile "$MULTISIG_KEYPAIR" || true
fi

TEST_PUBKEY="$(solana-keygen pubkey "$TEST_KEYPAIR")"
MULTISIG_PUBKEY="$(solana-keygen pubkey "$MULTISIG_KEYPAIR")"

echo "Test deployer:  $TEST_PUBKEY"
echo "Fake multisig:  $MULTISIG_PUBKEY"
echo ""

# ── Step 2: Airdrop devnet SOL ──────────────────────────────────────

echo "--- Step 2: Airdrop SOL ---"
solana airdrop 2 "$TEST_PUBKEY" --url "$URL" || true
sleep 2
solana airdrop 2 "$TEST_PUBKEY" --url "$URL" || true
echo ""

# ── Step 3: Build program ──────────────────────────────────────────

echo "--- Step 3: Build program ---"
anchor build -- --locked 2>&1 | tail -3
echo ""

# ── Step 4: Deploy under test keypair ──────────────────────────────

echo "--- Step 4: Deploy to devnet ---"
PROGRAM_ID="$(solana-keygen pubkey "$CARGO_TARGET_DIR/deploy/vesting-keypair.json" 2>/dev/null || echo "")"
if [[ -z "$PROGRAM_ID" ]]; then
  echo "ERROR: could not determine program ID from keypair"
  exit 1
fi
ORIGINAL_AUTH="$TEST_PUBKEY"

echo "Program ID:     $PROGRAM_ID"
echo "Deploying ..."
solana program deploy "$CARGO_TARGET_DIR/deploy/vesting.so" \
  --program-id "$CARGO_TARGET_DIR/deploy/vesting-keypair.json" \
  --url "$URL" \
  --keypair "$TEST_KEYPAIR" || {
    echo "WARNING: deploy failed (may already exist), trying upgrade ..."
    solana program deploy "$CARGO_TARGET_DIR/deploy/vesting.so" \
      --program-id "$CARGO_TARGET_DIR/deploy/vesting-keypair.json" \
      --url "$URL" \
      --keypair "$TEST_KEYPAIR" \
      --upgrade-authority "$TEST_KEYPAIR" || {
      echo "ERROR: could not deploy or upgrade"
      exit 1
    }
  }
echo "Deployed."
echo ""

# ── Step 5: Transfer upgrade authority ─────────────────────────────

echo "--- Step 5: Transfer upgrade authority to multisig ---"
echo "From: $ORIGINAL_AUTH"
echo "To:   $MULTISIG_PUBKEY"

solana program set-upgrade-authority "$PROGRAM_ID" \
  --new-authority "$MULTISIG_PUBKEY" \
  --url "$URL" \
  --keypair "$TEST_KEYPAIR"

echo "Authority transferred."
echo ""

# ── Step 6: Verify ─────────────────────────────────────────────────

echo "--- Step 6: Verify authority ---"
CURRENT_AUTH="$(solana program show "$PROGRAM_ID" --url "$URL" | grep "Upgrade Authority" | awk '{print $NF}')"
echo "Current upgrade authority: $CURRENT_AUTH"

if [[ "$CURRENT_AUTH" == "$MULTISIG_PUBKEY" ]]; then
  echo "PASS: upgrade authority is multisig ($MULTISIG_PUBKEY)"
else
  echo "FAIL: expected $MULTISIG_PUBKEY, got $CURRENT_AUTH"
  exit 1
fi
echo ""

echo "=== All checks passed ==="
echo "Cleanup will restore original authority: $ORIGINAL_AUTH"
