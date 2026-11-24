import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { useRideTheme } from '../theme';
import { Icon } from './ui/Icon';
import {
  type ActiveTracking,
  getActiveTracking,
  restoreActiveTracking,
  stopBackgroundLocationUpdates,
  subscribeActiveTracking,
} from '../services/backgroundLocation';

/**
 * Location sharing outlives the live-ride screen, so keep it visible (and
 * stoppable) everywhere else in the app.
 */
export function ActiveRideBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const [tracking, setTracking] = useState<ActiveTracking | null>(getActiveTracking);

  useEffect(() => {
    const unsubscribe = subscribeActiveTracking(setTracking);
    void restoreActiveTracking().then(setTracking).catch(() => {});
    return unsubscribe;
  }, []);

  if (!tracking || !user || tracking.userId !== user.id) return null;
  const rideId = tracking.rideId;

  const confirmStop = () => {
    Alert.alert('Stop sharing your location?', 'Your group will no longer see your position for this ride.', [
      { text: 'Keep sharing', style: 'cancel' },
      {
        text: 'Stop sharing',
        style: 'destructive',
        onPress: () => {
          void stopBackgroundLocationUpdates(rideId).catch(e =>
            Alert.alert('Could not stop sharing', e instanceof Error ? e.message : 'Please try again.'));
        },
      },
    ]);
  };

  return (
    <View style={[styles.bar, { backgroundColor: theme.accentSoft, borderTopColor: theme.border }]}>
      <TouchableOpacity
        style={styles.open}
        onPress={() => router.push(`/ride/${rideId}`)}
        accessibilityRole="button"
        accessibilityLabel="Location sharing is on for your active ride. Open live ride."
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Icon name="location-outline" size="sm" color={theme.accent} />
          <Text style={[styles.text, { color: theme.text, flex: 1 }]} numberOfLines={1}>Sharing your location · Open live ride</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={confirmStop}
        style={styles.stop}
        accessibilityRole="button"
        accessibilityLabel="Stop sharing location"
      >
        <Text style={[styles.stopText, { color: theme.danger }]}>Stop</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingHorizontal: 14, minHeight: 44 },
  open: { flex: 1, paddingVertical: 12 },
  text: { fontSize: 13, fontWeight: '700' },
  stop: { paddingVertical: 12, paddingLeft: 16 },
  stopText: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
});
