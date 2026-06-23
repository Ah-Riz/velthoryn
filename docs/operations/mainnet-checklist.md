# Mainnet Checklist

Deployment checklist for the Velthoryn vesting program to Solana mainnet.

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

---

## 1. Pre-Deployment

### Program Verification

- [ ] Build is reproducible: `anchor build` on clean checkout produces byte-identical `.so`
- [ ] `solana program verify` confirms on-chain binary matches local build
- [ ] IDL in `apps/web/src/lib/anchor/idl.json` matches build output `target/idl/vesting.json`
- [ ] No `todo!()`, `unimplemented!()`, or `unwrap()` in production code paths
- [ ] `cargo clippy --workspace -- -D warnings` passes (Anchor-required suppressions only)
- [ ] Program keypair matches `declare_id!`: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

### Test Coverage

- [ ] 127+ TypeScript integration tests pass (`anchor test`)
- [ ] 72+ Mollusk instruction tests pass (`cargo test`)
- [ ] 18 proptest properties pass (math/merkle + math/schedule)
- [ ] 9/9 timeline API tests pass
- [ ] All 4 core features validated (F1-F4, 27/27 checks)
- [ ] 14/14 acceptance criteria sub-items pass

### CU Budget

- [ ] All handlers have documented CU budgets in `docs/CU_BUDGET.md`
- [ ] Client SDK uses `setComputeUnitLimit` with recommended values
- [ ] No handler exceeds Solana 1.4M CU limit

### Rent and Account Sizing

- [ ] VestingTree account: 323 bytes -> ~0.00224 SOL rent
- [ ] ClaimRecord account: 113 bytes -> ~0.00078 SOL rent
- [ ] All PDA accounts rent-exempt at creation
- [ ] Rent costs documented for 10,000-leaf campaign

---

## 2. Security

### Authority Management

- [ ] Upgrade authority transferred to Squads v4 multisig (2-of-3) -- see [Multisig Setup](./multisig-setup.md)
- [ ] `cancel_authority` set to multisig for new campaigns
- [ ] `pause_authority` set to multisig for new campaigns
- [ ] All authority transfers verified on Solana Explorer
- [ ] Multisig member keypairs stored on hardware wallets

### Audit Readiness

- [ ] Internal audit complete -- see [Audit Report](../security/audit-report.md)
- [ ] All P0 findings remediated (VEL-001, VEL-009, VEL-010)
- [ ] Sealevel-attacks analysis complete (11/11 categories)
- [ ] Security review: threat model up to date -- see [Threat Model](../security/threat-model.md)
- [ ] External audit engaged (Halborn / OtterSec / Sec3) -- timeline: 2-4 weeks
- [ ] External audit findings remediated before mainnet deploy

### Access Control

- [ ] `ADMIN_API_KEY` rotated from dev/test value
- [ ] `CRON_SECRET` set to strong random value
- [ ] `.env` files not committed to git
- [ ] Supabase RLS policies tested with non-admin user
- [ ] Rate limiting active on all public endpoints (Upstash Redis)

---

## 3. Infrastructure

### Environment Variables (Vercel)

- [ ] `DATABASE_URL` -- production Postgres connection
- [ ] `NEXT_PUBLIC_RPC_ENDPOINT` -- mainnet RPC (Helius/QuickNode)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` -- production Supabase
- [ ] `ADMIN_API_KEY` -- production admin key (rotated)
- [ ] `CRON_SECRET` -- production cron secret
- [ ] `PINATA_JWT` / `PINATA_GATEWAY_URL` -- IPFS pinning (if used)
- [ ] `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` -- rate limiting
- [ ] `ALLOWED_ORIGIN` -- production domain only
- [ ] `NEXT_PUBLIC_SENTRY_DSN` -- error monitoring

### Monitoring

- [ ] Sentry DSN configured in Vercel env vars
- [ ] Test error verified in Sentry dashboard
- [ ] Health check endpoint (`GET /api/health`) monitoring DB + RPC
- [ ] Vercel analytics enabled (`NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS`)

### CI/CD

- [ ] GitHub Actions CI green (`ci.yml`, `lint.yml`, `web-ci.yml`)
- [ ] `cargo audit` -- zero vulnerabilities
- [ ] No deployment workflow for mainnet (manual deploy only)

---

## 4. Deployment Procedure

### Step 1: Final Devnet Validation

- [ ] Deploy to devnet with production keypair
- [ ] Run full integration test suite against devnet
- [ ] Verify all 4 core features end-to-end
- [ ] Check program data account state on explorer

### Step 2: Mainnet Deploy

- [ ] Build on clean checkout at pinned commit
- [ ] Verify `.so` hash matches devnet deployment
- [ ] Transfer SOL to deployer wallet for rent + fees
- [ ] `solana program deploy target/deploy/vesting.so --program-id <keypair> --url mainnet-beta`
- [ ] Verify deployment: `solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu --url mainnet-beta`

### Step 3: Post-Deploy Verification

- [ ] IDL matches on-chain program
- [ ] Upgrade authority confirmed as multisig
- [ ] Test transaction executes successfully (small amount)
- [ ] Sentry receives error events from production
- [ ] Health check endpoint returns 200

### Step 4: Frontend Deploy

- [ ] Vercel production deployment
- [ ] Database schema up to date: `cd apps/web && pnpm db:migrate` against production `DATABASE_URL`

{% hint style="warning" %}
Use `db:migrate` (numbered migration files) for production, never `db:push`.
{% endhint %}

- [ ] All env vars set in Vercel dashboard
- [ ] CORS `ALLOWED_ORIGIN` matches production domain
- [ ] CSP headers include mainnet RPC endpoint
- [ ] End-to-end smoke test: create campaign -> claim -> verify

---

## 5. Rollback Plan

- [ ] Devnet program remains deployed for fallback testing
- [ ] Previous program buffer available: `solana program show --buffer`
- [ ] Multisig can propose rollback transaction
- [ ] Database migrations are backward-compatible (no destructive changes)
- [ ] Vercel instant rollback available for frontend

---

## Sign-Off

| Role | Name | Date |
|---|---|---|
| Developer | | |
| Security Reviewer | | |
| Operations | | |
