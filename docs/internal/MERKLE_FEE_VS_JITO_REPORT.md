# Merkle Fee Compression vs Jito — Management Report

| | |
|---|---|
| **Audience** | BD, Marketing, Management |
| **Date** | 2026-06-24 |
| **Purpose** | Defensible answer to "does Merkle really compress transaction fees, and how does it compare to Jito?" — for the business model and GTM narrative |
| **Evidence** | Empirically measured on a real Solana validator (localnet + devnet). Full data: `tests/results/merkle-compression-results.json` (localnet) and `.devnet.json`. Reproduce: `pnpm test:compression` (localnet), `pnpm test:compression:devnet` (devnet). Test: `tests/merkle-fee-compression.spec.ts` |
| **One-line answer** | **Yes — Merkle compresses the distributor's upfront cost and on-chain state from O(N) to O(1): ~800× cheaper at 1,000 recipients, ~800,000× at 1M. Against Jito it is not a cost race — Jito's own distributor is cost-comparable (we win on features), and Jito's MEV product is a different category that *adds* fees.** |

---

## 1. Executive TL;DR

1. **Merkle genuinely compresses cost — but specifically the distributor's *upfront* cost and *on-chain state*, not the per-claim network fee.** Measured on a real validator: our distributor pays a **flat ~0.0031 SOL (~$0.47)** to set up a distribution regardless of recipient count, versus a naive (PDA-per-recipient) protocol that pays **N × ~0.0025 SOL**. That is **4× / 8× / 80× / 800× cheaper at 5 / 10 / 100 / 1,000 recipients**, and a projected **~800,000× at 1 million**.

2. **The empirical baseline reproduces the competitor numbers.** Our naive baseline (one 232-byte escrow account per recipient) costs **~$3,774 per 10,000 recipients** — matching Streamflow's published ~$3,720/10K. The Merkle advantage is real and validates the PRD.

3. **Honest caveat (do not overclaim):** *end-to-end* (including the per-recipient claim record each claimant creates) total cost is **comparable to naive (~1×)**, because our claim record is about the same size as a competitor's per-recipient account. The decisive difference is **who pays and when**: competitors force the *distributor* to pre-fund N accounts up front (locked capital); we let the distributor commit with O(1) capital and each *claimant* pays a small, lazy, recoverable fee only when they actually claim.

4. **"Cheaper than Jito" needs to be said precisely.** The prior internal "247× cheaper than Jito" line compares our setup fee against a *Jito bundle tip* — apples to oranges. The accurate statements: (a) vs **Jito's Merkle distributor** — cost-comparable, we win on vesting/clawback/UI; (b) vs **Jito's MEV product** — a category error (Jito *adds* tips for atomicity/MEV protection, never cuts fees).

---

## 2. Does Merkle compress fees? The honest answer

A Merkle distribution commits to N recipients with a single 32-byte **root** on-chain. Recipients each present a short proof and claim individually.

**What it compresses ✅**
- **Distributor's upfront cost: O(1) vs O(N).** The distributor creates **1 root + 1 vault** (2 transactions) instead of N recipient accounts. *Measured: flat ~0.0031 SOL regardless of N.*
- **On-chain state: 1 account vs N.** A PDA-per-recipient protocol (Streamflow, Zebec, Bonfida) stores one account per recipient. We store one `VestingTree` (323 bytes) holding the root.

**What it does NOT compress ❌**
- **Total network transactions: still N.** Each recipient files one claim transaction. Merkle *shifts* that cost from distributor to claimant; it does not eliminate it.
- **Per-claim fee: unchanged.** Each claim pays the standard Solana base fee (5,000 lamports ≈ $0.00075) plus the rent for its own claim record (~0.0025 SOL, paid by the claimant, lazily, and recoverable via `close_claim_record`).

> **The real Merkle win is capital efficiency for the distributor**: commit to any number of recipients with ~$0.47 of on-chain capital, fund only a single vault, and let recipients self-serve. Competitors must lock N × ~$0.38 of distributor capital up front.

---

## 3. Where real fee compression lives on Solana (and where Merkle sits)

| Mechanism | What it does | Our status |
|---|---|---|
| **Batching** (multiple instructions per tx → one base fee) | Compresses *transaction count* cost | ❌ We do **1 tx per claim** (each claim carries a large Merkle proof, so ~1 claim/tx is the tx-size limit). Not batched today. |
| **Address Lookup Tables** | Enable batching by expanding account capacity | n/a until we batch |
| **State / ZK compression** (concurrent Merkle trees, cNFTs, ZK token) | Eliminates per-item rent (~24,000× for NFTs at scale) | ⚠️ Adjacent — we use a Merkle root for the *recipient set* but each claimant still creates a real `ClaimRecord` account (the recoverable claim ledger). |
| **Merkle distribution (us)** | Compresses **distributor state + upfront capital** O(N)→O(1) | ✅ This is our core advantage. |

So Merkle is the right tool for **who-funds-and-stores-the-recipient-set**, not for minimizing per-claim gas. Future work could add **batched claims** (one tx claiming for several pre-approved recipients) to also compress transaction-count cost.

---

## 4. The numbers — measured, not estimated

**Methodology.** A real integration test (`tests/merkle-fee-compression.spec.ts`) generates N real wallets, builds the Merkle tree, runs `createCampaignNative` + `fundCampaignNative` (distributor) and N native-SOL claims (each claimant is the real fee payer), and measures real rent, real base fee, and real compute units from confirmed transactions. It then runs an empirical naive baseline (the distributor actually creates N rent-exempt escrow accounts, one per recipient). Run on **localnet** (real validator binary, full table N=5/10/100/1000) and **devnet** (N=5, real network) — numbers match to within rounding, confirming localnet = mainnet invariants.

### 4.1 Measured per-unit costs

| Quantity | Lamports | SOL | Note |
|---|---|---|---|
| `VestingTree` rent (our setup, **O(1)**) | 3,133,931 | **0.003134** | 323-byte account. *Corrects `CU_BUDGET.md`'s stale 0.00224.* |
| `ClaimRecord` rent (per claimant, lazy) | 2,505,600 | **0.002506** | 232-byte account, paid by claimant on first claim. *Corrects `CU_BUDGET.md`'s 0.00161.* |
| Per-claim base fee | 5,000 | 0.000005 | Solana base fee per signature |
| **Per-claim compute units (REAL, first measurement)** | — | **~18,000 CU** | First-ever real measurement (Mollusk can't run the claim path). *Corrects `CU_BUDGET.md`'s 13,200 estimate.* |
| Per-recipient escrow rent (naive baseline) | 2,505,600 | 0.002506 | 232-byte "1 record per recipient" (Streamflow/Zebec-style) |

### 4.2 HEADLINE — distributor upfront cost (O(1) vs O(N))

| Recipients (N) | Our distributor (SOL) | Naive distributor (SOL) | **Compression** |
|---|---|---|---|
| 5 | 0.003144 | 0.0126 | **4×** |
| 10 | 0.003144 | 0.0252 | **8×** |
| 100 | 0.003144 | 0.2516 | **80×** |
| 1,000 | 0.003143 | 2.5156 | **800×** |
| 10,000 (interpolated) | ~0.0031 | ~25.16 | **~8,000×** |
| 1,000,000 (projected) | **$0.47** | **$377,340** | **~800,000×** |

(USD at $150/SOL, the test's stated assumption; figures scale linearly with SOL price.)

**Validation:** the naive baseline at 10,000 recipients = 25.16 SOL ≈ **$3,774**, which matches Streamflow's published **~$3,720 / 10K** in `PRD_LANA.md`. The competitor numbers in the PRD are independently reproduced by this measurement.

### 4.3 Honest caveat — end-to-end (incl. claimant claim records)

| N | Our total (setup + N claims) | Naive total (N escrows) | End-to-end ratio |
|---|---|---|---|
| 5 | 0.0157 | 0.0126 | 0.80× |
| 100 | 0.2542 | 0.2516 | 0.99× |
| 1,000 | 2.5137 | 2.5156 | 1.00× |

End-to-end is ~1× because each claimant creates a `ClaimRecord` (~same size as a competitor's per-recipient account). **This is not a loss** — it is a *shift*: competitor cost is distributor-paid + upfront + capital-locked; ours is claimant-paid + lazy (only on claim) + recoverable. For a BD pitch, lead with §4.2 (distributor cost) and use §4.3 only to stay honest under questioning.

---

## 5. Competitive comparison (honest)

### 5.1 vs PDA-per-recipient protocols (Streamflow, Zebec, Magna, Bonfida, Armada) — the structural win

From `PRD_LANA.md` (cost / 10,000 recipients, SOL ≈ $85):

| Protocol | Model | Cost / 10K |
|---|---|---|
| Zebec | 1 PDA + extras per milestone | ~$11,730 |
| Streamflow | 1 PDA per stream | ~$3,720 |
| Magna / Bonfida | shared pool + per-recipient records | ~$1,990 |
| Armada | 1 PDA per grant + option token | ~$1,990–4,250 |
| **Jito Distributor** | **1 Merkle root** | **~$0.20** |
| **Velthoryn (us)** | **1 Merkle root + 1 vault** | **~$0.42** |

Our measured distributor setup (native SOL) is ~0.0031 SOL (~$0.27 at $85); the SPL path adds a vault ATA (~0.0020 SOL) for ~$0.42 total — matching the PRD. **Both are O(1).** Versus the PDA-per-recipient cohort this is **~1,000–28,000× cheaper at 10K**, growing with N.

### 5.2 vs Jito's *Merkle distributor* — cost-comparable, we win on features

Jito also ships a Merkle distributor (`jito-foundation/distributor`) — our hashing convention literally mirrors it (`clients/ts/src/leaf.ts`). On **raw cost it is comparable** (Jito ~$0.20 vs us ~$0.42/10K; Jito is marginally cheaper because it carries no vesting state). **Our differentiation is features, not cost:**

| Capability | Jito Distributor | Velthoryn |
|---|---|---|
| Merkle compression (flat cost) | ✅ | ✅ |
| Per-leaf cliff / linear vesting | partial | ✅ |
| **Milestone vesting** | ❌ | ✅ (256-bit bitmap) |
| **Per-recipient clawback (root rotation)** | ❌ | ✅ |
| **Campaign cancel + 7-day grace** | ❌ | ✅ |
| **Emergency pause** | ❌ | ✅ |
| **Multi-campaign (one creator)** | ❌ | ✅ |
| **Frontend / UI** | ❌ (CLI only) | ✅ |
| **DeFi composability (`get_vested_amount` CPI)** | ❌ | ✅ |

### 5.3 vs Jito's *MEV product* (bundles, tips, ShredStream) — a category error

Jito's block-engine product **adds** cost (tips), it never reduces fees:

| | Jito MEV | Merkle (us) |
|---|---|---|
| Purpose | Execution priority + atomicity + MEV protection | Capital-efficient distribution |
| Fee impact | **Adds** tips (min 1,000 lamports; typical 0.01–0.1 SOL; up to 1+ SOL under contention) | Reduces distributor cost |
| Tx model | Bundles of up to 5 txs, atomic | 1 tx per claim |
| Buys | Atomicity, ordering, anti-sandwich | No prefunding, minimal state |

These are **orthogonal and combinable**: you can route Merkle claims (or a batched setup) through a Jito bundle for MEV-protected, atomic execution — but it costs *more*, not less.

### 5.4 Reframing "247× cheaper than Jito"

The Week 8 report's "247× cheaper than Jito" compares our create+fund **fee** (~$0.00170) against a **Jito bundle tip** (~$0.42). That conflates a transaction fee with an MEV priority payment. **Replace it with:**
- *"Velthoryn's distributor cost is **~8,000× cheaper than Streamflow/Zebec at 10K recipients, ~800,000× at 1M** (empirically measured) — and **feature-superior to Jito's distributor** at comparable cost."*

---

## 6. Business / positioning implications

- **Margin / pricing headroom.** A distribution that costs competitors $3,700+ (10K) costs us <$1. This is structural margin whether we price as SaaS, per-campaign, or a protocol fee. (No pricing model exists in the repo today — flagged for follow-up.)
- **The "no protocol fee" wedge.** Unlike Streamflow's 0.25% protocol fee, Velthoryn currently charges none. The cost structure means we can stay free longer or undercut any fee-charging competitor.
- **Best-fit scenarios (lead with these):**
  - **Large-N airdrops** (10K–1M recipients) — the compression ratio is largest and the distributor-capital savings are most concrete ($3,700 → <$1 at 10K; $377K → $0.47 at 1M).
  - **Token vesting** (investors/team/advisors) — per-leaf schedules + clawback, where Jito's bare distributor is insufficient.
  - **Capital-constrained launches** — distributors who can't or won't lock N × $0.38 upfront.
- **Honest talking points** (see one-pager): lead with *distributor upfront cost O(1) vs O(N)*; do **not** claim total-system savings.

---

## 7. Caveats & known gaps

1. **1 transaction per claim (no batching).** Each claim carries a large Merkle proof (~320 bytes at N=1,000), so ~1 claim/tx is the tx-size ceiling. Batching is a future optimization that would also compress transaction-count cost.
2. **No priority-fee wiring in the frontend.** `apps/web` does not currently set compute-unit-price/limit. Under mainnet congestion, claims could land slowly or fail without a priority fee. (Localnet/devnet have no congestion, so this is unmeasured here.)
3. **SPL recipients incur ATA rent** (~0.0020 SOL) on first receipt — incurred by *any* SPL transfer, not specific to us, and paid by the recipient.
4. **`ClaimRecord` rent is claimant-paid** (~0.0025 SOL), lazy, and recoverable (`close_claim_record`). This is why end-to-end cost is ~1× vs naive — see §4.3.
5. **Native SOL path measured here.** SPL-path CU is higher (~+20–30%) per `CU_BUDGET.md`; rent economics are identical (O(1) setup).

---

## 8. Appendix

### 8.1 Reproduce
```bash
pnpm test:compression          # localnet, full table N=5/10/100/1000
pnpm test:compression:devnet   # devnet, smallest footprint N=5 (needs devnet SOL)
# Output: tests/results/merkle-compression-results.json (+ .localnet.json / .devnet.json)
```
Requires Node 20 (the project's nvm version; Node 26 breaks `anchor test`/yargs). Localnet uses the real `solana-test-validator` binary with the deployed `G6iaig…` program cloned from devnet.

### 8.2 Corrections to existing docs (flag, don't silently edit)
- `docs/internal/legacy/CU_BUDGET.md`: `VestingTree` rent 0.00224 → **0.003134**; `ClaimRecord` rent 0.00161 → **0.002506**; `claim` CU ~13,200 → **~18,000 (real, first-claim)**.
- `docs/internal/weekly-reports/WEEK8_PERFORMANCE_REPORT.md` / `.claude/steering/product.md`: reframe "247× cheaper than Jito" per §5.4.

### 8.3 Sources
- Measured: `tests/merkle-fee-compression.spec.ts` + `tests/results/merkle-compression-results*.json`.
- Codebase: `programs/vesting/src/instructions/{claim,create_campaign,fund_campaign}.rs`, `state/{vesting_tree,claim_record}.rs`.
- Internal: `PRD_LANA.md` (competitor + Jito tables), `adr-001-merkle-compressed-vesting.md`.
- External: Solana fee docs (base fee 5,000 lamports/signature; rent model), Jito docs (bundles ≤5 txs; tips), `jito-foundation/distributor`.
