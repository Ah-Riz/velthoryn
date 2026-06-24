# ADR-FE-005: Server-Side Transaction Building

**Status:** Accepted

## Context

The Velthoryn frontend is a Next.js 15 App Router app. Route Handlers and Server Actions run in a Node.js runtime; React components with `"use client"` run in the browser.

Creator operations (cancel, withdraw unvested, milestone release, instant refund) require building a Solana `Transaction` containing the correct Anchor instruction and account addresses. Two approaches were considered:

**Option A -- Build the transaction client-side.** The component imports `@coral-xyz/anchor`, the IDL, and `@solana/web3.js`. The wallet adapter provides the provider; the component builds and sends the tx inline.

Problems:
1. `@coral-xyz/anchor` + `@solana/web3.js` + the typed IDL add ~200 KB to the client bundle.
2. The Anchor `AnchorProvider` constructor requires a wallet object with `publicKey` and `signTransaction`. In a Server Action or Route Handler there is no wallet -- shared code paths that touch these imports risk pulling `window.solana` references into the server runtime.
3. Transaction-building logic is harder to unit-test when tangled with wallet adapter state.

**Option B -- Build the transaction server-side; sign and send client-side.** A dedicated server-only module (`tx-builder.ts`) builds the unsigned serialized transaction with a read-only provider. It returns a `PreparedTransaction` (base58-encoded serialized tx + metadata). The client receives this, attaches its real wallet signature, and sends it.

## Decision

**Option B.** All unsigned transaction building lives in `src/lib/api/tx-builder.ts`, which has no `"use client"` directive. It is imported only from Route Handlers and Server Actions.

`useVestingProgram()` and all hooks in `src/hooks/` are `"use client"` modules. The `tx-builder.ts` uses its own internal read-only `AnchorProvider` (ephemeral `publicKey: PublicKey.default`, throws on any sign attempt) purely to call `program.methods.<instruction>(...).instruction()` and serialize the result.

## Consequences

**Positive:**
- The Anchor IDL and `@coral-xyz/anchor` are loaded only on the server -- the client bundle does not include them.
- Wallet globals (`window.solana`, `window.phantom`) cannot accidentally leak into the server build.
- Transaction building is fully unit-testable without a wallet adapter: mock the RPC, call the builder function, assert on `PreparedTransaction.accounts`.
- The split is self-documenting: if a developer sees `import ... from "@/lib/api/tx-builder"`, they know it is server-side only.

**Negative:**
- Every creator action requires an HTTP round-trip to the Route Handler (or Server Action call) before the wallet signs. This adds ~100-300ms of latency compared to fully client-side building.
- The pattern is unfamiliar to Solana developers accustomed to building txs entirely in the browser. Enforced at runtime (Next.js build fails with a module-boundary error) but the error message is not always obvious.

## Alternatives Considered

- **Client-side building (Option A):** Simpler mental model for Solana developers but bloats the client bundle and tangles wallet state with transaction construction.
- **Shared isomorphic module:** A single module importable by both client and server. Rejected because Anchor's provider model makes true isomorphism impractical without significant abstraction overhead.
- **Edge runtime (Vercel Edge Functions):** Would reduce latency but Edge runtime does not support all Node.js APIs needed by `@coral-xyz/anchor`.
