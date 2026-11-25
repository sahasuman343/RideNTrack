/**
 * F12 push-to-talk voice notes: limits, paths and the attention item.
 */

import type { AttentionItem } from './attention';

export const VOICE_MAX_MS = 15_000;
export const VOICE_MIN_MS = 500;
export const VOICE_BUCKET = 'ride-voice';

/** <ride>/<sender>/<client id>.m4a, the only shape the database accepts. */
export function voiceClipPath(rideId: string, userId: string, clientId: string): string {
  return `${rideId}/${userId}/${clientId}.m4a`;
}

export function formatClipDuration(ms: number | null | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `0:${String(Math.min(59, s)).padStart(2, '0')}`;
}

/** Hold shorter than this is a mis-tap, not a message. */
export function voiceClipUsable(durationMs: number): boolean {
  return durationMs >= VOICE_MIN_MS;
}

export const VOICE_NOTE_WINDOW_MS = 5 * 60 * 1000;

/** A new voice note from someone else, while the ride screen is open. */
export function voiceNoteAttention(
  message: { id: string; sender_name?: string | null; voice_duration_ms?: number | null; created_at: string },
  state: 'playing' | 'ready' | 'played',
  nowIso: string,
): AttentionItem | null {
  if (state === 'played') return null;
  const created = Date.parse(message.created_at);
  if (!Number.isFinite(created) || Date.parse(nowIso) - created > VOICE_NOTE_WINDOW_MS) return null;
  return {
    id: `voice:${message.id}`,
    kind: 'voice_note',
    title: `${message.sender_name || 'Rider'}: voice note`,
    body: state === 'playing' ? `Playing · ${formatClipDuration(message.voice_duration_ms)}` : `${formatClipDuration(message.voice_duration_ms)} · tap Play`,
    createdAt: message.created_at,
    expiresAt: new Date(created + VOICE_NOTE_WINDOW_MS).toISOString(),
    actions: state === 'playing'
      ? [{ id: 'stop_voice', label: 'Stop', emphasis: 'secondary' }]
      : [{ id: 'play_voice', label: 'Play', emphasis: 'primary' }],
  };
}
