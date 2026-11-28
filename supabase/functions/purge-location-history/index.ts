import { createClient } from 'npm:@supabase/supabase-js@2';

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Admin = ReturnType<typeof createClient>;

/**
 * Removes Storage files queued by deleted rides, voice messages and accounts
 * (migration 069). Files must go through the Storage API; a batch that fails
 * stays queued and is retried on the next run, up to 5 times.
 */
async function removeQueuedStorageFiles(admin: Admin): Promise<number> {
  const { data: rows, error } = await admin.rpc('claim_storage_cleanup', { p_limit: 500 });
  if (error) throw new Error(`claim_storage_cleanup failed: ${error.message}`);
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const byBucket = new Map<string, { id: number; object_name: string }[]>();
  for (const row of rows as { id: number; bucket: string; object_name: string }[]) {
    const list = byBucket.get(row.bucket) ?? [];
    list.push(row);
    byBucket.set(row.bucket, list);
  }
  const done: number[] = [];
  for (const [bucket, list] of byBucket) {
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const { error: removeError } = await admin.storage.from(bucket).remove(chunk.map(r => r.object_name));
      if (!removeError) done.push(...chunk.map(r => r.id));
    }
  }
  if (done.length > 0) {
    const { error: finishError } = await admin.rpc('finish_storage_cleanup', { p_ids: done });
    if (finishError) throw new Error(`finish_storage_cleanup failed: ${finishError.message}`);
  }
  return done.length;
}

Deno.serve(async request => {
  const secret = Deno.env.get('LOCATION_PURGE_SECRET');
  if (!secret || !timingSafeEqual(request.headers.get('x-schedule-secret') ?? '', secret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const days = Number(Deno.env.get('LOCATION_RETENTION_DAYS') ?? '7');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc('purge_old_location_history', { p_retention_days: days });
  if (error) return new Response(error.message, { status: 500 });
  let files: number;
  try {
    files = await removeQueuedStorageFiles(admin);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
  }
  return Response.json({ deleted: data, retention_days: days, storage_files_removed: files });
});
