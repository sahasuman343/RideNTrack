import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { canManageClub } from '@ridentrack/shared';
import { setRideClub, useMyClubs } from '../../hooks/useClubs';
import { useRideTheme, spacing, type RidePalette } from '../../theme';
import { Icon } from '../ui';

/** F15: on a trip the captain runs, put it in one of the clubs they manage. */
export function ClubRideRow({ rideId, clubId, onChanged }: { rideId: string; clubId: string | null | undefined; onChanged: () => void }) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { enabled, clubs } = useMyClubs();
  const [busy, setBusy] = useState(false);
  const current = clubs.find(c => c.id === clubId) ?? null;
  const manageable = clubs.filter(c => canManageClub(c.role));
  if (!enabled || (!current && !manageable.length)) return null;

  const change = (next: string | null) => {
    setBusy(true);
    setRideClub(rideId, next)
      .then(onChanged)
      .catch(e => Alert.alert('Could not change the club', e instanceof Error ? e.message : 'Try again.'))
      .finally(() => setBusy(false));
  };
  const pick = () => {
    Alert.alert('Club ride', 'Club members see it on the club page.', [
      ...manageable.filter(c => c.id !== clubId).map(c => ({ text: c.name, onPress: () => change(c.id) })),
      ...(clubId ? [{ text: 'Not a club ride', style: 'destructive' as const, onPress: () => change(null) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <View style={s.row}>
      <Icon name="people-outline" size="sm" color={theme.textMuted} />
      <TouchableOpacity style={{ flex: 1 }} disabled={!current} onPress={() => current && router.push(`/club/${current.slug}`)}>
        <Text style={s.text} numberOfLines={1}>{current ? current.name : 'Not a club ride'}</Text>
      </TouchableOpacity>
      {manageable.length > 0 && (
        <TouchableOpacity onPress={pick} disabled={busy} hitSlop={10}>
          <Text style={s.link}>{current ? 'Change' : 'Add to club'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.xs },
  text: { color: c.text, fontSize: 14, fontWeight: '600' },
  link: { color: c.accent, fontSize: 14, fontWeight: '700' },
});
