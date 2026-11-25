import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { VOICE_BUCKET, VOICE_NOTE_WINDOW_MS, voiceNoteAttention, type AttentionItem, type RideMessage } from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';

/*
 * F12 playback. While the ride screen is open, a new voice note from someone
 * else plays on its own once (through the headset if one is connected, with
 * other audio ducked), and shows as an attention item with Play / Stop. Phones
 * cannot auto-play from a background push; the push only chimes.
 */

export interface PlayableVoice {
  key: string;
  path: string | null;
  localUri: string | null;
}

export function useVoiceNotes(params: { enabled: boolean; messages: RideMessage[]; myUserId: string | null | undefined; nowIso: string }) {
  const { enabled, messages, myUserId, nowIso } = params;
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [played, setPlayed] = useState<string[]>([]);
  const player = useRef<AudioPlayer | null>(null);
  const openedAt = useRef(Date.now());

  const stop = useCallback(() => {
    try { player.current?.pause(); player.current?.remove(); } catch { /* already gone */ }
    player.current = null;
    setPlayingKey(null);
  }, []);

  const play = useCallback(async (voice: PlayableVoice) => {
    stop();
    let uri = voice.localUri;
    if (!uri && voice.path) {
      const { data } = await supabase.storage.from(VOICE_BUCKET).createSignedUrl(voice.path, 300);
      uri = data?.signedUrl ?? null;
    }
    if (!uri) return;
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', allowsRecording: false }).catch(() => {});
    const p = createAudioPlayer(uri);
    player.current = p;
    setPlayingKey(voice.key);
    setPlayed(list => (list.includes(voice.key) ? list : [...list, voice.key]));
    p.addListener('playbackStatusUpdate', status => {
      if (status.didJustFinish && player.current === p) stop();
    });
    p.play();
  }, [stop]);

  useEffect(() => stop, [stop]);

  // Newest voice note from someone else, sent after the screen opened (no replaying history).
  const latest = useMemo(() => {
    if (!enabled) return null;
    const now = Date.parse(nowIso);
    return messages
      .filter(m => m.message_type === 'voice' && m.voice_path && m.sender_id !== myUserId
        && Date.parse(m.created_at) >= openedAt.current - 5000 && now - Date.parse(m.created_at) < VOICE_NOTE_WINDOW_MS)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
  }, [enabled, messages, myUserId, nowIso]);

  useEffect(() => {
    if (!latest || played.includes(latest.id) || playingKey) return;
    void play({ key: latest.id, path: latest.voice_path ?? null, localUri: null });
  }, [latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const attention: AttentionItem | null = latest
    ? voiceNoteAttention(latest, playingKey === latest.id ? 'playing' : 'ready', nowIso)
    : null;

  const playLatest = useCallback(() => {
    if (latest) void play({ key: latest.id, path: latest.voice_path ?? null, localUri: null });
  }, [latest, play]);

  return { playingKey, play, stop, attention, playLatest };
}
