import React, { memo, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  lineHeightFor,
  hapticForTransition,
  selectAttention,
  type AttentionItem,
  type AttentionTone,
} from '@ridentrack/shared';
import { playHaptic } from '../../services/haptics';
import { useLocale } from '../../hooks/useLocale';
import { useRideTheme, type RidePalette, radius, spacing } from '../../theme';
import { Icon } from '../ui';
import type { IconName } from '../ui/Icon';

/*
 * The one place on the live ride screen that asks for the rider's attention.
 * It shows a single item at a time, ranked by shared/attention.ts. A crash
 * countdown takes the whole screen with one cancel target the size of a glove.
 */

const KIND_ICON: Record<AttentionItem['kind'], IconName> = {
  crash_countdown: 'alert-circle',
  incoming_sos: 'warning',
  check_in: 'hand-left-outline',
  regroup: 'flag-outline',
  all_through: 'checkmark-done-outline',
  low_battery: 'battery-dead-outline',
  fuel: 'speedometer-outline',
  hazard: 'warning-outline',
  voice_note: 'mic-outline',
  info: 'information-circle-outline',
};

function toneColors(theme: RidePalette, tone: AttentionTone) {
  switch (tone) {
    case 'danger': return { rail: theme.danger, soft: theme.dangerSoft, ink: theme.danger, onSolid: theme.onDanger };
    case 'warning': return { rail: theme.warning, soft: theme.warningSoft, ink: theme.warning, onSolid: theme.background };
    case 'accent': return { rail: theme.accent, soft: theme.accentSoft, ink: theme.accent, onSolid: theme.onAccent };
    case 'success': return { rail: theme.green, soft: theme.greenSoft, ink: theme.green, onSolid: theme.background };
    default: return { rail: theme.borderStrong, soft: theme.surfaceRaised, ink: theme.text, onSolid: theme.background };
  }
}

export interface RideAttentionBarProps {
  items: AttentionItem[];
  dismissedIds: string[];
  now: number;
  top: number;
  onAction: (item: AttentionItem, actionId: string) => void;
  onDismiss: (item: AttentionItem) => void;
}

export const RideAttentionBar = memo(function RideAttentionBar({ items, dismissedIds, now, top, onAction, onDismiss }: RideAttentionBarProps) {
  const theme = useRideTheme();
  const { t, locale } = useLocale();
  const view = selectAttention(items, { now, dismissedIds });
  const previous = useRef<AttentionItem | null>(null);

  useEffect(() => {
    const pattern = hapticForTransition(previous.current, view.current);
    previous.current = view.current;
    if (pattern !== 'none') void playHaptic(pattern);
  }, [view.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = view.current;
  if (!item) return null;
  const c = toneColors(theme, view.tone);

  if (view.fullScreen) {
    const cancel = item.actions?.[0];
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('attention.tap_anywhere_a11y', { title: item.title })}
        onPress={() => cancel && onAction(item, cancel.id)}
        style={[styles.fullScreen, { backgroundColor: theme.danger }]}
      >
        <Text style={[styles.fullKicker, { color: theme.onDanger }]}>{item.title}</Text>
        {item.countdownSeconds != null && (
          <Text style={[styles.fullCountdown, { color: theme.onDanger }]} accessibilityLiveRegion="assertive">
            {item.countdownSeconds}
          </Text>
        )}
        {item.body ? <Text style={[styles.fullBody, { color: theme.onDanger }, locale === 'hi' && { lineHeight: lineHeightFor('hi', 17) }]}>{item.body}</Text> : null}
        <View style={[styles.fullCancel, { borderColor: theme.onDanger }]}>
          <Text style={[styles.fullCancelText, { color: theme.onDanger }]}>{cancel?.label ?? "I'm OK"}</Text>
          <Text style={[styles.fullHint, { color: theme.onDanger }]}>{t('attention.tap_anywhere')}</Text>
        </View>
        {item.actions && item.actions.length > 1 && (
          <View style={styles.fullSecondaryRow}>
            {item.actions.slice(1).map(a => (
              <TouchableOpacity key={a.id} onPress={() => onAction(item, a.id)} style={[styles.fullSecondary, { borderColor: theme.onDanger }]}>
                <Text style={[styles.fullSecondaryText, { color: theme.onDanger }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityLiveRegion={view.tone === 'danger' ? 'assertive' : 'polite'}
      style={[styles.bar, { top, backgroundColor: theme.surface, borderColor: c.rail, shadowColor: theme.shadow }]}
    >
      <View style={[styles.rail, { backgroundColor: c.rail }]} />
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={[styles.iconWell, { backgroundColor: c.soft }]}>
            <Icon name={KIND_ICON[item.kind]} size="md" color={c.ink} />
          </View>
          <View style={styles.titleCol}>
            <Text style={[styles.title, { color: theme.text }, locale === 'hi' && { lineHeight: lineHeightFor('hi', 17), letterSpacing: 0 }]}>{item.title}</Text>
            {item.body ? <Text style={[styles.body, { color: theme.textMuted }, locale === 'hi' && { lineHeight: lineHeightFor('hi', 14) }]}>{item.body}</Text> : null}
          </View>
          {item.countdownSeconds != null && (
            <Text style={[styles.countdown, { color: c.ink }]} accessibilityLabel={`${item.countdownSeconds} seconds left`}>
              {item.countdownSeconds}
            </Text>
          )}
          {!item.sticky && (
            <TouchableOpacity
              accessibilityLabel="Dismiss"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => onDismiss(item)}
              style={styles.close}
            >
              <Icon name="close" size="md" color={theme.muted} />
            </TouchableOpacity>
          )}
        </View>
        {item.actions && item.actions.length > 0 && (
          <View style={styles.actions}>
            {item.actions.map(a => {
              const solid = a.emphasis === 'primary' || a.emphasis === 'danger';
              const bg = a.emphasis === 'danger' ? theme.danger : solid ? c.rail : 'transparent';
              const fg = a.emphasis === 'danger' ? theme.onDanger : solid ? c.onSolid : theme.text;
              return (
                <TouchableOpacity
                  key={a.id}
                  accessibilityRole="button"
                  onPress={() => onAction(item, a.id)}
                  style={[styles.action, { backgroundColor: bg, borderColor: solid ? bg : theme.borderStrong }]}
                >
                  <Text style={[styles.actionText, { color: fg }]}>{a.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {view.waiting > 0 && (
          <Text style={[styles.waiting, { color: theme.subtle }]}>
            {view.waiting === 1 ? '1 more after this' : `${view.waiting} more after this`}
          </Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    zIndex: 40,
    elevation: 8,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  rail: { width: 6 },
  content: { flex: 1, paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  iconWell: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  titleCol: { flex: 1, minWidth: 0, gap: 2 },
  // No fixed widths and generous line height: Hindi strings are ~30% longer and Devanagari needs room.
  title: { fontSize: 17, fontWeight: '800', lineHeight: 23, letterSpacing: -0.2 },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  countdown: { fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },
  close: { paddingTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    flexGrow: 1,
    minHeight: 52,
    minWidth: 120,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: 15, fontWeight: '800', lineHeight: 20, textAlign: 'center' },
  waiting: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  fullScreen: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
    elevation: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 18,
  },
  fullKicker: { fontSize: 22, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center', lineHeight: 30 },
  fullCountdown: { fontSize: 128, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 136 },
  fullBody: { fontSize: 17, fontWeight: '600', textAlign: 'center', lineHeight: 25, maxWidth: 420 },
  fullCancel: {
    alignSelf: 'stretch',
    minHeight: 160,
    borderRadius: 28,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  fullCancelText: { fontSize: 40, fontWeight: '900', lineHeight: 48 },
  fullHint: { fontSize: 15, fontWeight: '700', opacity: 0.85 },
  fullSecondaryRow: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
  fullSecondary: { flex: 1, minHeight: 56, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  fullSecondaryText: { fontSize: 16, fontWeight: '800' },
});
