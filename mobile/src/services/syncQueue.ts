import { supabase } from '../lib/supabase';
import { getQueueCounts, getQueuedAlerts, getQueuedLocations, clearQueuedItems } from '../lib/offlineQueue';

let running: Promise<void> | null = null;
const LOCATION_BATCH_SIZE = 100;
// Bound each pass so background sync does not monopolize the JS thread or
// radio. The next connectivity/app-state cycle continues from the queue head.
const MAX_LOCATION_BATCHES_PER_PASS = 5;

export function syncQueue(): Promise<void> {
  if (running) return running;
  running = flush().finally(() => { running = null; });
  return running;
}

async function flush() {
  const sessionRes = await supabase.auth.getSession().catch(() => null);
  const userId = sessionRes?.data?.session?.user.id;
  if (!userId) return;
  const counts = await getQueueCounts(userId);
  if (counts.locations === 0 && counts.alerts === 0) return;

  let alertError: string | null = null;
  const alerts = await getQueuedAlerts(userId);
  if (alerts.length) {
    // One network round trip for the common case instead of one request per
    // alert. If a malformed row makes the batch fail, isolate rows so a single
    // bad alert cannot prevent valid alerts from syncing.
    const { error } = await supabase.from('alerts').upsert(alerts, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
    if (!error) {
      await clearQueuedItems(userId, alerts.map(alert => alert.id));
    } else {
      let firstError: string | null = null;
      for (const alert of alerts) {
        const result = await supabase.from('alerts').upsert(alert, {
          onConflict: 'id',
          ignoreDuplicates: true,
        });
        if (result.error) {
          firstError ||= result.error.message;
          continue;
        }
        await clearQueuedItems(userId, [alert.id]);
      }
      alertError = firstError;
    }
  }

  for (let i = 0; i < MAX_LOCATION_BATCHES_PER_PASS; i++) {
    const batch = await getQueuedLocations(userId, LOCATION_BATCH_SIZE);
    if (!batch.length) break;
    const { data, error } = await supabase.rpc('bulk_insert_location_updates', {
      updates: batch.map(({ id, ...item }) => ({ ...item, client_id: id })),
    });
    if (error) {
      if (error.message?.includes('Invalid or unauthorized')) {
        let hasRemainingErrors = false;
        for (const item of batch) {
          const res = await supabase.rpc('bulk_insert_location_updates', {
            updates: [{ ...item, client_id: item.id }],
          });
          if (!res.error && res.data === 1) {
            await clearQueuedItems(userId, [item.id!]);
          } else if (res.error?.message?.includes('Invalid or unauthorized')) {
            const currentSession = (await supabase.auth.getSession().catch(() => null))?.data?.session;
            if (currentSession?.user?.id === userId) {
              await clearQueuedItems(userId, [item.id!]);
            } else {
              hasRemainingErrors = true;
            }
          } else {
            hasRemainingErrors = true;
          }
        }
        if (hasRemainingErrors) throw new Error(error.message);
        continue;
      }
      throw new Error(error.message);
    }
    if (data !== batch.length) throw new Error('Incomplete server acknowledgement. GPS data kept locally.');
    await clearQueuedItems(userId, batch.map(item => item.id!));
  }
  if (alertError) throw new Error('Some alerts remain queued: ' + alertError);
}
