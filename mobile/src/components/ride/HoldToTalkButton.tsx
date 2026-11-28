import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { VOICE_MAX_MS, formatClipDuration, voiceClipUsable } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Icon } from '../ui';
import { playHaptic } from '../../services/haptics';
import { useT } from '../../hooks/useLocale';

/*
 * F12: push to talk. Hold anywhere on the big button, talk, let go to send.
 * A bar fills toward the 15 second limit and recording stops on its own
 * there. Mono AAC at 32 kbps keeps a full clip near 60 KB for weak signal.
 */

const VOICE_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
};

export function HoldToTalkButton(props: {
  onRecorded: (uri: string, durationMs: number) => void;
  onError: (message: string) => void;
  compact?: boolean;
}) {
  const theme = useRideTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const recorder = useAudioRecorder(VOICE_OPTIONS);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const stopping = useRef(false);

  async function start() {
    stopping.current = false;
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { props.onError(t('voice.mic_permission')); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    if (stopping.current) return; // let go before the mic was ready
    recorder.record();
    startedAt.current = Date.now();
    setElapsed(0);
    void playHaptic('tick');
  }

  async function finish() {
    stopping.current = true;
    const began = startedAt.current;
    startedAt.current = null;
    setElapsed(null);
    if (began == null) return;
    const duration = Math.min(VOICE_MAX_MS, Date.now() - began);
    try {
      await recorder.stop();
    } finally {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
    if (!voiceClipUsable(duration)) { props.onError(t('voice.too_short')); return; }
    if (recorder.uri) { void playHaptic('success'); props.onRecorded(recorder.uri, duration); }
  }

  useEffect(() => {
    if (elapsed == null) return;
    const t = setInterval(() => {
      if (startedAt.current == null) return;
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= VOICE_MAX_MS) void finish();
    }, 100);
    return () => clearInterval(t);
  }, [elapsed != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const recording = elapsed != null;
  const fill = recording ? Math.min(1, elapsed / VOICE_MAX_MS) : 0;
  return (
    <Pressable
      onPressIn={() => void start().catch(() => props.onError(t('voice.mic_failed')))}
      onPressOut={() => void finish().catch(() => props.onError(t('voice.save_failed')))}
      style={[s.button, props.compact && s.compact, recording && { backgroundColor: theme.danger, borderColor: theme.danger }]}
      accessibilityRole="button"
      accessibilityLabel="Hold to record a voice note for your pack, release to send"
    >
      <View style={[s.fill, { width: `${fill * 100}%` }]} />
      <Icon name={recording ? 'mic' : 'mic-outline'} size="md" color={recording ? theme.onDanger : theme.accent} />
      {!props.compact && (
        <Text style={[s.label, recording && { color: theme.onDanger }]}>
          {recording ? t('chat.release_to_send', { time: formatClipDuration(elapsed) }) : t('chat.hold_to_talk')}
        </Text>
      )}
    </Pressable>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  button: {
    minHeight: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.accent, backgroundColor: c.accentSoft,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, overflow: 'hidden',
  },
  compact: { width: 48, minHeight: 48, height: 48, paddingHorizontal: 0 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.18)' },
  label: { color: c.accent, fontSize: 16, fontWeight: '800' },
});
