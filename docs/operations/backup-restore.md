# Backup & Restore Procedures

> **Scope:** Supabase PostgreSQL (production). Covers automated PITR, manual `pg_dump` backups, restore, weekly checks, and disaster recovery.

**Connection string:** Set `DATABASE_URL` to your Supabase Postgres URI (see `docs/BACKEND_API.md` for format). All commands below assume this variable is exported in your shell.

---

## 1. Automated Backups (Supabase PITR)

Supabase **paid plans** (Pro and above) include:

- **Automatic daily backups** — full snapshots retained per your plan tier.
- **Point-in-time recovery (PITR)** — continuous WAL archiving; restore to any second within the retention window (7 days default on Pro; up to 14 days on higher tiers).

### Enable PITR (one-time)

1. Log in to [app.supabase.com](https://app.supabase.com).
2. Select the production project.
3. Go to **Database → Backups**.
4. Toggle **Enable Point-in-Time Recovery** to ON.
5. Confirm the retention window matches your RPO needs (see §5).

### Restore via Supabase dashboard (PITR)

Use this when you need to roll back to a specific timestamp without a manual dump file.

1. Go to **Database → Backups → Point-in-Time Recovery**.
2. Choose the target date/time (must fall within the retention window).
3. Click **Restore**. Supabase provisions a database at that point in time (typically a new project or branch).
4. Copy the new connection string and update `DATABASE_URL` in Vercel / Railway / your deployment secrets.
5. Run the verification steps in §4 before directing production traffic to the restored instance.

---

## 2. Manual pg_dump Backup

Take a portable SQL dump at any time. Use this for off-platform copies (encrypted S3, local encrypted storage) and for staging restore drills.

```bash
pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-acl \
  > backup_$(date +%Y%m%d).sql
```

| Item | Guidance |
|------|----------|
| **Schedule** | Weekly via cron (minimum); daily if you rely on manual dumps instead of PITR |
| **Storage** | Encrypted S3 bucket or local encrypted volume; never commit dumps to git |
| **Naming** | `backup_YYYYMMDD.sql` (append `_HHMMSS` if taking multiple dumps per day) |

### Weekly cron example

Add to the backup host crontab (`crontab -e`):

```cron
# Sundays at 03:00 UTC — weekly manual snapshot
0 3 * * 0 pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-acl \
  > /backups/velthoryn_$(date +\%Y\%m\%d).sql
```

Verify the file is non-empty after the first run:

```bash
ls -lh /backups/velthoryn_$(date +%Y%m%d).sql
```

---

## 3. Restore Procedure

Follow these steps when recovering from a manual SQL dump (e.g., after data loss or to clone production to staging).

### Step 1 — Prepare the target database

- **Preferred:** Create a fresh Supabase project or branch so you do not overwrite live production accidentally.
- **Alternative:** Use an existing empty staging database dedicated to restore drills.
- Set `DATABASE_URL` to the target connection string.

### Step 2 — Apply schema migrations

From the repository root:

```bash
cd apps/web && pnpm db:migrate
```

This applies all files under `apps/web/src/lib/db/migrations/` in order via Drizzle.

> **Local vs production:** Use `db:push` for local dev only (fast schema sync). Use `db:migrate` for CI, production, and restore targets — same command CI runs in `lint.yml` and `web-ci.yml`.

### Step 3 — Restore data from dump

```bash
psql "$DATABASE_URL" < backup_YYYYMMDD.sql
```

Replace `backup_YYYYMMDD.sql` with your dump filename. The `--clean --if-exists` flags in the dump drop existing objects before recreating them; only run against a fresh or disposable database.

### Step 4 — Verify

```bash
cd apps/web && pnpm test:db
```

Then confirm critical row counts (adjust if new tables were added):

```sql
SELECT
  (SELECT count(*) FROM campaigns)          AS campaigns,
  (SELECT count(*) FROM leaves)             AS leaves,
  (SELECT count(*) FROM claim_events)       AS claim_events,
  (SELECT count(*) FROM drizzle_migrations) AS applied_migrations;
```

Compare counts to production metrics or the previous week's backup report before promoting the restored database.

---

## 4. Weekly Check Runbook

Run this checklist **once per week** (e.g., Monday after the Sunday cron backup). Log the result in your ops channel or ticket system.

| # | Check | Pass criteria |
|---|-------|---------------|
| 1 | **Verify backup exists for this week** | Latest file in `/backups/` (or S3 prefix) is dated within the last 7 days and size > 0 |
| 2 | **Test restore on staging DB** | Complete §3 Steps 1–3 on staging without errors |
| 3 | **Verify row counts match production** | Staging counts from §3 Step 4 match production within expected drift (new rows since backup time are OK; large gaps are not) |
| 4 | **Log check result** | Post date, operator, backup filename, row-count summary, and pass/fail to `#ops-alerts` or your ops log |

If any step fails, open an incident and follow §5 escalation before the next production change window.

---

## 5. Disaster Recovery

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (Recovery Point Objective) | **24 hours** | Assumes daily Supabase backups + weekly manual `pg_dump`; PITR can reduce RPO to minutes if enabled |
| **RTO** (Recovery Time Objective) | **1 hour** | Time to restore service after a declared incident (PITR dashboard restore or manual dump + migration + verify) |

### Escalation path

1. **On-call engineer** — Acknowledge incident in `#ops-alerts`; begin PITR or manual restore per §1 or §3.
2. **Project lead** — If RTO exceeds 30 minutes or data integrity is uncertain, notify the lead for go/no-go on traffic cutover.
3. **Supabase support** — [support.supabase.com](https://support.supabase.com) (Pro plan includes email support) for platform-level restore failures.

Document the incident timeline, restore method used, and final row-count verification before closing.

---

## Related docs

- Multisig and on-chain ops: `docs/operations/multisig-setup.md`
- Environment variables: `docs/MAINNET_CHECKLIST.md`, `docs/BACKEND_API.md`
- Migration files: `apps/web/src/lib/db/migrations/`

*Last updated: 2026-06-10 (week8-docs T7)*
