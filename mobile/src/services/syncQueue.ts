import { voiceClipPath, VOICE_BUCKET } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { getQueueCounts, getQueuedAlerts, getQueuedLocations, getQueuedMessages, getQueuedRoadReports, clearQueuedItems, pruneQueue } from '../lib/offlineQueue';

// Queued items older than this are not useful to the group and would only
// grow the device database on a phone that stays offline for weeks.
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A Postgres error in class 22 (bad data), 23 (constraint) or 42 (permission /
 * RLS) will fail the same way on every retry, e.g. an alert queued just before
 * the rider left the ride. Network and server errors are worth retrying.
 */
function isPermanentRejection(error: { code?: string | null } | null | undefined) {
  return Boolean(error?.code && /^(22|23|42)/.test(error.code));
}

let running: Promise<void> | null = null;

/** 'ok' when the clip is in storage (now or from an earlier try), 'gone' when the local file is lost. */
async function uploadVoiceClip(path: string, localUri: string): Promise<'ok' | 'retry' | 'gone'> {
  let body: ArrayBuffer;
  try {
    body = await (await fetch(localUri)).arrayBuffer();
  } catch {
    return 'gone';
  }
  const { error } = await supabase.storage.from(VOICE_BUCKET).upload(path, body, { contentType: 'audio/mp4', upsert: false });
  if (!error || /exists|duplicate/i.test(error.message)) return 'ok';
  return 'retry';
}

/** Chat messages the server refused for good (shown as Failed with a retry). */
export const rejectedMessageIds = new Set<string>();
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
  await pruneQueue(MAX_QUEUE_AGE_MS).catch(() => {});
  const counts = await getQueueCounts(userId);
  if (counts.locations === 0 && counts.alerts === 0 && !counts.messages && !counts.roadReports) return;

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
          if (isPermanentRejection(result.error)) {
            // Retrying forever would keep the "alerts remain queued" banner up
            // and block nothing useful; the server will never accept it.
            await clearQueuedItems(userId, [alert.id]);
            continue;
          }
          firstError ||= result.error.message;
          continue;
        }
        await clearQueuedItems(userId, [alert.id]);
      }
      alertError = firstError;
    }
  }

  // F8: chat written offline. client_id makes a retry after a lost
  // acknowledgement a no-op on the server.
  let messageError: string | null = null;
  if (counts.messages) {
    const messages = await getQueuedMessages(userId);
    for (const m of messages) {
      // F12: a voice note uploads its clip first; the row then points at it.
      let voice: { voice_path: string; voice_duration_ms: number } | null = null;
      if (m.voice) {
        const path = voiceClipPath(m.ride_id, m.user_id, m.id);
        const uploaded = await uploadVoiceClip(path, m.voice.local_uri);
        if (uploaded === 'retry') { messageError ||= 'Voice note upload failed'; continue; }
        if (uploaded === 'gone') { await clearQueuedItems(userId, [m.id]); rejectedMessageIds.add(m.id); continue; }
        voice = { voice_path: path, voice_duration_ms: Math.round(m.voice.duration_ms) };
      }
      const { error } = await supabase.from('ride_messages').upsert({
        client_id: m.id, ride_id: m.ride_id, sender_id: m.user_id, body: m.body,
        message_type: m.message_type, client_created_at: m.created_at, ...(voice ?? {}),
      }, { onConflict: 'client_id', ignoreDuplicates: true });
      if (!error) { await clearQueuedItems(userId, [m.id]); continue; }
      if (isPermanentRejection(error)) {
        // e.g. the rider left the ride; keep it out of the queue but let the chat show it as failed.
        await clearQueuedItems(userId, [m.id]);
        rejectedMessageIds.add(m.id);
        continue;
      }
      messageError ||= error.message;
    }
  }

  // F11: road reports. The queue id is the report id, so retries are no-ops;
  // a rate limit or a ride the rider left will never pass, so drop those.
  if (counts.roadReports) {
    for (const r of await getQueuedRoadReports(userId)) {
      const { error } = await supabase.rpc('create_road_report', {
        p_id: r.id, p_type: r.type, p_lat: r.lat, p_lng: r.lng, p_note: r.note, p_ride_id: r.ride_id,
      });
      if (!error || isPermanentRejection(error) || error.code === 'P0001') await clearQueuedItems(userId, [r.id]);
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
  if (messageError) throw new Error('Some messages remain queued: ' + messageError);
}
