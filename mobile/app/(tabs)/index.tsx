import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ride } from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';

export default function MyRidesScreen() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useFocusEffect(useCallback(() => { void fetchRides(); }, [user?.id]));

  async function fetchRides() {
    if (!user) return;
    const { data } = await supabase
      .from('ride_participants')
      .select('ride_id, rides(id, name, ride_code, origin, destination, status, admin_id, origin_coords, destination_coords, created_at)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('joined_at', { ascending: false });

    if (data) {
      setRides(data.map((p: any) => p.rides).filter(Boolean));
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchRides();
    setRefreshing(false);
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'active': return '#4CAF50';
      case 'planned': return '#FF9800';
      case 'completed': return '#9E9E9E';
      default: return '#666';
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.masthead}>
        <Text style={styles.kicker}>R I D E N T R A C K</Text>
        <Text style={styles.pageTitle}>Your riding log.</Text>
        <Text style={styles.intro}>Every road has a story. Pick up where you left off.</Text>
      </View>
      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.actionPrimary} onPress={() => router.push('/create')}>
          <Text style={styles.actionPrimaryText}>＋ Plan a trip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionSecondary} onPress={() => router.push('/join')}>
          <Text style={styles.actionSecondaryText}>Join a ride ↗</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sectionLabel}>YOUR JOURNEYS  ·  {rides.length}</Text>
      {rides.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyMark}>01 / 00</Text><Text style={styles.emptyText}>The road is waiting.</Text>
          <Text style={styles.emptySubtext}>Your trips and group rides will find a home here.</Text>
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/ride/${item.id}`)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.rideName}>{item.name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                  <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.route}>{item.origin} → {item.destination}</Text>
              <View style={styles.cardFooter}><Text style={styles.code}>RIDE CODE  {item.ride_code}</Text><Text style={styles.openLabel}>OPEN JOURNEY  ↗</Text></View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  masthead: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 18 },
  kicker: { color: c.green, fontSize: 10, fontWeight: '800', letterSpacing: 3 },
  pageTitle: { color: c.text, fontSize: 32, fontWeight: '900', letterSpacing: -1.2, marginTop: 12 },
  intro: { color: c.muted, fontSize: 13, lineHeight: 20, marginTop: 5, maxWidth: 290 },
  quickActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 22, paddingBottom: 24 },
  actionPrimary: { flex: 1, backgroundColor: c.accent, paddingVertical: 15, paddingHorizontal: 16, borderRadius: 8 },
  actionPrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  actionSecondary: { paddingVertical: 15, paddingHorizontal: 16, borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.surface },
  actionSecondaryText: { color: c.text, fontSize: 13, fontWeight: '700' },
  sectionLabel: { color: c.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.7, paddingHorizontal: 22, paddingBottom: 10 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', padding: 26, margin: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 10 },
  emptyMark: { color: c.accent, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  emptyText: { color: c.text, fontSize: 24, fontWeight: '900', marginTop: 14 },
  emptySubtext: { color: c.muted, fontSize: 14, marginTop: 8, lineHeight: 21 },
  card: { backgroundColor: c.surface, borderRadius: 8, padding: 17, marginBottom: 10, borderWidth: 1, borderColor: c.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rideName: { color: c.text, fontSize: 18, fontWeight: '800', flex: 1 },
  statusBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  route: { color: c.muted, fontSize: 13, marginTop: 13, lineHeight: 20 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, paddingTop: 11, borderTopWidth: 1, borderTopColor: c.border },
  code: { color: c.green, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  openLabel: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
});
