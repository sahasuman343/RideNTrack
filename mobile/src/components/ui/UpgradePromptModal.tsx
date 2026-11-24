import React, { useMemo } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PAYMENT_CONFIG } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, typography } from '../../theme';
import { Icon } from './Icon';

interface Props {
  visible: boolean;
  featureTitle: string;
  featureDescription: string;
  onClose: () => void;
}

export function UpgradePromptModal({
  visible,
  featureTitle,
  featureDescription,
  onClose,
}: Props) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.badgeRow}>
            <Icon name="ribbon" size="md" color={theme.accent} />
            <Text style={s.badgeText}>PRO TOURER · HOST UNLOCKS GROUP</Text>
          </View>
          <Text style={s.title}>{featureTitle}</Text>
          <Text style={s.body}>{featureDescription}</Text>

          <View style={s.perksBox}>
            <Text style={s.perk}>• Unlimited multi-day expeditions & up to 50 waypoints</Text>
            <Text style={s.perk}>• Up to 50 riders per pack (guests join free)</Text>
            <Text style={s.perk}>• Two-way GPX import/export, pack fuel & ghat advisories</Text>
            <Text style={s.perk}>• Live Family Spectator Link & unlimited ride archive</Text>
          </View>

          <Text style={s.priceNote}>
            Pro Tourer ₹{PAYMENT_CONFIG.monthlyPlanPriceInr}/mo or Expedition Pass ₹{PAYMENT_CONFIG.expeditionPassPriceInr}/trip
          </Text>

          <TouchableOpacity style={s.primaryBtn} onPress={onClose}>
            <Text style={s.primaryBtnText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(theme: ReturnType<typeof useRideTheme>) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'center', padding: spacing.lg },
    card: {
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      gap: spacing.md,
    },
    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    badgeText: { ...typography.labelCaps, color: theme.accent },
    title: { ...typography.headlineMd, color: theme.text },
    body: { ...typography.bodyMd, color: theme.textMuted },
    perksBox: {
      backgroundColor: theme.surfaceRaised,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    perk: { ...typography.bodySm, color: theme.text },
    priceNote: { ...typography.bodySm, color: theme.textMuted, textAlign: 'center' },
    primaryBtn: {
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: { ...typography.titleMd, color: theme.onAccent },
  });
}
