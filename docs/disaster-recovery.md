# RideNTrack Disaster Recovery & Database Restoration Runbook

This runbook documents the backup and restoration procedures for the RideNTrack Supabase PostgreSQL backend.

---

## 1. Architecture & Data Model Dependencies

The RideNTrack backend relies on Supabase Auth (`auth.users`) for account identities.
- `public.profiles.id` has a foreign key constraint referencing `auth.users(id) ON DELETE CASCADE`.
- User-owned tables (`rides`, `ride_participants`, `location_updates`, `alerts`, `trip_expenses`, `trip_journal_entries`, etc.) cascade delete from `public.profiles(id)`.

**Critical Requirement:** When restoring database data into a new Supabase project, `auth.users` must be populated first or restored simultaneously to preserve UUID referential integrity.

---

## 2. Automated & Manual Backup Procedures

### Platform Backups (Supabase Managed)
- Enable **Point-in-Time Recovery (PITR)** in the Supabase Dashboard under Database -> Backups.
- Daily logical backups are maintained by Supabase.

### Manual Full Database Dump (CLI / Automation)
Run the following script to export both `auth` and `public` schemas:
```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="ridentrack_backup_${BACKUP_DATE}.sql"

pg_dump \
  --host="${DB_HOST}" \
  --port="${DB_PORT:-5432}" \
  --username="${DB_USER:-postgres}" \
  --dbname="${DB_NAME:-postgres}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --schema=auth \
  --schema=public \
  --file="${BACKUP_FILE}"

echo "Backup complete: ${BACKUP_FILE}"
```

---

## 3. Restoration Procedure into a Separate / Fresh Project

### Step 1: Initialize New Project & Enable Required Extensions
In the new Supabase project SQL Editor (or via `psql`):
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Step 2: Option A — Clean Schema Setup (New Environment / Staging)
If provisioning a clean staging or development instance without historical data:
```bash
# 1. Run bootstrap (sets up mock auth functions if testing outside managed Supabase)
psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -f tests/db-bootstrap.sql

# 2. Run migrations in alphanumeric sequence
for migration in supabase/migrations/*.sql; do
  echo "Applying: ${migration}..."
  psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${migration}"
done
```

### Step 3: Option B — Production Data Restore (From SQL Dump)
When restoring production user accounts, rides, and location history:
```bash
# 1. Disable constraint triggers to allow out-of-order restoration
psql "${TARGET_DATABASE_URL}" -c "SET session_replication_role = 'replica';"

# 2. Restore schema and data
psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${BACKUP_FILE}"

# 3. Re-enable constraint triggers
psql "${TARGET_DATABASE_URL}" -c "SET session_replication_role = 'origin';"
```

---

## 4. Post-Restore Verification Checklist

Execute the comprehensive regression verification script against the restored database:
```bash
psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -f tests/db-regression.sql
```

Verify that:
1. `anon` role execution is revoked on all sensitive RPCs.
2. All 21 public tables enforce Row Level Security.
3. RLS policies on `profiles`, `location_updates`, and `alerts` correctly isolate user data.
4. Realtime channels on `realtime.messages` authorize only active ride members.
