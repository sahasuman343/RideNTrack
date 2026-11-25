import React, { useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { QUICK_REPLY_PRESETS, chatDeliveryText, formatClipDuration, type ChatLine, type QueuedChatMessage, type RideMessageType } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, typography } from '../../theme';
import { Icon, SheetModal } from '../ui';
import { HoldToTalkButton } from './HoldToTalkButton';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Server messages and my queued ones, in the order they were written. */
  lines: ChatLine[];
  /** One sentence about queued or failed messages, or null. */
  summary: string | null;
  isOnline: boolean;
  onSend: (body: string, messageType: RideMessageType) => Promise<void>;
  onRetry: (message: QueuedChatMessage) => void;
  /** F12: absent when voice notes are off for this ride. */
  onSendVoice?: (uri: string, durationMs: number) => void;
  onPlayVoice?: (line: ChatLine) => void;
  playingKey?: string | null;
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/*
 * Trip chat. Writing works with no signal: messages wait on the phone and go
 * on their own, and each of the rider's messages says where it is (Sending,
 * Waiting for signal, Sent, Failed) in the same words as SOS and alerts.
 */
export function TripChatSheet({
  visible,
  onClose,
  lines,
  summary,
  isOnline,
  onSend,
  onRetry,
  onSendVoice,
  onPlayVoice,
  playingKey,
}: Props) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  const pinnedLines = useMemo(
    () => lines.filter(m => m.isPinned || m.messageType === 'pinned_info'),
    [lines],
  );
  const failed = lines.filter(l => l.delivery === 'failed' && l.queued);

  async function handleSend(text: string, type: RideMessageType) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSendError(null);
    if (type === 'text') setDraft('');
    try {
      await onSend(trimmed, type);
    } catch (err) {
      if (type === 'text') setDraft(trimmed);
      setSendError(err instanceof Error ? err.message : 'Could not save the message on this phone.');
    }
  }

  const deliveryColor = (line: ChatLine) =>
    line.delivery === 'failed' ? theme.danger : line.delivery === 'waiting_for_signal' ? theme.warning : theme.textMuted;

  return (
    <SheetModal visible={visible} onRequestClose={onClose}>
        <View style={s.sheet}>
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Icon name="chatbubbles-outline" size="md" color={theme.accent} />
              <Text style={s.title}>Trip Chat</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityLabel="Close trip chat">
              <Icon name="close" size="md" color={theme.text} />
            </TouchableOpacity>
          </View>

          {summary && (
            <TouchableOpacity
              style={[s.offlineBanner, failed.length > 0 && { borderColor: theme.danger }]}
              disabled={!failed.length}
              onPress={() => failed.forEach(l => l.queued && onRetry(l.queued))}
              accessibilityRole={failed.length ? 'button' : undefined}
            >
              <Icon
                name={failed.length ? 'alert-circle-outline' : isOnline ? 'cloud-upload-outline' : 'cloud-offline-outline'}
                size="sm"
                color={failed.length ? theme.danger : theme.warning}
              />
              <Text style={[s.offlineText, failed.length > 0 && { color: theme.danger }]}>{summary}</Text>
            </TouchableOpacity>
          )}
          {sendError && (
            <View style={s.offlineBanner}>
              <Icon name="alert-circle-outline" size="sm" color={theme.danger} />
              <Text style={[s.offlineText, { color: theme.danger }]}>{sendError}</Text>
            </View>
          )}

          {pinnedLines.length > 0 && (
            <View style={s.pinnedBox}>
              <Text style={s.pinnedLabel}>PINNED INFO</Text>
              {pinnedLines.slice(-2).map(m => (
                <Text key={m.key} style={s.pinnedBody} numberOfLines={2}>
                  {m.body}
                </Text>
              ))}
            </View>
          )}

          <FlatList
            data={lines}
            keyExtractor={item => item.key}
            style={s.list}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.emptyText}>
                No messages yet. Quick replies below work with gloves on, and with no signal.
              </Text>
            }
            renderItem={({ item }) => {
              const delivery = chatDeliveryText(item);
              const waiting = item.delivery === 'waiting_for_signal' || item.delivery === 'failed';
              return (
                <View style={[s.msgRow, item.mine ? s.msgMine : s.msgOther, waiting && s.msgWaiting]}>
                  <Text style={s.msgMeta}>
                    {item.senderName} · {clock(item.writtenAt)}
                  </Text>
                  {item.voice ? (
                    <TouchableOpacity
                      style={s.voiceRow}
                      onPress={() => onPlayVoice?.(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Play voice note, ${formatClipDuration(item.voice.durationMs)}`}
                    >
                      <View style={s.voicePlay}>
                        <Icon name={playingKey === (item.queued?.id ?? item.key) ? 'stop' : 'play'} size="sm" color={theme.onAccent} />
                      </View>
                      <View style={s.voiceWave}>
                        {[6, 12, 18, 10, 16, 8, 14, 20, 9, 15, 7, 12].map((h, i) => (
                          <View key={i} style={[s.voiceBar, { height: h }]} />
                        ))}
                      </View>
                      <Text style={s.voiceTime}>{formatClipDuration(item.voice.durationMs)}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={s.msgBody}>{item.body}</Text>
                  )}
                  {item.lateNote && <Text style={s.msgLate}>{item.lateNote}</Text>}
                  {delivery && (
                    <TouchableOpacity
                      disabled={item.delivery !== 'failed' || !item.queued}
                      onPress={() => item.queued && onRetry(item.queued)}
                      accessibilityLabel={item.delivery === 'failed' ? 'Message failed. Tap to try again.' : `Message ${delivery}`}
                    >
                      <Text style={[s.msgDelivery, { color: deliveryColor(item) }]}>
                        {item.delivery === 'failed' ? `${delivery} · Tap to retry` : delivery}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.quickRow}
            contentContainerStyle={s.quickRowContent}
          >
            {QUICK_REPLY_PRESETS.map(preset => (
              <TouchableOpacity
                key={preset}
                style={s.quickChip}
                onPress={() => void handleSend(preset, 'quick_reply')}
              >
                <Text style={s.quickChipText}>{preset}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {onSendVoice && (
            <View style={{ marginBottom: spacing.sm }}>
              <HoldToTalkButton onRecorded={onSendVoice} onError={setSendError} />
            </View>
          )}

          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={isOnline ? 'Message your pack…' : 'Message your pack (sends when signal returns)'}
              placeholderTextColor={theme.subtle}
              maxLength={1000}
              returnKeyType="send"
              onSubmitEditing={() => void handleSend(draft, 'text')}
            />
            <TouchableOpacity
              style={[s.sendBtn, !draft.trim() && s.disabledChip]}
              disabled={!draft.trim()}
              onPress={() => void handleSend(draft, 'text')}
              accessibilityLabel={isOnline ? 'Send message' : 'Queue message until signal returns'}
            >
              <Icon name="send" size="sm" color={theme.onAccent} />
            </TouchableOpacity>
          </View>
        </View>
    </SheetModal>
  );
}

function makeStyles(theme: ReturnType<typeof useRideTheme>) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      padding: spacing.lg,
      maxHeight: '82%',
      borderTopWidth: 1,
      borderColor: theme.border,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { ...typography.headlineSm, color: theme.text },
    closeBtn: { padding: spacing.xs },
    offlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: theme.surfaceRaised,
      padding: spacing.sm,
      borderRadius: radius.sm,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: theme.warning,
    },
    offlineText: { ...typography.bodySm, color: theme.warning, flex: 1 },
    pinnedBox: {
      backgroundColor: theme.surfaceRaised,
      padding: spacing.sm,
      borderRadius: radius.sm,
      borderLeftWidth: 3,
      borderLeftColor: theme.accent,
      marginBottom: spacing.sm,
    },
    pinnedLabel: { ...typography.labelCaps, color: theme.accent, marginBottom: 2 },
    pinnedBody: { ...typography.bodySm, color: theme.text },
    list: { maxHeight: 280 },
    listContent: { gap: spacing.sm, paddingVertical: spacing.sm },
    emptyText: { ...typography.bodyMd, color: theme.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
    msgRow: { padding: spacing.sm, borderRadius: radius.md, maxWidth: '86%' },
    msgMine: { alignSelf: 'flex-end', backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: theme.accent },
    msgOther: { alignSelf: 'flex-start', backgroundColor: theme.surfaceRaised, borderWidth: 1, borderColor: theme.border },
    msgMeta: { ...typography.bodySm, color: theme.textMuted, fontSize: 11, marginBottom: 2 },
    msgBody: { ...typography.bodyMd, color: theme.text },
    msgWaiting: { borderStyle: 'dashed' },
    voiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, minWidth: 180 },
    voicePlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
    voiceWave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
    voiceBar: { width: 3, borderRadius: 2, backgroundColor: theme.textMuted, opacity: 0.6 },
    voiceTime: { ...typography.bodySm, color: theme.textMuted, fontVariant: ['tabular-nums'] },
    msgLate: { ...typography.bodySm, fontSize: 11, color: theme.textMuted, fontStyle: 'italic', marginTop: 2 },
    msgDelivery: { ...typography.bodySm, fontSize: 11, fontWeight: '700', marginTop: 4, textAlign: 'right' },
    quickRow: { marginVertical: spacing.sm, maxHeight: 44 },
    quickRowContent: { gap: spacing.sm, alignItems: 'center' },
    quickChip: {
      minHeight: 40,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: theme.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.borderStrong,
    },
    quickChipText: { ...typography.bodySm, color: theme.text, fontWeight: '700' },
    disabledChip: { opacity: 0.45 },
    inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    input: {
      flex: 1,
      minHeight: 48,
      backgroundColor: theme.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      color: theme.text,
      borderWidth: 1,
      borderColor: theme.border,
    },
    sendBtn: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
