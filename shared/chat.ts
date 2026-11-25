/**
 * F8 offline chat.
 *
 * A message written with no signal waits on the phone and goes when signal
 * returns. The rider always sees which state each of their messages is in,
 * using the shared status words, and messages that arrive late after a long
 * dead zone are labelled instead of silently jumping around.
 */

import type { RideMessage, RideMessageType } from './types';
import { DELIVERY_LABELS, type DeliveryState } from './status';

export interface QueuedChatMessage {
  /** Client id; becomes ride_messages.client_id. */
  id: string;
  ride_id: string;
  user_id: string;
  body: string;
  message_type: RideMessageType;
  /** When the rider wrote it. */
  created_at: string;
  /** F12: a voice note recorded on this phone, uploaded before the row. */
  voice?: { local_uri: string; duration_ms: number } | null;
}

export interface ChatLine {
  key: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  body: string;
  messageType: RideMessageType;
  isPinned: boolean;
  /** When it was written (client time when known). */
  writtenAt: string;
  /** Only for my own messages. */
  delivery: DeliveryState | null;
  /** "Sent 10:42, arrived 11:05" when it reached the pack much later than it was written. */
  lateNote: string | null;
  /** The queued copy, for a retry. */
  queued?: QueuedChatMessage;
  /** F12: voice note, by storage path (sent) or local file (still on this phone). */
  voice?: { path: string | null; localUri: string | null; durationMs: number } | null;
}

/** A message counts as late when it reached the server this long after it was written. */
export const LATE_MESSAGE_MS = 3 * 60 * 1000;

export const MAX_CHAT_LENGTH = 1000;

export function normaliseChatBody(body: string): string | null {
  const trimmed = body.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, MAX_CHAT_LENGTH) : null;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function lateNote(writtenAt: string | null | undefined, arrivedAt: string): string | null {
  if (!writtenAt) return null;
  const w = Date.parse(writtenAt);
  const a = Date.parse(arrivedAt);
  if (!Number.isFinite(w) || !Number.isFinite(a) || a - w < LATE_MESSAGE_MS) return null;
  return `Written ${clock(writtenAt)}, arrived ${clock(arrivedAt)}`;
}

/**
 * Server messages plus my queued ones, in the order they were written.
 * A queued message the server already has (same client id) shows once, as sent.
 */
export function buildChatLines(input: {
  server: RideMessage[];
  queued: QueuedChatMessage[];
  failedIds?: Iterable<string>;
  myUserId: string | null | undefined;
  online: boolean;
  /** Client ids currently being sent. */
  sendingIds?: Iterable<string>;
  /** Client ids the server acknowledged whose realtime echo has not arrived yet. */
  sentIds?: Iterable<string>;
}): ChatLine[] {
  const failed = new Set(input.failedIds ?? []);
  const sending = new Set(input.sendingIds ?? []);
  const sent = new Set(input.sentIds ?? []);
  const onServer = new Set(input.server.map(m => m.client_id).filter(Boolean) as string[]);
  const lines: ChatLine[] = [];

  for (const m of input.server) {
    const mine = m.sender_id === input.myUserId;
    const writtenAt = m.client_created_at || m.created_at;
    lines.push({
      key: m.id,
      senderId: m.sender_id,
      senderName: mine ? 'You' : m.sender_name || 'Rider',
      mine,
      body: m.body,
      messageType: m.message_type,
      isPinned: m.is_pinned,
      writtenAt,
      delivery: mine ? 'sent' : null,
      lateNote: lateNote(m.client_created_at, m.created_at),
      voice: m.message_type === 'voice' && m.voice_path ? { path: m.voice_path, localUri: null, durationMs: m.voice_duration_ms ?? 0 } : null,
    });
  }
  for (const q of input.queued) {
    if (onServer.has(q.id)) continue;
    const state: DeliveryState = failed.has(q.id)
      ? 'failed'
      : sent.has(q.id) ? 'sent' : input.online || sending.has(q.id) ? 'sending' : 'waiting_for_signal';
    lines.push({
      key: `queued:${q.id}`,
      senderId: q.user_id,
      senderName: 'You',
      mine: true,
      body: q.body,
      messageType: q.message_type,
      isPinned: false,
      writtenAt: q.created_at,
      delivery: state,
      lateNote: null,
      queued: q,
      voice: q.voice ? { path: null, localUri: q.voice.local_uri, durationMs: q.voice.duration_ms } : null,
    });
  }
  return lines.sort((a, b) => Date.parse(a.writtenAt) - Date.parse(b.writtenAt) || (a.key < b.key ? -1 : 1));
}

/** Footer text under one of my messages. */
export function chatDeliveryText(line: Pick<ChatLine, 'delivery'>): string | null {
  return line.delivery ? DELIVERY_LABELS[line.delivery] : null;
}

/** One line above the composer when anything is waiting. */
export function chatQueueSummary(lines: ChatLine[], online: boolean): string | null {
  const waiting = lines.filter(l => l.delivery === 'waiting_for_signal' || l.delivery === 'sending').length;
  const failed = lines.filter(l => l.delivery === 'failed').length;
  if (failed) return `${failed} message${failed === 1 ? '' : 's'} could not be sent. Tap to try again.`;
  if (!waiting) return online ? null : 'No signal. Messages you write now go when signal returns.';
  return online
    ? `Sending ${waiting} message${waiting === 1 ? '' : 's'}…`
    : `${waiting} message${waiting === 1 ? '' : 's'} waiting for signal. They go on their own.`;
}
