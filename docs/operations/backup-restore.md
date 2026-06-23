# Backup & Restore

Database recovery procedures for Supabase PostgreSQL. Covers automated PITR, manual `pg_dump` backups, restore, weekly checks, and disaster recovery.

**Connection string:** Set `DATABASE_URL` to your Supabase Postgres URI. All commands below assume this variable is exported in your shell.

---

## 1. Automated Backups (Supabase PITR)

Supabase paid plans (Pro and above) include:

- **Automatic daily backups** -- full snapshots retained per plan tier.
- **Point-in-time recovery (PITR)** -- continuous WAL archiving; restore to any second within the retention window (7 days default on Pro; up to 14 days on higher tiers).

### Enable PITR (One-Time)

1. Log in to [app.supabase.com](https://app.supabase.com).
2. Select the production project.
3. Go to **Database -> Backups**.
4. Toggle **Enable Point-in-Time Recovery** to ON.
5. Confirm the retention window matches your RPO needs (see Disaster Recovery below).

### Restore via Supabase Dashboard (PITR)

Use this when you need to roll back to a specific timestamp without a manual dump file.

1. Go to **Database -> Backups -> Point-in-Time Recovery**.
2. Choose the target date/time (must fall within the retention window).
3. Click **Restore**. Supabase provisions a database at that point in time.
4. Copy the new connection string and update `DATABASE_URL` in Vercel / deployment secrets.
5. Run the verification steps in Section 4 before directing production traffic to the restored instance.

---

## 2. Manual pg_dump Backup

Take a portable SQL dump at any time. Use for off-platform copies and staging restore drills.

```bash
pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-acl \
  > backup_$(date +%Y%m%d).sql
```

| Item | Guidance |
|---|---|
| **Schedule** | Weekly via cron (minimum); daily if relying on manual dumps instead of PITR |
| **Storage** | Encrypted S3 bucket or local encrypted volume; never commit dumps to git |
| **Naming** | `backup_YYYYMMDD.sql` (append `_HHMMSS` if multiple dumps per day) |

### Weekly Cron Example

Add to the backup host crontab (`crontab -e`):

```cron
# Sundays at 03:00 UTC -- weekly manual snapshot
0 3 * * 0 pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-acl \
  > /backups/velthoryn_$(date +\%Y\%m\%d).sql
```

Verify the file is non-empty after the first run:

```bash
ls -lh /backups/velthoryn_$(date +%Y%m%d).sql
```

---

## 3. Restore Procedure

Follow these steps when recovering from a manual SQL dump.

### Step 1 -- Prepare the Target Database

- **Preferred:** Create a fresh Supabase project or branch so you do not overwrite live production accidentally.
- **Alternative:** Use an existing empty staging database dedicated to restore drills.
- Set `DATABASE_URL` to the target connection string.

### Step 2 -- Apply Schema Migrations

From the repository root:

```bash
cd apps/web && pnpm db:migrate
```

This applies all files under `apps/web/src/lib/db/migrations/` in order via Drizzle.

{% hint style="warning" %}
Use `db:push` for local dev only. Use `db:migrate` for CI, production, and restore targets.
{% endhint %}

### Step 3 -- Restore Data from Dump

```bash
psql "$DATABASE_URL" < backup_YYYYMMDD.sql
```

The `--clean --if-exists` flags in the dump drop existing objects before recreating them. Only run against a fresh or disposable database.

### Step 4 -- Verify

```bash
cd apps/web && pnpm test:db
```

Then confirm critical row counts:

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

Run this checklist once per week (e.g., Monday after the Sunday cron backup). Log the result in your ops channel.

| # | Check | Pass Criteria |
|---|---|---|
| 1 | Verify backup exists for this week | Latest file dated within the last 7 days and size > 0 |
| 2 | Test restore on staging DB | Complete Steps 1-3 on staging without errors |
| 3 | Verify row counts match production | Staging counts match production within expected drift |
| 4 | Log check result | Post date, operator, backup filename, row-count summary, and pass/fail |

If any step fails, open an incident and follow the escalation path in Section 5 before the next production change window.

---

## 5. Disaster Recovery

| Metric | Target | Notes |
|---|---|---|
| **RPO** (Recovery Point Objective) | 24 hours | Assumes daily Supabase backups + weekly `pg_dump`; PITR can reduce RPO to minutes |
| **RTO** (Recovery Time Objective) | 1 hour | Time to restore service after declared incident |

### Escalation Path

1. **On-call engineer** -- Acknowledge incident; begin PITR or manual restore.
2. **Project lead** -- If RTO exceeds 30 minutes or data integrity is uncertain, notify for go/no-go on traffic cutover.
3. **Supabase support** -- [support.supabase.com](https://support.supabase.com) for platform-level restore failures.

Document the incident timeline, restore method used, and final row-count verification before closing.
