import { supabase } from '../lib/supabase';
import { getQueuedAlerts, getQueuedLocations, clearQueuedItems } from '../lib/offlineQueue';
let running: Promise<void> | null = null;
export function syncQueue(): Promise<void> {
  if (running) return running;
  running = flush().finally(() => { running = null; });
  return running;
}
async function flush() {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (!userId) return;
  let alertError: string | null = null;
  for (const alert of await getQueuedAlerts(userId)) {
    const { error } = await supabase.from('alerts').upsert(alert, { onConflict: 'id', ignoreDuplicates: true });
    if (error) { alertError = error.message; continue; }
    await clearQueuedItems(userId, [alert.id]);
  }
  for (let i = 0; i < 20; i++) {
    const batch = await getQueuedLocations(userId);
    if (!batch.length) break;
    const { data, error } = await supabase.rpc('bulk_insert_location_updates', {
      updates: batch.map(({ id, ...item }) => ({ ...item, client_id: id })),
    });
    if (error) throw new Error(error.message);
    if (data !== batch.length) throw new Error('Incomplete server acknowledgement. GPS data kept locally.');
    await clearQueuedItems(userId, batch.map(item => item.id!));
  }
  if (alertError) throw new Error('Alerts saved locally; delivery failed: ' + alertError);
}
