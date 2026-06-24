# Complete FE Documentation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat dokumentasi teknis yang lengkap untuk seluruh codebase frontend (Weeks 1–9) mencakup code docs, bug log, ADRs, dan semua acceptance criteria dari Week 9 brief.

**Architecture:** Dokumentasi dibagi menjadi 4 lapisan: (1) Dokumen tingkat tinggi untuk developer eksternal (integration guide, instruction reference, ADRs), (2) Referensi kode internal (JSDoc/TSDoc untuk hooks dan lib functions), (3) Bug & fix log per-komponen, (4) Setup & operational guides yang akurat. Semua dokumen baru masuk ke `docs/week9/` atau `docs/` sesuai lingkup.

**Tech Stack:** Next.js 15, React 19, TanStack Query, Anchor/Solana, Playwright, Vitest, shadcn/ui, TypeScript

---

## Global Constraints

- Semua dokumen ditulis dalam Bahasa Inggris (konsisten dengan dokumen Lana)
- Tidak boleh mengarang fakta — semua klaim harus bisa di-trace ke commit atau file yang ada
- Target minimum: 300+ baris per dokumen mayor
- Format markdown, konsisten dengan dokumen yang sudah ada di `docs/`
- Setiap dokumen harus akurat per commit terbaru di `dev_geral`
- Due date: 2026-06-20

---

## Ringkasan Situasi Saat Ini

### Yang sudah ada (dari Geral):
| File | Isi | Status |
|------|-----|--------|
| `docs/PDD_GERAL.md` | Product Design Document (682 baris) | ✅ Ada, tapi mungkin stale |
| `docs/PRD_GERAL.md` | Product Requirements Document | ✅ Ada |
| `docs/TDD_GERAL.md` | Test Design Document (453 baris) | ✅ Ada, tapi mungkin stale |
| `docs/SECURITY_GERAL.md` | Security Design (518 baris) | ✅ Ada |
| `docs/WEEK7_FE_COVERAGE_REPORT.md` | Week 7 coverage report | ✅ Ada, outdated |
| `docs/WEEK7_FE_ISSUE_LOG.md` | Week 7 issues | ✅ Ada |
| `docs/WEEK7_FE_SECURITY_CHECKLIST.md` | Week 7 security checklist | ✅ Ada |
| `docs/FE_INTEGRATION.md` | FE integration guide (1034 baris) | ✅ Ada, updated error 6041 |
| `docs/week9/FE_DOCUMENTATION_REVIEW.md` | FE review + 4 ADRs (343 baris) | ✅ Baru dibuat |
| `docs/week9/FE_TESTING_STATUS.md` | FE test status (354 baris) | ✅ Baru dibuat |

### Yang BELUM ada (gap berdasarkan Week 9 brief + code review):
1. **Code-level JSDoc** — 21 hooks dan ~30 lib functions tidak ada dokumentasi inline
2. **FE Component Reference** — 30+ komponen di `apps/web/src/components/` tidak terdokumentasi
3. **FE Architecture Overview** — tidak ada dokumen yang menjelaskan data flow, state management, dan dependency graph secara komprehensif untuk Week 9
4. **Bug Fix Log (FE)** — bug yang ditemukan di Week 8–9 belum ada dokumen dedicated FE-side
5. **E2E Test Guide** — bagaimana cara menjalankan dan menambah E2E test belum terdokumentasi
6. **Deployment Guide (FE)** — Vercel deploy flow belum terdokumentasi dari sisi FE

---

## File Map (Semua file yang akan dibuat/dimodifikasi)

```
docs/
├── week9/
│   ├── FE_DOCUMENTATION_REVIEW.md   ✅ Sudah ada
│   ├── FE_TESTING_STATUS.md          ✅ Sudah ada
│   ├── FE_ARCHITECTURE.md            📝 Task 1 — baru
│   ├── FE_COMPONENT_REFERENCE.md     📝 Task 2 — baru
│   ├── FE_BUG_LOG.md                 📝 Task 3 — baru
│   └── FE_E2E_GUIDE.md              📝 Task 4 — baru
├── FE_INTEGRATION.md                 ✅ Updated (error 6041)
├── PDD_GERAL.md                      📝 Task 5 — update stale sections
└── TDD_GERAL.md                      📝 Task 5 — update test counts

apps/web/src/
├── hooks/                            📝 Task 6 — tambah JSDoc (21 hooks)
│   ├── useCampaignDetail.ts
│   ├── useVestingProgress.ts
│   ├── useCreateCampaign.ts
│   ├── useCreateStream.ts
│   ├── useUpdateRoot.ts
│   └── ... (16 hooks lainnya)
├── lib/
│   ├── vesting/
│   │   ├── list.ts                   📝 Task 6 — tambah JSDoc
│   │   └── schedule.ts               📝 Task 6 — tambah JSDoc
│   ├── merkle/builder.ts             📝 Task 6 — tambah JSDoc
│   └── anchor/errors.ts             📝 Task 6 — tambah JSDoc (+ error 6041)
```

---

## Task 1: FE Architecture Overview Document

**Deliverable:** `docs/week9/FE_ARCHITECTURE.md` (~250-350 baris)

**Kenapa diperlukan:** Tidak ada dokumen yang menjelaskan secara komprehensif bagaimana FE bekerja dari perspektif developer baru. PDD_GERAL.md sudah ada tapi dibuat di Week 2 sebelum banyak perubahan arsitektur.

**Isi yang harus ada:**
- §1 Tech Stack Overview (Next.js 15 App Router, React 19, TanStack Query v5, shadcn/ui)
- §2 Directory Structure (`apps/web/src/app/`, `hooks/`, `lib/`, `components/`)
- §3 Data Flow Diagram (Wallet → Hook → API → SC → onchain, dan sebaliknya)
- §4 State Management Strategy (TanStack Query caching, staleTime, invalidation patterns)
- §5 Wallet Integration (Solana wallet-adapter, `getProvider()`, mock wallet untuk E2E)
- §6 FE-SC Communication (tx-builder.ts flow: build unsigned tx → sign di client → send)
- §7 Dark Mode & Theming (ThemeProvider, CSS variables, shadcn/ui integration)
- §8 Campaign Lifecycle in FE (8-state CampaignLifecycle enum, rendering rules per state)
- §9 Environment Variables (semua NEXT_PUBLIC_* yang dipakai)

**Files yang dibaca sebagai referensi:**
- `apps/web/src/lib/anchor/client.ts`
- `apps/web/src/lib/api/tx-builder.ts`
- `apps/web/src/lib/vesting/list.ts`
- `apps/web/src/hooks/useCampaignDetail.ts`
- `apps/web/src/app/(app)/campaign/[id]/page.tsx`
- `docs/PDD_GERAL.md` (referensi Week 2 architecture)

- [ ] **Step 1:** Baca semua file referensi di atas
- [ ] **Step 2:** Draft §1-4 (tech stack + directory + data flow + state management)
- [ ] **Step 3:** Draft §5-7 (wallet + SC communication + dark mode)
- [ ] **Step 4:** Draft §8-9 (lifecycle + env vars)
- [ ] **Step 5:** Review konsistensi dengan `docs/week9/FE_DOCUMENTATION_REVIEW.md`
- [ ] **Step 6:** Save file
- [ ] **Step 7:** Commit: `docs(week9): add FE architecture overview`

---

## Task 2: FE Component Reference Document

**Deliverable:** `docs/week9/FE_COMPONENT_REFERENCE.md` (~300-400 baris)

**Kenapa diperlukan:** 30+ komponen di `apps/web/src/components/` tidak terdokumentasi. Developer baru tidak tahu komponen mana yang harus dipakai untuk use case apa.

**Isi yang harus ada:**
Untuk setiap komponen, dokumentasikan:
- Props interface (nama, tipe, required/optional)
- Kapan dipakai (use case)
- Dependencies (hooks yang dipanggil, komponen yang dirender)
- Status (aktif / deprecated / beta)

**Komponen yang harus didokumentasikan:**

*`components/campaign/detail/` (16 komponen):*
- `AllocationEditor.tsx` — edit Merkle root allocation (creator-only)
- `CampaignStatusBanner.tsx` — status banner berdasarkan CampaignLifecycle
- `CampaignTimeline.tsx` — visual timeline cliff/linear/milestone
- `CancelConfirmDialog.tsx` — dialog konfirmasi cancel (instant refund vs grace)
- `ClaimWithProofButton.tsx` — tombol claim untuk beneficiary dengan Merkle proof
- `CloseClaimRecordButton.tsx` — tombol close PDA setelah campaign selesai
- `GracePeriodCountdown.tsx` — countdown timer grace period
- `MilestoneCarouselCard.tsx` — card per milestone (creator/beneficiary view)
- `MilestoneReleasePanel.tsx` — panel release milestone (creator-only)
- `MilestoneStatusBadge.tsx` — badge status per milestone
- `PauseToggleButton.tsx` — toggle pause/unpause (creator-only)
- `RecipientListModal.tsx` — modal daftar penerima dari Merkle tree
- `RootRotationCard.tsx` — card untuk update Merkle root
- `TriggerMilestoneButton.tsx` — tombol release milestone
- `VestingChart.tsx` — Recharts vesting curve visualization
- `WithdrawUnvestedButton.tsx` — tombol withdraw after grace period

*`components/campaign/create/` (15 komponen):*
- `BulkCsvSection.tsx` — upload CSV bulk recipients
- `CommonFields.tsx` — shared form fields (amount, recipient)
- `ScheduleCliff.tsx` — form fields cliff schedule
- `ScheduleLinear.tsx` — form fields linear schedule
- `ScheduleMilestone.tsx` — form fields milestone schedule
- (dan 10 lainnya)

*`components/shell/` (4 komponen):*
- `Sidebar.tsx` — navigasi utama dengan collapsible + amber dot
- `AppHeader.tsx` — header dengan wallet button + theme toggle
- `ThemeToggle.tsx` — dark/light mode toggle
- `Toast.tsx` — notifikasi toast

- [ ] **Step 1:** Baca semua file komponen di `components/campaign/detail/`
- [ ] **Step 2:** Draft tabel referensi untuk detail components (16 entries)
- [ ] **Step 3:** Baca semua file komponen di `components/campaign/create/`
- [ ] **Step 4:** Draft tabel referensi untuk create components
- [ ] **Step 5:** Draft tabel referensi untuk shell components
- [ ] **Step 6:** Tambahkan contoh penggunaan untuk 5 komponen terpenting
- [ ] **Step 7:** Save file
- [ ] **Step 8:** Commit: `docs(week9): add FE component reference`

---

## Task 3: FE Bug Log Document

**Deliverable:** `docs/week9/FE_BUG_LOG.md` (~250-300 baris)

**Kenapa diperlukan:** Bug yang ditemukan dan diperbaiki di Week 8–9 tersebar di commit messages. Tidak ada satu dokumen yang merangkum semua bug FE dengan root cause dan fix yang jelas. Ini penting untuk Week 9 brief (KPI: dokumentasi yang matang).

**Isi yang harus ada:**
Tabel per bug dengan kolom: ID, Severity, Week ditemukan, Area, Deskripsi, Root Cause, Fix, Commit, Status.

**Bug yang harus didokumentasikan (dari commit history + bug_fix.md):**

| ID | Area | Bug | Fix Commit |
|----|------|-----|-----------|
| FE-BUG-01 | Lifecycle | cancelledAt != null alone showed grace for instant-refunded | eb71065, b27e0fd |
| FE-BUG-02 | Allocations | Float precision bug in token amount conversion | 0863484, 22ea93d |
| FE-BUG-03 | Bankrun tests | warpClock duplicate signature (setClock without warpToSlot) | 86eb7e9 |
| FE-BUG-04 | E2E | confirmTransaction hang in mock mode | 3948218 |
| FE-BUG-05 | Vitest | decimalsCache module-level singleton polluting tests | 52531d4 |
| FE-BUG-06 | E2E | helpers.ts collected as test file by Playwright | 2f87a82 |
| FE-BUG-07 | E2E | campaign-level schedule broke all create-form tests | 76cb9d1, 546a135 |
| FE-BUG-08 | Build | __tests__ included in client tsc + missing StreamEntry fields | 30e1f26 |
| FE-BUG-09 | CI | ESLint + Vitest failures on dev_geral | f7ec4aa |
| FE-BUG-10 | E2E | Signing E2E needs localnet (CI incompatible) | 129538c |
| FE-BUG-11 | Errors | errors.ts missing 6041 PerLeafCapExceeded | (gap, not yet fixed) |
| FE-BUG-12 | Campaign detail | Campaign IA split needed (Overview vs Your Position) | e171d5b |
| FE-BUG-13 | Raw amounts | Token amounts showing raw units without decimal conversion | 3ba034d, 6a8a1b3 |
| FE-BUG-14 | Mobile | Campaign tab filters not dropdown on mobile | 3768522 |
| FE-BUG-15 | Milestone | Out-of-order milestone claiming marked wrong leaves | (dari WEEK8_KNOWN_ISSUES #22) |

Untuk setiap bug, sertakan:
- **Root Cause** (1-2 kalimat teknis)
- **Fix** (apa yang diubah)
- **Prevention** (bagaimana mencegah hal serupa di masa depan)

- [ ] **Step 1:** Baca `weekly-report-mancer/week9/bug_fix.md` dan `docs/WEEK8_KNOWN_ISSUES.md`
- [ ] **Step 2:** Baca git log untuk commit fixes (eb71065, 86eb7e9, 3948218, 52531d4, dll.)
- [ ] **Step 3:** Draft tabel bug dengan root cause dari Week 8 bugs (FE-BUG-01 s/d FE-BUG-08)
- [ ] **Step 4:** Draft tabel bug dari Week 9 (FE-BUG-09 s/d FE-BUG-15)
- [ ] **Step 5:** Tambahkan "Prevention" column — pembelajaran dari setiap bug
- [ ] **Step 6:** Tambahkan section "Open Bugs" untuk yang belum fix (FE-BUG-11)
- [ ] **Step 7:** Save file
- [ ] **Step 8:** Commit: `docs(week9): add FE bug log`

---

## Task 4: FE E2E Testing Guide

**Deliverable:** `docs/week9/FE_E2E_GUIDE.md` (~200-250 baris)

**Kenapa diperlukan:** 23 chromium + 10 signing E2E spec files ada tapi tidak ada panduan cara menjalankan, menambah test baru, atau troubleshoot gagalnya test. `docs/week9/FE_TESTING_STATUS.md` sudah ada tapi itu adalah status report, bukan guide.

**Isi yang harus ada:**
- §1 Quick Start (cara run E2E locally dalam 5 menit)
- §2 Test Architecture (chromium mock vs signing, mock wallet setup, helpers.ts)
- §3 Environment Setup (`NEXT_PUBLIC_E2E_MOCK_WALLET`, `DATABASE_URL`, localnet)
- §4 How to Write a New E2E Test (template, naming convention, data-testid pattern)
- §5 Debugging Failing Tests (Playwright trace viewer, screenshot artifacts)
- §6 CI Integration (web-ci.yml jobs, mengapa signing E2E di-disable)
- §7 Known Limitations (localnet dependency, Postgres requirement)

**Files yang dibaca sebagai referensi:**
- `apps/web/playwright.config.ts`
- `apps/web/playwright.signing.config.ts`
- `apps/web/tests/e2e/helpers.ts`
- `apps/web/tests/e2e/campaign-actions.spec.ts` (contoh test yang baik)
- `.github/workflows/web-ci.yml`

- [ ] **Step 1:** Baca playwright.config.ts dan helpers.ts
- [ ] **Step 2:** Baca 2-3 spec files sebagai contoh
- [ ] **Step 3:** Draft §1-3 (quick start + architecture + env setup)
- [ ] **Step 4:** Draft §4 (template test baru dengan contoh lengkap)
- [ ] **Step 5:** Draft §5-7 (debugging + CI + limitations)
- [ ] **Step 6:** Save file
- [ ] **Step 7:** Commit: `docs(week9): add FE E2E testing guide`

---

## Task 5: Update Existing Stale Documents

**Deliverable:** Update `docs/TDD_GERAL.md` dan `docs/PDD_GERAL.md`

**Kenapa diperlukan:** Dokumen ini dibuat di Week 2–4 dan sudah jauh outdated. `TDD_GERAL.md` misalnya masih menyebut 27 test cases, padahal sekarang sudah 572 Vitest unit tests + 33 E2E specs.

**Perubahan di TDD_GERAL.md:**
- Update test count: 572 Vitest unit (bukan 27)
- Tambahkan section E2E testing (Playwright, 23 chromium + 10 signing)
- Update CI matrix (3 pipelines: ci.yml, lint.yml, web-ci.yml)
- Tambahkan Bankrun integration tests (15 spec files)
- Update coverage targets berdasarkan realita saat ini

**Perubahan di PDD_GERAL.md:**
- Update component architecture section (tambahkan shadcn/ui primitives)
- Update state management section (TanStack Query v5 patterns)
- Update dark mode section (ThemeProvider + CSS variables)
- Update campaign lifecycle section (8-state CampaignLifecycle enum)
- Update E2E strategy section

- [ ] **Step 1:** Baca TDD_GERAL.md dan list semua stale sections
- [ ] **Step 2:** Baca PDD_GERAL.md dan list semua stale sections
- [ ] **Step 3:** Update TDD_GERAL.md — test counts, CI matrix, E2E section
- [ ] **Step 4:** Update PDD_GERAL.md — shadcn, dark mode, lifecycle section
- [ ] **Step 5:** Commit: `docs(week9): update TDD and PDD to reflect Week 9 state`

---

## Task 6: Add JSDoc to Critical FE Functions

**Deliverable:** JSDoc/TSDoc pada hooks dan lib functions terpenting

**Kenapa diperlukan:** Week 9 brief KPI adalah "developer asing bisa integrate hanya dari docs". Tanpa JSDoc, developer yang membuka file hooks akan tidak tahu cara pakai, return type, atau side effect dari setiap hook.

**Priority hooks (lakukan semua dalam satu commit):**

**Tier 1 — paling sering dipanggil dari pages:**
- `apps/web/src/hooks/useCampaignDetail.ts` — fetch campaign + PDA data
- `apps/web/src/hooks/useVestingProgress.ts` — fetch vesting progress per beneficiary
- `apps/web/src/hooks/useCreateCampaign.ts` — mutation untuk create campaign
- `apps/web/src/hooks/useCreateStream.ts` — mutation untuk create stream
- `apps/web/src/hooks/useUpdateRoot.ts` — mutation untuk update Merkle root

**Tier 2 — utility hooks:**
- `apps/web/src/hooks/useMintDecimals.ts` — fetch mint decimal info
- `apps/web/src/hooks/useProofLookup.ts` — fetch Merkle proof dari API
- `apps/web/src/hooks/useClaimRecord.ts` — fetch on-chain ClaimRecord PDA

**Lib functions (sudah ada beberapa comments, tapi perlu diperlengkap):**
- `apps/web/src/lib/vesting/list.ts` — `isGracePeriodVisible()`, `CampaignLifecycle`
- `apps/web/src/lib/vesting/schedule.ts` — `vested()`, `getVestedAmount()`
- `apps/web/src/lib/merkle/builder.ts` — `encodeLeaf()`, `buildTree()`, `getProof()`
- `apps/web/src/lib/anchor/errors.ts` — tambah error 6041 `PerLeafCapExceeded`

**Format JSDoc yang dipakai:**
```typescript
/**
 * Fetches vesting progress for a beneficiary across all their campaigns.
 *
 * @param address - Beneficiary wallet public key (base58)
 * @returns TanStack Query result with array of VestingProgressEntry
 *
 * @example
 * const { data, isLoading } = useVestingProgress(publicKey?.toBase58());
 */
```

- [ ] **Step 1:** Baca 5 hooks Tier 1 dan draft JSDoc untuk masing-masing
- [ ] **Step 2:** Tambahkan JSDoc ke 5 hooks Tier 1
- [ ] **Step 3:** Tambahkan JSDoc ke 3 hooks Tier 2
- [ ] **Step 4:** Tambahkan/update JSDoc ke 4 lib functions
- [ ] **Step 5:** Tambahkan error code 6041 ke `errors.ts` (`PerLeafCapExceeded`)
- [ ] **Step 6:** Run `npx tsc --noEmit` dari `apps/web/` — pastikan 0 TypeScript errors
- [ ] **Step 7:** Commit: `docs(code): add JSDoc to hooks and lib functions + fix errors.ts 6041`

---

## Task 7: Verifikasi README Accuracy

**Deliverable:** Tidak ada file baru, tapi README.md akurat sepenuhnya

**Kenapa diperlukan:** Week 9 brief acceptance criteria #4: "Setup guide updated: README from Week 3 is current and accurate for the final codebase."

**Hal yang harus dicek dan diupdate:**

```
Cek | Item | Status saat ini
--- | ---- | ------
[ ] | Setup steps (pnpm install, anchor build, dll.) | Perlu verifikasi
[ ] | Program ID match PROGRAM.md | G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu
[ ] | Vitest count | ✅ Updated 569→572 (tadi)
[ ] | INSTRUCTION_REFERENCE error range | ✅ Updated 6000-6040→6000-6041 (tadi)
[ ] | FE_DOCUMENTATION_REVIEW.md listed | ✅ Added (tadi)
[ ] | FE_TESTING_STATUS.md listed | ✅ Added (tadi)
[ ] | Vercel deployment status | ⚠️ Currently DOWN — perlu note
[ ] | Week 9 FE contributions mentioned | ❌ Belum ada
[ ] | E2E infrastructure mentioned | ❌ Belum ada
[ ] | Dark mode mentioned | ❌ Belum ada
```

- [ ] **Step 1:** Baca README.md dari awal sampai akhir
- [ ] **Step 2:** Test semua setup commands (pnpm install, anchor build check)
- [ ] **Step 3:** Tambahkan note bahwa Vercel deployment sementara down
- [ ] **Step 4:** Tambahkan Week 9 FE section di changelog
- [ ] **Step 5:** Commit: `docs(readme): Week 9 FE updates — dark mode, E2E, Vercel status`

---

## Urutan Eksekusi yang Direkomendasikan

```
Task 6 (JSDoc + errors.ts fix) ← PRIORITAS TERTINGGI, fix before demo day
Task 3 (Bug Log)               ← mudah, data sudah siap
Task 1 (FE Architecture)       ← penting untuk KPI unfamiliar developer
Task 4 (E2E Guide)             ← membantu CI/CD understanding
Task 2 (Component Reference)   ← longest task, bisa dikerjakan paralel
Task 5 (Update stale docs)     ← cleanup, lower priority
Task 7 (README final check)    ← last check sebelum submit PR
```

**Estimasi waktu:**
- Task 6: ~45 menit (8 hooks + 4 lib files)
- Task 3: ~30 menit (data sudah siap dari commits)
- Task 1: ~60 menit (perlu baca banyak file)
- Task 4: ~30 menit (panduan singkat)
- Task 2: ~90 menit (30+ komponen)
- Task 5: ~30 menit (update dua doc)
- Task 7: ~15 menit (final check)

**Total estimasi: ~5-6 jam**

---

## Acceptance Criteria Mapping (Week 9 Brief)

| Kriteria Brief | Task yang Mengerjakan | File Output |
|---------------|----------------------|-------------|
| Instruction reference (params, behavior, error codes) | ✅ Sudah ada (Lana) + Task 6 (errors.ts 6041) | `docs/week9/INSTRUCTION_REFERENCE.md` |
| Integration guide (working code snippets) | ✅ Sudah ada (Lana) + `docs/FE_INTEGRATION.md` | `docs/week9/INTEGRATION_GUIDE.md` |
| ≥3 Architecture Decision Records | ✅ 3 SC ADRs (Lana) + 4 FE ADRs (Geral dalam FE_DOCUMENTATION_REVIEW) | `docs/week9/ADRs/`, `docs/week9/FE_DOCUMENTATION_REVIEW.md §4` |
| Setup guide / README accuracy | Task 7 + ✅ sudah diupdate sebagian | `README.md` |
| Marketing teammate reviewed guide | ✅ Done (Lana clarity review) | — |
| **KPI: unfamiliar dev bisa integrate** | Task 1 + Task 4 + Task 6 + existing docs | Semua file Week 9 |

---

## Note Tentang Scope

Plan ini sengaja **tidak** mencakup:
- Dokumentasi SC (Rust program) — itu scope Lana
- Dokumentasi BE API routes — itu scope Lana
- `docs/INTEGRATION.md` dan `docs/PROGRAM.md` — Lana owns these
- On-chain audit documentation — Lana's scope

Plan ini hanya cover **FE-owned files** di `apps/web/src/` dan FE documentation.
