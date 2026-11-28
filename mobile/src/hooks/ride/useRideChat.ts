import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildChatLines, chatQueueSummary, normaliseChatBody, type QueuedChatMessage, type RideMessage, type RideMessageType } from '@ridentrack/shared';
import { enqueueMessage, getQueuedMessagesForRide, newQueueId } from '../../lib/offlineQueue';
import { rejectedMessageIds } from '../../services/syncQueue';
import * as FileSystem from 'expo-file-system/legacy';
import { useT } from '../useLocale';

/*
 * F8: trip chat that works in a dead zone. Every message goes through the
 * SQLite queue first, so the same code path serves "online" and "no signal";
 * the shared sync loop sends it and the chat shows Sending, Waiting for
 * signal, Sent or Failed under each of the rider's own messages.
 */
export function useRideChat(params: {
  rideId: string | null | undefined;
  userId: string | null | undefined;
  online: boolean;
  messages: RideMessage[];
  pendingMessagesCount: number;
  flushQueue: () => Promise<void>;
}) {
  const { rideId, userId, online, messages, pendingMessagesCount, flushQueue } = params;
  const t = useT();
  const [queued, setQueued] = useState<QueuedChatMessage[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [sentIds, setSentIds] = useState<string[]>([]);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;

  // Re-read the queue: anything that left it was either accepted or refused.
  const reload = useCallback(async () => {
    if (!rideId || !userId) return;
    const fresh = await getQueuedMessagesForRide(userId, rideId).catch(() => null);
    if (!fresh) return;
    const stillQueued = new Set(fresh.map(m => m.id));
    const gone = queuedRef.current.filter(m => !stillQueued.has(m.id));
    const refused = gone.filter(m => rejectedMessageIds.has(m.id)).map(m => m.id);
    const accepted = gone.filter(m => !rejectedMessageIds.has(m.id)).map(m => m.id);
    if (refused.length) setFailedIds(ids => [...new Set([...ids, ...refused])]);
    if (accepted.length) setSentIds(ids => [...new Set([...ids, ...accepted])]);
    setQueued(prev => {
      const known = new Set(fresh.map(m => m.id));
      return [...fresh, ...prev.filter(m => !known.has(m.id))];
    });
  }, [rideId, userId]);

  useEffect(() => { setQueued([]); setFailedIds([]); setSentIds([]); void reload(); }, [reload]);
  useEffect(() => { void reload(); }, [pendingMessagesCount, online, reload]);

  // Once the server copy (same client id) is here, drop the local one.
  useEffect(() => {
    const onServer = new Set(messages.map(m => m.client_id).filter(Boolean) as string[]);
    if (queuedRef.current.some(m => onServer.has(m.id))) {
      setQueued(prev => prev.filter(m => !onServer.has(m.id)));
    }
  }, [messages]);

  const flush = useCallback(async () => {
    if (!online) return;
    await flushQueue().catch(() => {});
    await reload();
  }, [online, flushQueue, reload]);

  const send = useCallback(async (body: string, messageType: RideMessageType = 'text') => {
    const text = normaliseChatBody(body);
    if (!text || !rideId || !userId) return;
    const message: QueuedChatMessage = {
      id: await newQueueId(), ride_id: rideId, user_id: userId, body: text, message_type: messageType,
      created_at: new Date().toISOString(),
    };
    await enqueueMessage(message);
    setQueued(prev => [...prev, message]);
    void flush();
  }, [rideId, userId, flush]);

  /** F12: keep the clip somewhere the OS will not clean, then queue it like any message. */
  const sendVoice = useCallback(async (uri: string, durationMs: number) => {
    if (!rideId || !userId) return;
    const id = await newQueueId();
    let localUri = uri;
    try {
      const dir = `${FileSystem.documentDirectory}voice/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      localUri = `${dir}${id}.m4a`;
      await FileSystem.copyAsync({ from: uri, to: localUri });
    } catch {
      localUri = uri;
    }
    const message: QueuedChatMessage = {
      id, ride_id: rideId, user_id: userId, body: 'Voice note', message_type: 'voice',
      created_at: new Date().toISOString(), voice: { local_uri: localUri, duration_ms: durationMs },
    };
    await enqueueMessage(message);
    setQueued(prev => [...prev, message]);
    void flush();
  }, [rideId, userId, flush]);

  const retry = useCallback(async (message: QueuedChatMessage) => {
    rejectedMessageIds.delete(message.id);
    setFailedIds(ids => ids.filter(id => id !== message.id));
    await enqueueMessage(message);
    void flush();
  }, [flush]);

  const lines = useMemo(() => buildChatLines({
    server: messages, queued, failedIds, sentIds, myUserId: userId, online,
  }), [messages, queued, failedIds, sentIds, userId, online]);

  return { lines, summary: chatQueueSummary(lines, online, t), send, sendVoice, retry };
}
