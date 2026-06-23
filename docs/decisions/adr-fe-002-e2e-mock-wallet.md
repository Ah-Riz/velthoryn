# ADR-FE-002: E2E Mock Wallet via localStorage Flag

**Status:** Accepted

## Context

Playwright E2E tests require wallet interaction -- connecting a wallet and signing transactions -- without a real browser extension. Injecting `window.solana` via Playwright's `addInitScript` is fragile: it must be re-injected on every navigation, cannot intercept all wallet-adapter calls, and behaves differently across Chromium, Firefox, and WebKit.

## Decision

Two-layer mock mechanism:

1. `NEXT_PUBLIC_E2E_MOCK_WALLET=1` environment variable enables a mock Solana wallet adapter globally. The mock auto-approves all connection and signing requests without opening any extension UI.
2. `localStorage` flag `velthoryn:e2e-mock-send-tx = "1"` activates mock transaction mode. Mock transactions return a hard-coded fake signature immediately. All `confirmTransaction()` call sites check this flag and skip the RPC confirmation step when set.

## Consequences

**Positive:**
- CI pipelines run without any installed wallet browser extension.
- E2E tests cover UI state transitions (button enable/disable, toast messages, loading spinners) reliably across Chromium.

**Negative:**
- The mock bypasses real Solana RPC transaction submission -- intentional. Transaction correctness is covered by the bankrun integration suite.
- `NEXT_PUBLIC_E2E_MOCK_WALLET` must never be set in production builds. Deployment CI fails if this variable is set in production env config.

## Alternatives Considered

- **`addInitScript` injection:** Fragile across navigations and browser engines. Must re-inject on every page load. Does not intercept all wallet-adapter internal calls.
- **Real devnet wallet in CI:** Requires funded keypairs in CI secrets, introduces network flakiness, and slows test execution. Used only for the separate signing test suite.
- **Playwright browser extension loading:** Chromium supports loading extensions but this requires maintaining a test wallet extension build and does not work in headless mode.
