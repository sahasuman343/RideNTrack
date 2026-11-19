import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ride, type RiderAnalytics } from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';

export default function MyRidesScreen() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [analytics, setAnalytics] = useState<RiderAnalytics | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingRideId, setDeletingRideId] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useFocusEffect(useCallback(() => { void fetchRides(); }, [user?.id]));

  async function fetchRides() {
    if (!user) return;
    const [ridesRes, analyticsRes] = await Promise.all([
      supabase
        .from('ride_participants')
        .select('ride_id, rides(id, name, ride_code, origin, destination, status, admin_id, origin_coords, destination_coords, created_at)')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('joined_at', { ascending: false }),
      supabase.rpc('get_rider_analytics'),
    ]);

    if (ridesRes.data) {
      setRides(ridesRes.data.map((p: any) => p.rides).filter(Boolean));
    }
    if (analyticsRes.data) {
      setAnalytics(analyticsRes.data as RiderAnalytics);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchRides();
    setRefreshing(false);
  }

  function handleDeleteTrip(item: Ride) {
    const isLeader = item.admin_id === user?.id;
    if (isLeader) {
      Alert.alert(
        'Delete Trip?',
        `Permanently delete "${item.name}"? All routes, waypoints, stages, and records will be deleted.`,
        [
          { text: 'Keep Trip', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setDeletingRideId(item.id);
              try {
                const { error } = await supabase.rpc('delete_trip', { p_ride_id: item.id });
                if (error) throw error;
                setRides(prev => prev.filter(r => r.id !== item.id));
                await fetchRides();
              } catch (err: any) {
                Alert.alert('Could not delete trip', err?.message || 'Please try again.');
              } finally {
                setDeletingRideId(null);
              }
            },
          },
        ]
      );
    } else {
      Alert.alert(
        'Leave Ride?',
        `Remove "${item.name}" from your journeys? You can rejoin anytime with code ${item.ride_code}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: async () => {
              setDeletingRideId(item.id);
              try {
                const { error } = await supabase.rpc('leave_ride', { p_ride_id: item.id });
                if (error) throw error;
                setRides(prev => prev.filter(r => r.id !== item.id));
                await fetchRides();
              } catch (err: any) {
                Alert.alert('Could not leave ride', err?.message || 'Please try again.');
              } finally {
                setDeletingRideId(null);
              }
            },
          },
        ]
      );
    }
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

      {analytics && (
        <View style={styles.analyticsCard}>
          <View style={styles.analyticsStats}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{analytics.total_distance_km} km</Text>
              <Text style={styles.statCaption}>TOTAL DISTANCE</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{analytics.total_hours} hrs</Text>
              <Text style={styles.statCaption}>RIDING HOURS</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{analytics.completed_trips}</Text>
              <Text style={styles.statCaption}>TOURS DONE</Text>
            </View>
          </View>
          {Array.isArray(analytics.milestones) && analytics.milestones.length > 0 && (
            <View style={styles.milestonesRow}>
              {analytics.milestones.map(m => (
                <View key={m.id} style={styles.milestonePill}>
                  <Text style={styles.milestoneIcon}>{m.icon}</Text>
                  <Text style={styles.milestoneTitle}>{m.title}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

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
                <View style={styles.cardHeaderRight}>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                    <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.cardDeleteBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete trip ${item.name}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    disabled={deletingRideId === item.id}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleDeleteTrip(item);
                    }}
                  >
                    {deletingRideId === item.id ? (
                      <ActivityIndicator size="small" color={theme.danger} />
                    ) : (
                      <Text style={styles.cardDeleteIcon}>🗑️</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.route}>{item.origin} → {item.destination}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.code}>RIDE CODE  {item.ride_code}</Text>
                <Text style={styles.openLabel}>OPEN JOURNEY  ↗</Text>
              </View>
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
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardDeleteBtn: { padding: 4, borderRadius: 6, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border },
  cardDeleteIcon: { fontSize: 12 },
  rideName: { color: c.text, fontSize: 18, fontWeight: '800', flex: 1 },
  statusBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  route: { color: c.muted, fontSize: 13, marginTop: 13, lineHeight: 20 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, paddingTop: 11, borderTopWidth: 1, borderTopColor: c.border },
  code: { color: c.green, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  openLabel: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  analyticsCard: { marginHorizontal: 22, marginBottom: 18, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14 },
  analyticsStats: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  statItem: { alignItems: 'center' },
  statNumber: { color: c.text, fontSize: 18, fontWeight: '900' },
  statCaption: { color: c.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 3 },
  statDivider: { width: 1, height: 28, backgroundColor: c.border },
  milestonesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
  milestonePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.surfaceRaised, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4 },
  milestoneIcon: { fontSize: 12 },
  milestoneTitle: { color: c.text, fontSize: 11, fontWeight: '700' },
});
