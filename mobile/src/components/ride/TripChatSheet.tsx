import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { QUICK_REPLY_PRESETS, type RideMessage, type RideMessageType } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, typography } from '../../theme';
import { Icon } from '../ui';

interface Props {
  visible: boolean;
  onClose: () => void;
  messages: RideMessage[];
  currentUserId?: string;
  isOnline: boolean;
  onSend: (body: string, messageType: RideMessageType) => Promise<void>;
}

export function TripChatSheet({
  visible,
  onClose,
  messages,
  currentUserId,
  isOnline,
  onSend,
}: Props) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const pinnedMessages = useMemo(
    () => messages.filter(m => m.is_pinned || m.message_type === 'pinned_info'),
    [messages],
  );

  async function handleSend(text: string, type: RideMessageType) {
    const trimmed = text.trim();
    if (!trimmed || sending || !isOnline) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(trimmed, type);
      if (type === 'text') setDraft('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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

          {!isOnline && (
            <View style={s.offlineBanner}>
              <Icon name="cloud-offline-outline" size="sm" color={theme.warning} />
              <Text style={s.offlineText}>Offline — sending messages is unavailable until signal returns</Text>
            </View>
          )}
          {sendError && (
            <View style={s.offlineBanner}>
              <Icon name="alert-circle-outline" size="sm" color={theme.danger} />
              <Text style={[s.offlineText, { color: theme.danger }]}>{sendError}</Text>
            </View>
          )}

          {pinnedMessages.length > 0 && (
            <View style={s.pinnedBox}>
              <Text style={s.pinnedLabel}>PINNED INFO</Text>
              {pinnedMessages.slice(-2).map(m => (
                <Text key={m.id} style={s.pinnedBody} numberOfLines={2}>
                  {m.body}
                </Text>
              ))}
            </View>
          )}

          <FlatList
            data={messages}
            keyExtractor={item => item.id}
            style={s.list}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.emptyText}>
                No messages yet. Use quick replies below while stopped or coordinate meetup details here.
              </Text>
            }
            renderItem={({ item }) => {
              const mine = item.sender_id === currentUserId;
              return (
                <View style={[s.msgRow, mine ? s.msgMine : s.msgOther]}>
                  <Text style={s.msgMeta}>
                    {mine ? 'You' : item.sender_name || 'Rider'} ·{' '}
                    {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <Text style={s.msgBody}>{item.body}</Text>
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
                style={[s.quickChip, !isOnline && s.disabledChip]}
                disabled={!isOnline || sending}
                onPress={() => void handleSend(preset, 'quick_reply')}
              >
                <Text style={s.quickChipText}>{preset}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={isOnline ? 'Message your pack…' : 'Offline…'}
              placeholderTextColor={theme.subtle}
              editable={isOnline && !sending}
              maxLength={1000}
            />
            <TouchableOpacity
              style={[s.sendBtn, (!isOnline || !draft.trim() || sending) && s.disabledChip]}
              disabled={!isOnline || !draft.trim() || sending}
              onPress={() => void handleSend(draft, 'text')}
            >
              <Icon name="send" size="sm" color={theme.onAccent} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
