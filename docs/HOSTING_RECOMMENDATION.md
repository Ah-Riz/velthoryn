# Backend Hosting Platform Assessment — Velthoryn

> **Date**: May 2026
> **Status**: Recommendation — Pending Approval
> **Author**: Engineering Assessment

---

## Executive Summary

Following a comprehensive evaluation of five leading cloud hosting platforms, we recommend **Railway** as the primary hosting solution for the Velthoryn backend, with **Fly.io** as a cost-optimized alternative. Both platforms deliver full Node.js runtime compatibility, seamless Supabase PostgreSQL integration, and zero-friction deployment of our Solana-integrated Next.js API layer — at a combined monthly cost of **$5–10 USD**.

The assessment eliminates Vercel (Active CPU constraints), Render (cost inefficiency), and Cloudflare Workers (runtime incompatibility with `@coral-xyz/anchor`) from consideration based on technical and economic criteria detailed below.

---

## 1. Current Architecture Profile

| Component | Technology | Version |
|---|---|---|
| Application Framework | Next.js (App Router) | 15.x |
| Blockchain SDK | @solana/web3.js | 1.98.x |
| Smart Contract Client | @coral-xyz/anchor | 0.32.x |
| ORM Layer | Drizzle ORM | 0.39.x |
| Database Driver | postgres (node-postgres) | 3.4.x |
| Database | Supabase (Managed PostgreSQL) | — |
| Frontend State | TanStack React Query + Zustand | 5.x / 5.x |

### Key Hosting Requirements

- **Standard Node.js runtime** — `@coral-xyz/anchor` and `@solana/web3.js` v1.x depend on Node.js APIs (`Buffer`, `crypto`, `net`) not available in Edge/V8 isolate runtimes
- **Persistent TCP connections** — Drizzle ORM benefits from long-lived database connections; serverless connection pooling introduces latency overhead
- **No execution time caps** — Merkle tree generation and Solana RPC batching may exceed typical serverless function timeouts (60s)
- **Supabase co-location** — Low-latency database connectivity for API route responsiveness

---

## 2. Platform Evaluation Matrix

### Scoring Criteria (1–5 scale, 5 = best)

| Criterion | Weight | Vercel | Railway | Fly.io | Render | CF Workers |
|---|---|---|---|---|---|---|
| Solana/Anchor Compatibility | Critical | 3 | 5 | 5 | 5 | 1 |
| Supabase Connectivity | High | 3 | 5 | 5 | 4 | 2 |
| Deployment Simplicity | Medium | 5 | 4 | 3 | 4 | 2 |
| Cost Efficiency | High | 3 | 4 | 5 | 2 | 3 |
| Runtime Flexibility | High | 2 | 5 | 5 | 5 | 1 |
| Execution Time Limits | Medium | 2 | 5 | 5 | 4 | 2 |
| **Weighted Score** | — | **2.9** | **4.6** | **4.5** | **3.8** | **1.6** |

---

## 3. Detailed Platform Analysis

### 3.1 Railway — Recommended Primary

**Positioning**: Container-as-a-Service with developer-first experience. Ideal for teams that want Docker flexibility without Kubernetes complexity.

**Technical Fit**:

- Runs standard Node.js in Docker containers — all Solana libraries (`@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`) work without modification
- Long-lived containers enable session-mode PostgreSQL connections to Supabase (port 5432), eliminating the need for connection pooler workarounds
- No function timeout — API routes and background processes run indefinitely
- Nixpacks auto-detects Next.js; a Dockerfile can be provided for custom builds

**Commercial Terms** (as of May 2026):

| Item | Cost |
|---|---|
| Hobby Plan (base) | $5/month |
| Included usage credit | $5/month |
| RAM | $10/GB/month |
| vCPU | $20/vCPU/month |
| **Estimated monthly total** (512MB / 0.5 vCPU) | **~$10/month** |

**Deployment Workflow**: GitHub repo → Railway auto-build → `next start` in container → live. Environment variables managed via Railway dashboard or CLI.

**Risk Profile**: Low. Railway has been operationally stable since 2022. The main consideration is cold starts after ~24h inactivity on Hobby tier (mitigated by Pro tier's always-on option at $20/month).

---

### 3.2 Fly.io — Recommended Alternative

**Positioning**: Lightweight VM platform optimized for cost-sensitive deployments with global edge distribution.

**Technical Fit**: Identical to Railway — full Linux VMs with standard Node.js. Zero Solana compatibility concerns.

**Commercial Terms** (as of May 2026):

| Item | Cost |
|---|---|
| Shared-cpu-1x / 256MB | ~$2.02/month |
| Shared-cpu-1x / 512MB | ~$3.32/month |
| Shared-cpu-1x / 1GB | ~$5.85/month |
| Egress (NA/EU) | $0.02/GB |
| **Estimated monthly total** (512MB, low traffic) | **~$3–5/month** |

**Trade-off**: Requires `fly.toml` configuration and CLI-driven deployment. No native GitHub auto-deploy (requires GitHub Actions integration). Steeper learning curve but lower operational cost.

---

### 3.3 Vercel — Viable for Development Only

**Strengths**: First-class Next.js support, instant deployments, best-in-class developer experience, free Hobby tier.

**Constraints for Production Use**:

- **Active CPU limit**: 4 hours/month on Hobby tier. A blockchain indexer that polls RPC endpoints will consume this budget quickly.
- **Connection pooling required**: Serverless functions must use Supavisor transaction mode (port 6543) with `prepare: false` in Drizzle config — adds latency and configuration complexity.
- **Pro tier cost**: $20/month per seat + usage-based compute. Not cost-effective for a small project.
- **Edge Runtime risk**: While Node.js runtime functions support anchor/web3.js, any accidental Edge Runtime usage will break Solana libraries.

**Recommendation**: Use Vercel for development previews and staging. Not recommended as the sole production host.

---

### 3.4 Render — Not Recommended

**Analysis**: Render is a competent platform with native Next.js support and reliable infrastructure. However, at production-grade specs (Standard plan: $25/month), it offers no distinguishing advantage over Railway ($10/month) for this use case. The free tier spins down after 15 minutes of inactivity, making it unsuitable for continuous operation.

**Verdict**: Eliminated on cost-to-value ratio.

---

### 3.5 Cloudflare Workers — Not Compatible

**Analysis**: Cloudflare Workers uses V8 isolates (the same engine as Chrome), not Node.js. This is a fundamental incompatibility:

- `@coral-xyz/anchor` relies on Node.js `crypto`, `Buffer`, and `net` modules — all unavailable in V8 isolates
- `@solana/web3.js` v1.x fails for the same reasons
- The `@cloudflare/next-on-pages` adapter requires significant migration effort
- 10MB bundle limit and 128MB memory cap constrain Merkle tree operations
- 1-second startup limit impacts Solana RPC connection initialization

**Verdict**: Eliminated on runtime incompatibility. Would require a full rewrite of the Solana integration layer.

---

## 4. Supabase Connection Strategy

| Platform | Connection Mode | Port | Drizzle Config |
|---|---|---|---|
| **Railway** | Session (persistent) | 5432 | Standard (`postgres://...`) |
| **Fly.io** | Session (persistent) | 5432 | Standard (`postgres://...`) |
| Vercel (dev only) | Transaction (Supavisor) | 6543 | `prepare: false` required |

On Railway/Fly.io, long-lived containers maintain persistent PostgreSQL connections. Drizzle's built-in connection pool handles multiplexing. No external pooler configuration needed.

---

## 5. Implementation Roadmap

### Phase 1: Infrastructure Setup (1–2 days)

1. **Dockerfile** — Create a minimal Dockerfile in `apps/web/` for `next start`
2. **Railway project** — Provision project, connect GitHub repository
3. **Environment variables** — Configure `DATABASE_URL`, Solana RPC endpoints, `NEXT_PUBLIC_*` client variables
4. **Region selection** — Choose region closest to Supabase instance for minimal DB latency

### Phase 2: Deployment & Validation (1 day)

5. **Deploy** — Trigger initial build via `railway up` or GitHub push
6. **Smoke tests** — Verify API endpoints (`/api/campaigns`, `/api/campaigns/[treeAddress]/proof`)
7. **Solana connectivity** — Confirm anchor client connects to Solana RPC, Merkle proof generation works
8. **Database queries** — Validate Drizzle ORM queries against Supabase PostgreSQL

### Phase 3: Production Readiness (1 day)

9. **Custom domain** — Configure DNS and SSL
10. **Monitoring** — Set up health check endpoint, configure Railway alerts
11. **CI/CD pipeline** — Auto-deploy on merge to `main` branch

---

## 6. Cost Projection

| Scenario | Monthly Cost (Railway) | Monthly Cost (Fly.io) |
|---|---|---|
| Development / Low traffic | $5–7 | $2–4 |
| Production / Moderate traffic | $10–15 | $5–8 |
| Production / High traffic | $15–25 | $8–15 |

*Assumes Supabase is billed separately under its own plan.*

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cold starts on Hobby tier | Medium | Low | Upgrade to Pro ($20/mo) for always-on, or add health-check pinger |
| Railway pricing changes | Low | Medium | Maintain Fly.io config as fallback; Dockerfile is portable |
| Supabase connection limits | Low | Medium | Monitor connection count; add Drizzle pool limits if needed |
| Solana RPC rate limiting | Medium | Medium | Use dedicated RPC provider (Helius, QuickNode) instead of public endpoints |

---

## 8. Strategic Recommendation

**Deploy to Railway** as the primary production platform. The combination of full Node.js compatibility, persistent Supabase connections, simple Docker-based deployment, and transparent pricing at $5–10/month makes it the optimal choice for Velthoryn's current stage.

**Maintain a Fly.io configuration** as a cost-optimized alternative. The same Dockerfile deploys to both platforms, ensuring vendor portability without additional engineering investment.

**Use Vercel** for development previews and branch deployments only — its free tier provides excellent DX for the development workflow.

---

## Sources

- [Vercel Pricing](https://vercel.com/docs/pricing)
- [Railway Pricing](https://docs.railway.com/reference/pricing)
- [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- [Render Pricing](https://render.com/pricing)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Solana web3.js Edge Runtime Fix (PR #3137)](https://github.com/solana-foundation/solana-web3.js/pull/3137)
- [Supabase Connection Pooling Docs](https://supabase.com/docs/guides/database/connecting-to-postgres)

---

## Verification Checklist

- [ ] Dockerfile builds successfully for `apps/web/`
- [ ] Railway deployment completes without errors
- [ ] `GET /api/campaigns` returns data from Supabase
- [ ] Solana anchor client connects and reads on-chain data
- [ ] Merkle proof generation works server-side
- [ ] No cold-start issues under normal traffic patterns
- [ ] GitHub push to `main` triggers auto-deployment
