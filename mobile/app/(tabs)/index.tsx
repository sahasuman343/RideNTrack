import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ride, type RiderAnalytics } from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';
import { stopBackgroundLocationUpdates } from '../../src/services/backgroundLocation';

export default function MyRidesScreen() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [communityTrips, setCommunityTrips] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<RiderAnalytics | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingRideId, setDeletingRideId] = useState<string | null>(null);
  const [duplicatingRideId, setDuplicatingRideId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'active' | 'completed' | 'archived' | 'community'>('active');
  const { user } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useFocusEffect(useCallback(() => { void fetchRides(); }, [user?.id]));

  async function fetchRides() {
    if (!user) return;
    const [ridesRes, analyticsRes, communityRes] = await Promise.all([
      supabase
        .from('ride_participants')
        .select('ride_id, rides(id, name, ride_code, origin, destination, status, admin_id, origin_coords, destination_coords, created_at)')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('joined_at', { ascending: false }),
      supabase.rpc('get_rider_analytics'),
      supabase.rpc('get_public_trips', { p_limit: 20, p_offset: 0 }),
    ]);

    if (ridesRes.data) {
      setRides(ridesRes.data.map((p: any) => p.rides).filter(Boolean));
    }
    if (analyticsRes.data) {
      setAnalytics(analyticsRes.data as RiderAnalytics);
    }
    if (communityRes.data) {
      setCommunityTrips(communityRes.data as any[]);
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
                await stopBackgroundLocationUpdates(item.id).catch(() => {});
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
                await stopBackgroundLocationUpdates(item.id).catch(() => {});
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

  function handleDuplicateTrip(item: Ride) {
    Alert.alert(
      'Duplicate Trip?',
      `Create a new planned copy of "${item.name}" with its complete route, waypoints, and itinerary?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Duplicate',
          onPress: async () => {
            setDuplicatingRideId(item.id);
            try {
              const { data, error } = await supabase.rpc('duplicate_trip', {
                p_ride_id: item.id,
              });
              if (error) throw error;
              await fetchRides();
              Alert.alert('Trip Cloned', 'Your new trip is ready.', [
                { text: 'Open Trip', onPress: () => router.push(`/trip/${data}`) },
                { text: 'Later', style: 'cancel' },
              ]);
            } catch (err: any) {
              Alert.alert('Could not duplicate trip', err?.message || 'Please try again.');
            } finally {
              setDuplicatingRideId(null);
            }
          },
        },
      ]
    );
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'active': return '#4CAF50';
      case 'planned': return '#FF9800';
      case 'completed': return '#9E9E9E';
      case 'archived': return '#607D8B';
      default: return '#666';
    }
  }

  const displayedRides = useMemo(() => {
    return rides.filter(r => {
      if (filterTab === 'active') return r.status === 'planned' || r.status === 'active';
      if (filterTab === 'completed') return r.status === 'completed';
      if (filterTab === 'archived') return r.status === 'archived';
      return true;
    });
  }, [rides, filterTab]);

  return (
    <View style={styles.container}>
      <View style={styles.masthead}>
        <View style={styles.mastheadBrand}>
          <Image source={require('../../assets/RnT_logo.png')} style={styles.mastheadLogo} resizeMode="contain" />
          <Text style={styles.kicker}>R I D E N T R A C K</Text>
        </View>
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

      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterTab, filterTab === 'active' && styles.filterTabActive]}
          onPress={() => setFilterTab('active')}
        >
          <Text style={[styles.filterTabText, filterTab === 'active' && styles.filterTabTextActive]}>Active & Planned</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filterTab === 'completed' && styles.filterTabActive]}
          onPress={() => setFilterTab('completed')}
        >
          <Text style={[styles.filterTabText, filterTab === 'completed' && styles.filterTabTextActive]}>Completed</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filterTab === 'archived' && styles.filterTabActive]}
          onPress={() => setFilterTab('archived')}
        >
          <Text style={[styles.filterTabText, filterTab === 'archived' && styles.filterTabTextActive]}>Archived</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filterTab === 'community' && styles.filterTabActive]}
          onPress={() => setFilterTab('community')}
        >
          <Text style={[styles.filterTabText, filterTab === 'community' && styles.filterTabTextActive]}>🌐 Community</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>
        {filterTab === 'community'
          ? `PUBLIC TOURING ROUTES  ·  ${communityTrips.length}`
          : `YOUR JOURNEYS  ·  ${displayedRides.length}`}
      </Text>

      {filterTab === 'community' ? (
        communityTrips.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyMark}>00 / 00</Text>
            <Text style={styles.emptyText}>No community routes yet.</Text>
            <Text style={styles.emptySubtext}>Public itineraries published by touring captains will appear here.</Text>
          </View>
        ) : (
          <FlatList
            data={communityTrips}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.card}
                onPress={() => router.push(`/trip/${item.id}`)}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.rideName}>{item.name}</Text>
                  <TouchableOpacity
                    style={styles.cardActionBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Clone route ${item.name}`}
                    disabled={duplicatingRideId === item.id}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleDuplicateTrip(item);
                    }}
                  >
                    {duplicatingRideId === item.id ? (
                      <ActivityIndicator size="small" color={theme.accent} />
                    ) : (
                      <Text style={styles.cardActionIcon}>📋</Text>
                    )}
                  </TouchableOpacity>
                </View>
                {!!item.description && <Text style={[styles.emptySubtext, { marginTop: 4, textAlign: 'left' }]}>{item.description}</Text>}
                <Text style={styles.route}>{item.origin} → {item.destination}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.code}>
                    {item.waypoint_count} STOPS · {item.estimated_distance_meters ? `${Math.round(item.estimated_distance_meters / 1000)} KM` : 'ROUTE'}
                  </Text>
                  <Text style={styles.openLabel}>BY {item.organizer_name?.toUpperCase() || 'CAPTAIN'} ↗</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )
      ) : displayedRides.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyMark}>01 / 00</Text>
          <Text style={styles.emptyText}>{filterTab === 'archived' ? 'No archived trips.' : 'The road is waiting.'}</Text>
          <Text style={styles.emptySubtext}>
            {filterTab === 'archived'
              ? 'Trips you archive to clean up your log will appear here.'
              : 'Your trips and group rides will find a home here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayedRides}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => {
                if (item.status === 'archived' || item.status === 'planned' || item.status === 'completed') {
                  router.push(`/trip/${item.id}`);
                } else {
                  router.push(`/ride/${item.id}`);
                }
              }}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.rideName}>{item.name}</Text>
                <View style={styles.cardHeaderRight}>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                    <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.cardActionBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Duplicate trip ${item.name}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    disabled={duplicatingRideId === item.id}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleDuplicateTrip(item);
                    }}
                  >
                    {duplicatingRideId === item.id ? (
                      <ActivityIndicator size="small" color={theme.accent} />
                    ) : (
                      <Text style={styles.cardActionIcon}>📋</Text>
                    )}
                  </TouchableOpacity>
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
                <Text style={styles.openLabel}>
                  {item.status === 'archived' ? 'VIEW ARCHIVE ↗' : 'OPEN JOURNEY  ↗'}
                </Text>
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
  mastheadBrand: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  mastheadLogo: { width: 28, height: 28, borderRadius: 7 },
  kicker: { color: c.green, fontSize: 10, fontWeight: '800', letterSpacing: 3 },
  pageTitle: { color: c.text, fontSize: 32, fontWeight: '900', letterSpacing: -1.2, marginTop: 12 },
  intro: { color: c.muted, fontSize: 13, lineHeight: 20, marginTop: 5, maxWidth: 290 },
  quickActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 22, paddingBottom: 24 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 22, paddingBottom: 16 },
  filterTab: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  filterTabActive: { backgroundColor: c.accent, borderColor: c.accent },
  filterTabText: { color: c.muted, fontSize: 11, fontWeight: '700' },
  filterTabTextActive: { color: '#FFFFFF', fontWeight: '800' },
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
  cardActionBtn: { padding: 4, borderRadius: 6, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border },
  cardActionIcon: { fontSize: 12 },
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
