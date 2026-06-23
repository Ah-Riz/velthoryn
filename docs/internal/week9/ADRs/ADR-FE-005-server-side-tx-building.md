# ADR-FE-005: Server-Side Transaction Building (tx-builder.ts)

**Status:** Active
**Date:** 2026-06-19
**Owner:** Geral (Frontend)

## Context

The Velthoryn frontend is a **Next.js 15 App Router** app. Route Handlers and Server
Actions run in a Node.js runtime; React components with `"use client"` run in the browser.

Creator operations (cancel, withdraw unvested, milestone release, instant refund) require
building a Solana `Transaction` containing the correct Anchor instruction and account
addresses. Two approaches were considered:

**Option A — Build the transaction client-side.**
The component imports `@coral-xyz/anchor`, the IDL, and `@solana/web3.js`. The wallet
adapter provides the provider; the component builds and sends the tx inline.

*Problems:*
1. `@coral-xyz/anchor` + `@solana/web3.js` + the typed IDL add ~200 KB to the client
   bundle (even with tree-shaking) because they are imported in client components.
2. The Anchor `AnchorProvider` constructor requires a wallet object with `publicKey` and
   `signTransaction`. In a Server Action or Route Handler there is no wallet — any shared
   code path that touches these imports risks pulling `window.solana` references into the
   server runtime, causing hard-to-diagnose errors at build or runtime.
3. Logic that builds unsigned transactions is harder to unit-test when it is tangled
   with wallet adapter state (requires a mocked wallet + connection in every test).

**Option B — Build the transaction server-side; sign and send client-side.**
A dedicated server-only module (`tx-builder.ts`) builds the unsigned serialized
transaction with a read-only provider (`publicKey: PublicKey.default`). It returns a
`PreparedTransaction` (base58-encoded serialized tx + metadata). The client component
receives this, attaches its real wallet signature via `sendTransaction`, and sends it.

## Decision

**Option B.** All unsigned transaction building lives in `src/lib/api/tx-builder.ts`,
which has **no `"use client"` directive**. It is imported only from Route Handlers
(`/api/**`) and Server Actions.

`useVestingProgram()` and all hooks in `src/hooks/` are `"use client"` modules. The
`derivePda` / `getProvider` / `getProgram` utilities in `src/lib/anchor/client.ts` are
also client-safe only (they reference wallet adapter context).

The `tx-builder.ts` uses its own internal read-only `AnchorProvider` (ephemeral
`publicKey: PublicKey.default`, throws on any sign attempt) purely to call
`program.methods.<instruction>(...).instruction()` and serialize the result.

## Consequences

**Positive**
- The Anchor IDL and `@coral-xyz/anchor` are loaded only on the server — the client
  bundle does not include them, keeping the initial page load smaller.
- Wallet globals (`window.solana`, `window.phantom`) cannot accidentally leak into the
  server build — `tx-builder.ts` imports no wallet-adapter code.
- Transaction building is fully unit-testable without a wallet adapter: mock the RPC,
  call the builder function directly, assert on `PreparedTransaction.accounts`.
- The split is self-documenting: if a developer sees `import ... from "@/lib/api/tx-builder"`,
  they know it is a server-side dependency and must not import it in a client component.

**Negative / trade-offs**
- Every creator action requires an HTTP round-trip to the Route Handler (or a Server
  Action call) before the wallet signs. This adds ~100–300 ms of latency compared to
  fully client-side building.
- The pattern is unfamiliar to Solana developers accustomed to building txs entirely in
  the browser. New developers must understand not to import `tx-builder.ts` in client
  components — this is enforced at runtime (Next.js build fails with a module-boundary
  error) but the error message is not always obvious.

## References

- `apps/web/src/lib/api/tx-builder.ts` — the server-only builder module
- `apps/web/src/hooks/useVestingProgram.ts` — client-only Anchor program hook
- `apps/web/next.config.ts` — server component boundary enforcement
- [FE Hooks Reference](../FE_HOOKS_REFERENCE.md) §tx-builder.ts Reference — usage examples
- [ADR-FE-002](ADR-FE-002-e2e-mock-wallet-localStorage.md) — related: E2E mock wallet bypass
