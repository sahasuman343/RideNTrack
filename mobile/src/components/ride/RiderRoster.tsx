import React, { useMemo } from 'react';
import { FlatList, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getRiderLiveStatus, type LocationUpdate, type RideIceContact } from '@ridentrack/shared';
import { useRideTheme } from '../../theme';

interface Props {
  points: LocationUpdate[];
  userId?: string;
  rideStatus: 'planned' | 'active' | 'completed' | 'archived';
  now: number;
  iceByRider: Record<string, RideIceContact>;
  onFocusRider(point: LocationUpdate): void;
}

/** Memo-friendly rider roster extracted from the live map screen. */
export const RiderRoster = React.memo(function RiderRoster({ points, userId, rideStatus, now, iceByRider, onFocusRider }: Props) {
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <FlatList
      data={points}
      style={styles.list}
      keyExtractor={item => item.user_id}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews
      ListEmptyComponent={<Text style={styles.muted}>Rider positions appear after GPS starts. Last known positions remain visible during signal loss.</Text>}
      renderItem={({ item: point }) => {
        const status = getRiderLiveStatus(point, rideStatus, now);
        const ice = iceByRider[point.user_id];
        const disconnected = status.status === 'disconnected';
        return (
          <TouchableOpacity style={styles.row} onPress={() => onFocusRider(point)} accessibilityRole="button" accessibilityLabel={`Focus map on ${point.display_name}`}>
            <View style={[styles.avatar, status.status === 'riding' ? styles.riding : disconnected ? styles.stale : styles.stopped]}>
              <Text style={styles.avatarText}>{(point.display_name?.[0] || 'R').toUpperCase()}</Text>
            </View>
            <View style={styles.grow}>
              <View style={styles.nameRow}>
                <Text style={styles.text}>{point.display_name}{point.user_id === userId ? ' · you' : ''}</Text>
                <View style={[styles.pill, disconnected && styles.pillDisconnected]}><Text style={styles.pillText}>{status.label}</Text></View>
              </View>
              <Text style={styles.muted}>{disconnected ? status.lastSeenText || 'Last known position' : status.status === 'completed' ? 'Ride completed' : 'Live location'}</Text>
              {!!ice && (
                <View style={styles.iceRow}>
                  <Text style={styles.iceText} numberOfLines={1}>ICE{ice.blood_group ? ` · ${ice.blood_group}` : ''}{ice.emergency_contact ? ` · ${ice.emergency_contact}` : ''}</Text>
                  {!!ice.emergency_contact && <TouchableOpacity
                    style={styles.call}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${point.display_name}'s emergency contact`}
                    onPress={event => { event.stopPropagation(); void Linking.openURL('tel:' + ice.emergency_contact); }}
                  ><Text style={styles.callText}>Call</Text></TouchableOpacity>}
                </View>
              )}
            </View>
            <Text style={styles.text}>{status.status === 'riding' ? Math.round((point.speed || 0) * 3.6) + ' km/h' : status.status === 'stopped' ? '0 km/h' : '—'}</Text>
          </TouchableOpacity>
        );
      }}
    />
  );
});

function makeStyles(theme: ReturnType<typeof useRideTheme>) {
  return StyleSheet.create({
    list: { maxHeight: 200, marginVertical: 8 },
    row: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.border },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceHigh },
    riding: { backgroundColor: theme.greenSoft }, stopped: { backgroundColor: theme.accentSoft }, stale: { opacity: 0.6 },
    avatarText: { color: '#fff', fontWeight: '900' }, grow: { flex: 1 }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    text: { color: theme.text, fontWeight: '700' }, muted: { color: theme.textMuted, fontSize: 11 },
    pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.greenSoft },
    pillDisconnected: { backgroundColor: theme.dangerSoft }, pillText: { color: theme.text, fontSize: 9, fontWeight: '800' },
    iceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
    iceText: { flex: 1, color: theme.danger, fontSize: 10, fontWeight: '700' },
    call: { borderWidth: 1, borderColor: theme.danger, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    callText: { color: theme.danger, fontSize: 10, fontWeight: '800' },
  });
}
