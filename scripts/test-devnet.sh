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

SKIP_BUILD="${TEST_SKIP_BUILD:-1}"
if [[ "$SKIP_BUILD" == "1" ]]; then
  echo "TEST_SKIP_BUILD=1 — skipping anchor build (use TEST_SKIP_BUILD=0 to build first)"
  anchor test --skip-local-validator --skip-build "$@"
else
  anchor build
  anchor test --skip-local-validator --skip-build "$@"
fi
