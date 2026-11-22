import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ride, type RiderAnalytics } from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';
import { stopBackgroundLocationUpdates } from '../../src/services/backgroundLocation';
import {
  Card,
  StatusBadge,
  SegmentedControl,
  RouteLine,
  Skeleton,
  Button,
  FallbackTripCover,
} from '../../src/components/ui';

export type TripsFilter = 'all' | 'live' | 'planned' | 'past' | 'community';

export default function TripsScreen() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [communityTrips, setCommunityTrips] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<RiderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState({ rides: false, community: false, stats: false });
  const [deletingRideId, setDeletingRideId] = useState<string | null>(null);
  const [duplicatingRideId, setDuplicatingRideId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<TripsFilter>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc'>('date_desc');

  const { user } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const safeHeaderTop = Math.max(topInset, Platform.OS === 'android' ? 44 : 20) + 12;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useFocusEffect(
    useCallback(() => {
      void fetchRides();
    }, [user?.id])
  );

  async function fetchRides() {
    if (!user) return;
    try {
      const [ridesRes, analyticsRes, communityRes] = await Promise.all([
        supabase
          .from('ride_participants')
          .select('ride_id, rides(id, name, ride_code, origin, destination, status, admin_id, origin_coords, destination_coords, start_date, end_date, estimated_distance_meters, created_at)')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('joined_at', { ascending: false }),
        supabase.rpc('get_rider_analytics').then(res => res, error => ({ data: null, error })),
        supabase.rpc('get_public_trips', { p_limit: 20, p_offset: 0 }).then(res => res, error => ({ data: null, error })),
      ]);
      setUnavailable({ rides: !!ridesRes.error, community: !!communityRes.error, stats: !!analyticsRes.error });

      if (ridesRes.data) {
        setRides(ridesRes.data.map((p: any) => p.rides).filter(Boolean));
      }
      if (analyticsRes && 'data' in analyticsRes && analyticsRes.data) {
        setAnalytics(analyticsRes.data as RiderAnalytics);
      }
      if (communityRes && 'data' in communityRes && communityRes.data) {
        setCommunityTrips(communityRes.data as any[]);
      }
    } catch {
      setUnavailable({ rides: true, community: true, stats: true });
    } finally {
      setLoading(false);
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
                await stopBackgroundLocationUpdates(item.id).catch(() => {});
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
                await stopBackgroundLocationUpdates(item.id).catch(() => {});
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
      case 'active':
        return '#4CAF50';
      case 'planned':
        return '#FF9800';
      case 'completed':
        return '#9E9E9E';
      case 'archived':
        return '#607D8B';
      default:
        return '#666';
    }
  }

  const liveTripsCount = useMemo(() => rides.filter(r => r.status === 'active').length, [rides]);
  const plannedTripsCount = useMemo(() => rides.filter(r => r.status === 'planned').length, [rides]);
  const pastTripsCount = useMemo(
    () => rides.filter(r => r.status === 'completed' || r.status === 'archived').length,
    [rides]
  );

  const displayedRides = useMemo(() => {
    let filtered = rides.filter(r => {
      if (filterTab === 'live') return r.status === 'active';
      if (filterTab === 'planned') return r.status === 'planned';
      if (filterTab === 'past') return r.status === 'completed' || r.status === 'archived';
      return true; // 'all'
    });

    // Pinned: Live trips ALWAYS float to top regardless of sort
    filtered.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;

      const dateA = a.start_date ? Date.parse(a.start_date) : Date.parse(a.created_at);
      const dateB = b.start_date ? Date.parse(b.start_date) : Date.parse(b.created_at);

      if (sortBy === 'date_asc') {
        return (Number.isFinite(dateA) ? dateA : 0) - (Number.isFinite(dateB) ? dateB : 0);
      }
      return (Number.isFinite(dateB) ? dateB : 0) - (Number.isFinite(dateA) ? dateA : 0);
    });

    return filtered;
  }, [rides, filterTab, sortBy]);

  const filterOptions = useMemo(
    () => [
      { key: 'all' as TripsFilter, label: 'All', count: rides.length },
      { key: 'live' as TripsFilter, label: 'Live', count: liveTripsCount },
      { key: 'planned' as TripsFilter, label: 'Planned', accessibilityLabel: 'Active & Planned', count: plannedTripsCount },
      { key: 'past' as TripsFilter, label: 'Past', accessibilityLabel: 'Completed', count: pastTripsCount },
      { key: 'archived' as TripsFilter, label: 'Archived', count: pastTripsCount },
      { key: 'community' as TripsFilter, label: 'Community', count: communityTrips.length },
    ],
    [rides.length, liveTripsCount, plannedTripsCount, pastTripsCount, communityTrips.length]
  );

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: safeHeaderTop }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.pageTitle}>Trips</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{rides.length}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => router.push('/join')}
            accessibilityRole="button"
            accessibilityLabel="Join a ride"
          >
            <Text style={styles.headerActionIcon}>↗</Text>
            <Text style={styles.headerActionText}>Join</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerActionBtn, styles.headerActionBtnPrimary]}
            onPress={() => router.push('/create')}
            accessibilityRole="button"
            accessibilityLabel="Plan a trip"
          >
            <Text style={styles.headerActionPrimaryIcon}>＋</Text>
            <Text style={styles.headerActionPrimaryText}>Plan</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Always Visible Segmented Filter */}
      <View style={styles.filterSection}>
        <SegmentedControl
          options={filterOptions}
          selectedKey={filterTab}
          onSelect={k => setFilterTab(k as TripsFilter)}
          scrollable={true}
        />
      </View>

      {/* Optional Sort Bar for Non-Community */}
      {filterTab !== 'community' && rides.length > 1 && (
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>
            {filterTab.toUpperCase()} EXPEDITIONS · {displayedRides.length}
          </Text>
          <TouchableOpacity
            onPress={() => setSortBy(prev => (prev === 'date_desc' ? 'date_asc' : 'date_desc'))}
            style={styles.sortBtn}
            accessibilityRole="button"
            accessibilityLabel={`Sort by date: ${sortBy === 'date_desc' ? 'Newest first' : 'Oldest first'}`}
          >
            <Text style={styles.sortBtnText}>
              Date {sortBy === 'date_desc' ? '↓' : '↑'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {(filterTab === 'community' ? unavailable.community : unavailable.rides || unavailable.stats) && (
        <TouchableOpacity style={styles.analyticsCard} accessibilityRole="button" disabled={refreshing} onPress={() => void onRefresh()}>
          <Text style={styles.tripName}>{refreshing ? 'Refreshing…' : 'Could not refresh. Tap to retry.'}</Text>
          <Text style={styles.tripDesc}>Any displayed results are from the last successful load.</Text>
        </TouchableOpacity>
      )}
      {analytics && filterTab !== 'community' && (filterTab === 'all' || filterTab === 'past' || displayedRides.length > 0) && (
        <View style={styles.analyticsCard}>
          <View style={styles.analyticsStats}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{analytics.total_distance_km} km</Text>
              <Text style={styles.statCaption}>EST. COMPLETED KM</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{analytics.total_hours} hrs</Text>
              <Text style={styles.statCaption}>EST. COMPLETED HOURS</Text>
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

      {/* Loading Skeletons matching exact card shape */}
      {loading ? (
        <View style={styles.skeletonContainer}>
          <Card variant="raised" style={styles.tripCard}>
            <Skeleton height={124} borderRadius={16} style={{ marginBottom: 12 }} />
            <Skeleton height={22} width="65%" style={{ marginBottom: 10 }} />
            <Skeleton height={14} width="100%" style={{ marginBottom: 12 }} />
            <Skeleton height={16} width="45%" />
          </Card>
          <Card variant="raised" style={styles.tripCard}>
            <Skeleton height={124} borderRadius={16} style={{ marginBottom: 12 }} />
            <Skeleton height={22} width="50%" style={{ marginBottom: 10 }} />
            <Skeleton height={14} width="100%" style={{ marginBottom: 12 }} />
            <Skeleton height={16} width="40%" />
          </Card>
        </View>
      ) : filterTab === 'community' ? (
        communityTrips.length === 0 ? !unavailable.community && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🌐</Text>
            <Text style={styles.emptyTitle}>No community routes yet.</Text>
            <Text style={styles.emptySubtext}>
              Public itineraries published by touring captains will appear here.
            </Text>
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: 20, paddingVertical: 4 }}>
              <Text style={styles.sortLabel}>
                PUBLIC TOURING ROUTES · {communityTrips.length}
              </Text>
            </View>
            <FlatList
              data={communityTrips}
              keyExtractor={item => item.id}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
              }
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <Card
                  variant="raised"
                  style={styles.tripCard}
                  onPress={() => router.push(`/trip/${item.id}`)}
                >
                  <FallbackTripCover
                    tripId={item.id}
                    name={item.name}
                    status="planned"
                    elevation={item.estimated_distance_meters ? `${Math.round(item.estimated_distance_meters / 1000)}km` : undefined}
                  />
                  <View style={styles.cardHeader}>
                    <Text style={styles.tripName}>{item.name}</Text>
                    <TouchableOpacity
                      style={styles.cardActionBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Clone route ${item.name}`}
                      disabled={duplicatingRideId === item.id}
                      onPress={e => {
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
                  {!!item.description && (
                    <Text style={styles.tripDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  )}
                  <RouteLine origin={item.origin} destination={item.destination} style={{ marginVertical: 10 }} />
                  <View style={styles.cardFooter}>
                    <Text style={styles.footerMeta}>
                      {item.waypoint_count || 2} STOPS ·{' '}
                      {item.estimated_distance_meters
                        ? `${Math.round(item.estimated_distance_meters / 1000)} KM`
                        : 'ROUTE'}
                    </Text>
                    <Text style={styles.openLabel}>
                      BY {item.organizer_name?.toUpperCase() || 'CAPTAIN'} ↗
                    </Text>
                  </View>
                </Card>
              )}
            />
          </>
        )
      ) : displayedRides.length === 0 ? !unavailable.rides && (
        <View style={styles.empty}>
          <View style={styles.emptyIconCircle}>
            <Text style={styles.emptyIcon}>🏍️</Text>
          </View>
          <Text style={styles.emptyTitle}>
            {filterTab === 'live'
              ? 'No live trips currently on road.'
              : filterTab === 'planned'
              ? 'No upcoming planned trips.'
              : filterTab === 'past'
              ? 'No past trips in your log.'
              : 'The road is waiting.'}
          </Text>
          <Text style={styles.emptySubtext}>
            {filterTab === 'past'
              ? 'Completed and archived journeys will be cataloged here.'
              : 'Plan a solo tour or gather your riding pack for an expedition.'}
          </Text>
          <View style={{ marginTop: 22, width: '100%', maxWidth: 260 }}>
            <Button
              title="＋ Plan a Trip"
              variant="primary"
              size="md"
              onPress={() => router.push('/create')}
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={displayedRides}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isLive = item.status === 'active';
            const km = item.estimated_distance_meters
              ? `${Math.round(item.estimated_distance_meters / 1000)} km`
              : null;
            const dates = item.start_date
              ? item.end_date && item.end_date !== item.start_date
                ? `${item.start_date} → ${item.end_date}`
                : item.start_date
              : null;

            return (
              <Card
                variant={isLive ? 'activeGlow' : 'raised'}
                style={[styles.tripCard, isLive && styles.liveCard]}
                onPress={() => router.push(`/trip/${item.id}`)}
              >
                {/* Fallback Cover with Overlaid Status Badge (Icon + Color) */}
                <FallbackTripCover
                  tripId={item.id}
                  name={item.name}
                  status={item.status}
                  timeTag={dates}
                  elevation={km}
                />

                <View style={styles.cardHeader}>
                  <Text style={styles.tripName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.actionsGroup}>
                    {/* Duplicate Action */}
                    <TouchableOpacity
                      style={styles.cardActionBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Duplicate trip ${item.name}`}
                      disabled={duplicatingRideId === item.id}
                      onPress={e => {
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

                    {/* Delete / Leave Action */}
                    <TouchableOpacity
                      style={[styles.cardActionBtn, styles.cardDeleteBtn]}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete trip ${item.name}`}
                      disabled={deletingRideId === item.id}
                      onPress={e => {
                        e.stopPropagation?.();
                        handleDeleteTrip(item);
                      }}
                    >
                      {deletingRideId === item.id ? (
                        <ActivityIndicator size="small" color={theme.danger} />
                      ) : (
                        <Text style={[styles.cardActionIcon, { color: theme.danger }]}>✕</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Signature Route Line */}
                <RouteLine
                  origin={item.origin}
                  destination={item.destination}
                  style={{ marginVertical: 10 }}
                />

                {/* Footer Metadata */}
                <View style={styles.cardFooter}>
                  <View style={styles.metaCol}>
                    {dates && <Text style={styles.footerDate}>🗓️ {dates}</Text>}
                    {km && <Text style={styles.footerDistance}>📏 {km}</Text>}
                  </View>
                  <Text style={[styles.openAction, isLive && { color: theme.green }]}>
                    {isLive ? 'Enter Live HUD ↗' : 'View Details ↗'}
                  </Text>
                </View>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    pageTitle: {
      fontSize: 28,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.5,
    },
    countBadge: {
      backgroundColor: c.surfaceHigh,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
    },
    countText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textMuted,
    },
    headerActions: {
      flexDirection: 'row',
      gap: 8,
    },
    headerActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
    },
    headerActionText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
    },
    headerActionIcon: {
      fontSize: 13,
      color: c.accent,
      fontWeight: 'bold',
    },
    headerActionBtnPrimary: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    headerActionPrimaryText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#0E1013',
    },
    headerActionPrimaryIcon: {
      fontSize: 13,
      fontWeight: 'bold',
      color: '#0E1013',
    },
    filterSection: {
      marginBottom: 12,
    },
    sortRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 6,
    },
    sortLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: c.textMuted,
    },
    sortBtn: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: c.surfaceHigh,
    },
    sortBtnText: {
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
    },
    analyticsCard: {
      backgroundColor: c.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      marginHorizontal: 20,
      marginBottom: 14,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    analyticsStats: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    statItem: {
      flex: 1,
      alignItems: 'center',
    },
    statNumber: {
      fontSize: 18,
      fontWeight: '800',
      color: c.text,
    },
    statCaption: {
      fontSize: 10,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.5,
      marginTop: 2,
    },
    statDivider: {
      width: 1,
      height: 28,
      backgroundColor: c.border,
    },
    milestonesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    milestonePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.surface,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: c.border,
    },
    milestoneIcon: {
      fontSize: 12,
    },
    milestoneTitle: {
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
    },
    listContent: {
      paddingHorizontal: 20,
      paddingBottom: 32,
      gap: 14,
    },
    tripCard: {
      marginBottom: 2,
    },
    liveCard: {
      borderColor: c.green,
    },
    cardTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    actionsGroup: {
      flexDirection: 'row',
      gap: 6,
    },
    cardActionBtn: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: c.surfaceHigh,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cardDeleteBtn: {
      backgroundColor: c.dangerSoft,
    },
    cardActionIcon: {
      fontSize: 14,
      color: c.text,
    },
    tripName: {
      fontSize: 18,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.2,
    },
    tripDesc: {
      fontSize: 13,
      color: c.textMuted,
      marginTop: 4,
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginTop: 2,
    },
    metaCol: {
      gap: 2,
    },
    footerDate: {
      fontSize: 12,
      color: c.textMuted,
      fontWeight: '500',
    },
    footerDistance: {
      fontSize: 12,
      color: c.textMuted,
      fontWeight: '600',
    },
    footerMeta: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.5,
    },
    openAction: {
      fontSize: 13,
      fontWeight: '700',
      color: c.accent,
    },
    openLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.accent,
      letterSpacing: 0.5,
    },
    skeletonContainer: {
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      paddingVertical: 48,
    },
    emptyIconCircle: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    emptyIcon: {
      fontSize: 32,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: c.text,
      textAlign: 'center',
    },
    emptySubtext: {
      fontSize: 13,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: 6,
      lineHeight: 19,
    },
  });
