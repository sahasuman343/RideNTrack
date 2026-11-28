import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { clubRoleLabel } from '@ridentrack/shared';
import { useMyClubs } from '../../hooks/useClubs';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Icon } from '../ui';

/** F15: the rider's clubs on Home, quiet when there are none. */
export function ClubsStrip() {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { enabled, clubs, loaded, refresh } = useMyClubs();
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  if (!enabled || !loaded) return null;

  if (!clubs.length) {
    return (
      <TouchableOpacity style={s.quiet} onPress={() => router.push('/club/new')} accessibilityRole="button">
        <Icon name="people-outline" size="sm" color={theme.tertiary} />
        <Text style={s.quietText}>Ride with the same crew? <Text style={s.quietBold}>Start a club</Text></Text>
        <Icon name="chevron-forward" size="sm" color={theme.textMuted} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.title}>Your clubs</Text>
        <TouchableOpacity onPress={() => router.push('/club/new')} hitSlop={10}><Text style={s.link}>Start one</Text></TouchableOpacity>
      </View>
      {clubs.map(c => (
        <TouchableOpacity key={c.id} style={s.row} onPress={() => router.push(`/club/${c.slug}`)} accessibilityRole="button">
          <View style={s.badge}><Text style={s.badgeText}>{c.name.slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{c.name}{c.verified ? ' ✓' : ''}</Text>
            <Text style={s.meta} numberOfLines={1}>
              {c.next_ride ? `Next: ${c.next_ride.name}` : `${c.member_count} rider${c.member_count === 1 ? '' : 's'}`}
              {c.role !== 'member' ? ` · ${clubRoleLabel(c.role)}` : ''}
            </Text>
          </View>
          <Icon name="chevron-forward" size="sm" color={theme.textMuted} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  wrap: { marginTop: spacing.xl, gap: spacing.xs },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  title: { color: c.text, fontSize: 13, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  link: { color: c.accent, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  badge: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: c.accent, fontSize: 16, fontWeight: '900' },
  name: { color: c.text, fontSize: 15, fontWeight: '700' },
  meta: { color: c.textMuted, fontSize: 12 },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, paddingVertical: spacing.md },
  quietText: { flex: 1, color: c.textMuted, fontSize: 13 },
  quietBold: { color: c.text, fontWeight: '700' },
});
