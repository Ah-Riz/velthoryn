#!/usr/bin/env bash
# Run integration tests against devnet RPC (program must already be deployed).
# Clock-dependent cases still use solana-bankrun inside vesting.clock.spec.ts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

echo "Provider: $ANCHOR_PROVIDER_URL"
echo "Wallet:   $ANCHOR_WALLET"

BALANCE="$(solana balance --url "$ANCHOR_PROVIDER_URL" 2>/dev/null || echo "unknown")"
echo "Balance:  $BALANCE"

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

SKIP_BUILD="${TEST_SKIP_BUILD:-1}"
if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "Building program..."
  anchor build --ignore-keys
fi

# Run tests directly on devnet — anchor test would redeploy to localnet using
# target/deploy/vesting-keypair.json (often mismatched vs declare_id G6iaig…).
echo "Running integration tests on $ANCHOR_PROVIDER_URL ..."
exec pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.spec.ts' "$@"
