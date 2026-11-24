# RideNTrack Disaster Recovery & Database Restoration Runbook

This runbook documents the disaster recovery, backup, and restoration procedures for the RideNTrack Supabase PostgreSQL backend and associated Storage assets.

---

## 1. Architecture & Data Model Dependencies

The RideNTrack backend relies on Supabase Auth (`auth.users`) for account identities:
- `public.profiles.id` has a foreign key constraint referencing `auth.users(id) ON DELETE CASCADE`.
- User-owned tables (`rides`, `ride_participants`, `location_updates`, `alerts`, `trip_expenses`, `trip_journal_entries`, etc.) cascade delete from `public.profiles(id)`.

> [!IMPORTANT]
> **Data Scope Limitations:** Standard PostgreSQL database backups (`pg_dump`) and Supabase automated database backups capture schema, roles, and table data only. They **do not include physical Storage object bytes** (avatars, journal attachments). Binary storage assets require an independent S3/Storage API backup procedure (detailed in Section 2).
> 
> **Managed Supabase Auth Constraints:** In managed Supabase instances, the `auth` schema is owned by internal system roles (`supabase_admin`). Standard database dumps must never attempt to `DROP` or recreate the `auth` schema or its system tables.

---

## 2. Backup Procedures

### A. Database Dumps (Schema, Data, and Access Controls)
Run the following script to export the database. Notice that object privileges and ACLs (including explicit `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon`) are preserved by omitting `--no-privileges`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/${BACKUP_DATE}"
mkdir -p "${BACKUP_DIR}"

echo "Starting RideNTrack database backup..."

# 1. Export public schema (tables, functions, triggers, and ACL grants/revokes)
# Note: Omitting --no-privileges ensures explicit security revokes are preserved.
pg_dump \
  --host="${DB_HOST}" \
  --port="${DB_PORT:-5432}" \
  --username="${DB_USER:-postgres}" \
  --dbname="${DB_NAME:-postgres}" \
  --clean \
  --if-exists \
  --no-owner \
  --schema=public \
  --file="${BACKUP_DIR}/ridentrack_public_${BACKUP_DATE}.sql"

# 2. Export auth.users records as data-only inserts (without dropping/recreating auth schema)
pg_dump \
  --host="${DB_HOST}" \
  --port="${DB_PORT:-5432}" \
  --username="${DB_USER:-postgres}" \
  --dbname="${DB_NAME:-postgres}" \
  --data-only \
  --no-owner \
  --no-privileges \
  --table=auth.users \
  --file="${BACKUP_DIR}/ridentrack_auth_users_${BACKUP_DATE}.sql"

echo "Database backup complete in ${BACKUP_DIR}"
```

### B. Storage Object Bytes Backup (Avatars & Journal Photos)
Because database backups exclude binary files stored in object storage, use the Supabase S3-compatible API (or `rclone` / AWS CLI) to back up bucket contents:

```bash
# S3 credentials available from Supabase Project Settings -> Storage -> S3 Credentials
export AWS_ACCESS_KEY_ID="${SUPABASE_STORAGE_S3_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${SUPABASE_STORAGE_S3_SECRET_KEY}"
export S3_ENDPOINT="https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/s3"

# Sync avatars and journal photo buckets locally
aws --endpoint-url="${S3_ENDPOINT}" s3 sync s3://avatars "${BACKUP_DIR}/storage/avatars"
aws --endpoint-url="${S3_ENDPOINT}" s3 sync s3://journal_photos "${BACKUP_DIR}/storage/journal_photos"
```

---

## 3. Restoration Procedure into a Separate Project

### Step 1: Initialize Target Project
In the target Supabase project:
1. Ensure required database extensions are enabled:
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```

---

### Step 2: Option A — Clean Schema Setup (New Environment / Staging)
Use this option when provisioning a fresh, non-production test environment.

> [!WARNING]
> `tests/db-bootstrap.sql` mocks Supabase internal auth objects and is **strictly for empty, unmanaged local/CI test databases**. It **must never be run against managed Supabase projects**.

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Bootstrap mock auth ONLY if targeting an unmanaged test database
if [ "${IS_UNMANAGED_TEST_DB:-false}" = "true" ]; then
  psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -f tests/db-bootstrap.sql
fi

# 2. Replay all migrations sequentially; stop immediately on any failure
for migration in supabase/migrations/*.sql; do
  echo "Applying migration: ${migration}..."
  psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${migration}" || {
    echo "ERROR: Migration ${migration} failed. Halting setup." >&2
    exit 1
  }
done
```

---

### Step 3: Option B — Production Disaster Recovery (Restoring Data & ACLs)
When restoring into a fresh managed Supabase project:

#### 1. Restore Auth Users First
Import the `auth.users` data-only dump to establish the required UUID identities for foreign key references:
```bash
psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${BACKUP_DIR}/ridentrack_auth_users_${BACKUP_DATE}.sql"
```

#### 2. Restore Public Schema, Data, and ACLs in a Single Session
To ensure referential integrity while preserving explicit `REVOKE` and `GRANT` permissions, execute the restore within a single session that enables `session_replication_role = 'replica'` for the duration of the import:

```bash
# Wrap the dump import in a single psql session with session_replication_role
{
  echo "SET session_replication_role = 'replica';"
  cat "${BACKUP_DIR}/ridentrack_public_${BACKUP_DATE}.sql"
  echo "SET session_replication_role = 'origin';"
} | psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1
```

#### 3. Restore Storage Buckets & Policies
Because standard database dumps exclude the `storage` schema, re-apply [supabase/migrations/030_storage_and_security_hardening.sql](supabase/migrations/030_storage_and_security_hardening.sql) to provision the `avatars` and `journal_photos` buckets and their row-level security policies:
```bash
psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/030_storage_and_security_hardening.sql
```

#### 4. Restore Storage Object Bytes
Restore the physical object bytes to the target project's S3 endpoint:
```bash
aws --endpoint-url="${TARGET_S3_ENDPOINT}" s3 sync "${BACKUP_DIR}/storage/avatars" s3://avatars
aws --endpoint-url="${TARGET_S3_ENDPOINT}" s3 sync "${BACKUP_DIR}/storage/journal_photos" s3://journal_photos
```

---

## 4. Post-Restore Verification Checklist

> [!CAUTION]
> **Do not run `tests/db-regression.sql` against the restored production target.** The regression script inserts fixtures, alters user states, and creates test rides that would pollute restored production data. Run `tests/db-regression.sql` **only** against disposable test copies.

For the restored target database, execute **non-mutating verification queries** to confirm access controls and schema health:

```sql
-- 1. Verify anonymous execution is revoked on sensitive RPCs
DO $$
DECLARE rpc regprocedure;
BEGIN
  FOREACH rpc IN ARRAY ARRAY[
    'public.is_ride_participant(uuid,uuid)'::regprocedure,
    'public.get_ride_members(uuid)'::regprocedure,
    'public.get_latest_ride_locations(uuid)'::regprocedure,
    'public.join_ride_by_code(text)'::regprocedure,
    'public.bulk_insert_location_updates(jsonb)'::regprocedure,
    'public.delete_trip(uuid)'::regprocedure,
    'public.leave_ride(uuid)'::regprocedure,
    'public.delete_user_account(uuid)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'CRITICAL: Anonymous access permitted on %', rpc;
    END IF;
  END LOOP;
END $$;

-- 2. Verify Row Level Security is enabled on all public tables
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public' AND NOT rowsecurity;
-- Expected output: 0 rows

-- 3. Verify storage buckets exist and are private
SELECT id, name, public FROM storage.buckets WHERE id IN ('avatars', 'journal_photos');
-- Expected: public = false for both buckets

-- 4. Verify user record counts match expected restore metrics
SELECT
  (SELECT count(*) FROM auth.users) AS auth_users_count,
  (SELECT count(*) FROM public.profiles) AS profiles_count,
  (SELECT count(*) FROM public.rides) AS rides_count;
```
