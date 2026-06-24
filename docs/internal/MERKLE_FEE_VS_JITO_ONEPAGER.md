# Merkle Fee Compression — One-Pager (for Management)

> **Bottom line:** Merkle makes a distribution's **upfront cost and on-chain state O(1) instead of O(N)** — **~800× cheaper at 1,000 recipients, ~800,000× at 1M** (measured). Against Jito it's **not a cost race**: Jito's distributor is cost-comparable (we win on features); Jito's MEV product is a different category that *adds* fees.
>
> *All figures empirically measured on a real Solana validator (localnet + devnet). Reproduce: `pnpm test:compression`. Full report: `docs/internal/MERKLE_FEE_VS_JITO_REPORT.md`.*

---

### What Merkle compresses ✅
- **Distributor upfront cost:** flat **~0.0031 SOL (~$0.47)** regardless of recipient count — vs naive **N × ~0.0025 SOL**.
- **On-chain state:** **1 account** (the 32-byte root) instead of **N accounts**.
- **Distributor capital:** fund a single vault; no pre-funding N recipient accounts.

### What it does NOT compress ❌ (be honest)
- **Total transactions:** still **N** (one claim per recipient — cost shifts to the claimant).
- **Per-claim fee:** unchanged (~0.000005 SOL base fee + a lazy, recoverable ~0.0025 SOL claim record paid by the claimant).
- **End-to-end total ≈ naive (~1×).** The win is **who-pays-and-when**, not total lamports.

---

### Merkle vs Jito — two different things, untangled

| | Jito **distributor** | Jito **MEV product** | **Velthoryn (us)** |
|---|---|---|---|
| What it is | Merkle airdrop primitive | Bundles + tips + ShredStream | Merkle **vesting** protocol |
| Cost vs us | **Comparable** (~$0.20 vs ~$0.42/10K) | **Adds** tips (0.01–0.1 SOL typical) | O(1) distributor cost |
| Verdict | We win on **features** | **Category error** — orthogonal, combinable | — |

We mirror Jito's distributor hashing; we **add** milestone vesting, per-recipient clawback, cancel+grace, pause, UI, and DeFi composability. We do **not** compete with Jito's MEV product — you can *combine* them (route claims through a Jito bundle for MEV protection), but that costs more, not less.

---

### Killer numbers (measured)

| Metric | Value |
|---|---|
| Our distributor setup (O(1)) | **~0.0031 SOL ≈ $0.47** (flat, any N) |
| Compression vs naive — 1K recipients | **800×** ($0.47 vs ~$2.5 → naive) |
| Compression vs naive — 1M recipients | **~800,000×** ($0.47 vs ~$377K) |
| Naive baseline at 10K | ~$3,774 — **matches Streamflow's ~$3,720/10K** ✅ |
| Real per-claim compute units | **~18,000 CU** (first-ever real measurement) |

---

### Say this / Don't say this

| ✅ Say this | ❌ Don't say this |
|---|---|
| "O(1) distributor cost vs competitors' O(N) — ~8,000× cheaper than Streamflow/Zebec at 10K." | "247× cheaper than Jito" *(compares our fee to a Jito MEV tip — misleading)* |
| "Comparable cost to Jito's distributor; we add vesting, clawback, pause, UI." | "Cheaper than Jito's MEV/bundles" *(Jito tips add cost; different category)* |
| "Distributor commits with ~$0.47 instead of locking N × $0.38 upfront." | "Merkle makes every transaction ~800× cheaper" *(per-claim fee is unchanged)* |
| "End-to-end total is comparable; the win is distributor capital + lazy, claimant-paid claims." | "Total system cost drops 800×" *(only distributor upfront cost does)* |

---

### Where it wins hardest (lead with these)
**Large-N airdrops (10K–1M)** and **token vesting** — where the O(1) setup and per-leaf schedules + clawback matter most, and Jito's bare distributor is insufficient.

---
*Measured 2026-06-24 · `tests/merkle-fee-compression.spec.ts` · `tests/results/merkle-compression-results.json` · USD at $150/SOL · Full report: `MERKLE_FEE_VS_JITO_REPORT.md`*
