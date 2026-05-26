# Database Backup & Restore Procedures

> **Scope:** Supabase Postgres (production). Covers PITR, manual backups, and restore steps.

---

## 1. Enable Point-in-Time Recovery (PITR)

PITR requires the **Supabase Pro plan** or higher.

1. Log in to [app.supabase.com](https://app.supabase.com).
2. Select your project.
3. Go to **Database → Backups**.
4. Toggle **"Enable Point-in-Time Recovery"** to ON.
5. Choose a retention window (default: 7 days; Pro allows up to 14 days).

Once enabled, Supabase streams WAL segments to S3 continuously. Any moment within the retention window can be used as a restore point.

---

## 2. Manual Backups

Use `pg_dump` to take a portable SQL dump at any point in time.

```bash
# Full schema + data dump (recommended for routine snapshots)
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --format=plain \
  > backup_$(date +%Y%m%d_%H%M%S).sql
```

Store backups in a separate location (e.g., S3 bucket or encrypted local store).

### Automate with cron

Add to crontab (`crontab -e`) on the backup host:

```
# Daily at 03:00 UTC
0 3 * * * pg_dump "$DATABASE_URL" --no-owner --no-acl > /backups/velthoryn_$(date +\%Y\%m\%d).sql
```

---

## 3. Restore Procedures

### 3a. Restore from PITR (Supabase dashboard)

1. Go to **Database → Backups → Point-in-Time Recovery**.
2. Select the target timestamp (within the retention window).
3. Click **Restore**. Supabase will spin up a new database instance at that point in time.
4. Update `DATABASE_URL` in your environment/Vercel project to point to the new instance.
5. Verify by checking row counts (see §4).

### 3b. Restore from a manual SQL dump

```bash
# Wipe and restore (destructive — run on a fresh or test database)
psql "$DATABASE_URL" < backup_YYYYMMDD_HHMMSS.sql
```

If restoring into an existing production database, prefer using a new Supabase branch or staging instance first.

---

## 4. Backup Verification Checklist

Run after every planned restore or as a weekly health check:

```sql
-- Check critical table row counts
SELECT
  (SELECT count(*) FROM campaigns)       AS campaigns,
  (SELECT count(*) FROM leaves)          AS leaves,
  (SELECT count(*) FROM claim_events)    AS claim_events,
  (SELECT count(*) FROM drizzle_migrations) AS applied_migrations;
```

Cross-reference counts against production metrics or the previous backup report.

### Automated weekly check (optional)

Add a cron route to the API that queries these counts and reports to your monitoring service:

```
GET /api/cron/backup-verify   (protected by CRON_SECRET)
```

---

## 5. Rollback a Bad Migration

Each migration in `apps/web/src/lib/db/migrations/` should have a companion down-SQL comment (or a separate `down/` file) documenting the reversal.

To roll back manually:

1. Identify the offending migration file (e.g., `0005_timeline_indexes.sql`).
2. Run the inverse SQL (`DROP INDEX`, `DROP TABLE`, etc.) on the database.
3. Delete or archive the migration file from `migrations/`.
4. Regenerate the drizzle migration journal if needed.

---

## 6. Contacts & Escalation

| Role | Contact |
|------|---------|
| On-call engineer | See team Slack `#ops-alerts` |
| Supabase support | support.supabase.com (Pro plan includes email support) |

---

*Last updated: 2026-05-26*
