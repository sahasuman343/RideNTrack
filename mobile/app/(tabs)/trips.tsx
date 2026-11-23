import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  Share,
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

export type TripsFilter = 'all' | 'live' | 'planned' | 'past' | 'archived' | 'community';

export default function TripsScreen() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [communityTrips, setCommunityTrips] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<RiderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState({ rides: false, community: false, stats: false });
  const [deletingRideId, setDeletingRideId] = useState<string | null>(null);
  const [duplicatingRideId, setDuplicatingRideId] = useState<string | null>(null);
  const [menuRideId, setMenuRideId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<TripsFilter>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc'>('date_desc');

  const { user } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const safeHeaderTop = Math.max(topInset, Platform.OS === 'android' ? 48 : 44) + 18;
  const isDark = theme.background !== '#F8FAFC';
  const styles = useMemo(() => makeStyles(theme, isDark), [theme, isDark]);

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
          .select('ride_id, rides(id, name, ride_code, origin, destination, status, admin_id, origin_coords, destination_coords, start_date, end_date, estimated_distance_meters, estimated_duration_seconds, created_at)')
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
    setMenuRideId(null);
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
    setMenuRideId(null);
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

  function handleShareTrip(item: Ride) {
    setMenuRideId(null);
    const codeLine = item.ride_code ? `Join with code: ${item.ride_code}` : '';
    const shareMessage = `RideNTrack: Join my motorcycle expedition "${item.name}" from ${item.origin} to ${item.destination}! ${codeLine}`.trim();
    void Share.share({ message: shareMessage });
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
      if (filterTab === 'past') return r.status === 'completed';
      if (filterTab === 'archived') return r.status === 'archived';
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

      {/* Selective Frosted Glass Filter Chips */}
      <View style={styles.filterSection}>
        <SegmentedControl
          options={filterOptions}
          selectedKey={filterTab}
          onSelect={k => {
            setFilterTab(k as TripsFilter);
            setMenuRideId(null);
          }}
          scrollable={true}
        />
      </View>

      {/* Sorting Control */}
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

      {/* Network / Refresh Warning */}
      {(filterTab === 'community' ? unavailable.community : unavailable.rides || unavailable.stats) && (
        <TouchableOpacity style={styles.analyticsCard} accessibilityRole="button" disabled={refreshing} onPress={() => void onRefresh()}>
          <Text style={styles.tripName}>{refreshing ? 'Refreshing…' : 'Could not refresh. Tap to retry.'}</Text>
          <Text style={styles.tripDesc}>Any displayed results are from the last successful load.</Text>
        </TouchableOpacity>
      )}

      {/* Glassmorphic Summary Statistics Panel */}
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

      {/* Loading Skeletons */}
      {loading ? (
        <View style={styles.skeletonContainer}>
          <Card variant="raised" style={styles.tripCard}>
            <Skeleton height={140} borderRadius={18} style={{ marginBottom: 12 }} />
            <Skeleton height={22} width="65%" style={{ marginBottom: 10 }} />
            <Skeleton height={14} width="100%" style={{ marginBottom: 12 }} />
            <Skeleton height={16} width="45%" />
          </Card>
          <Card variant="raised" style={styles.tripCard}>
            <Skeleton height={140} borderRadius={18} style={{ marginBottom: 12 }} />
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
                  variant="glass"
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
                    <Text style={styles.tripName} numberOfLines={1}>{item.name}</Text>
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
            const isCompleted = item.status === 'completed' || item.status === 'archived';
            const isPlanned = item.status === 'planned';
            const isMenuOpen = menuRideId === item.id;

            const km = item.estimated_distance_meters
              ? `${Math.round(item.estimated_distance_meters / 1000)} km`
              : null;
            const dates = item.start_date
              ? item.end_date && item.end_date !== item.start_date
                ? `${item.start_date} → ${item.end_date}`
                : item.start_date
              : null;

            // Duration estimation
            const durationText = item.estimated_duration_seconds
              ? `${Math.floor(item.estimated_duration_seconds / 3600)}h ${Math.round((item.estimated_duration_seconds % 3600) / 60)}m`
              : item.estimated_distance_meters
              ? `~${Math.max(1, Math.round(item.estimated_distance_meters / 1000 / 60))} hrs`
              : null;

            return (
              <Card
                variant={isLive ? 'activeGlow' : 'glass'}
                style={[styles.tripCard, isLive && styles.liveCard]}
                onPress={() => {
                  setMenuRideId(null);
                  router.push(`/trip/${item.id}`);
                }}
              >
                {/* 1. HERO PHOTO DESIGN FOR LIVE TRIPS */}
                {isLive ? (
                  <View style={styles.heroSection}>
                    <FallbackTripCover
                      tripId={item.id}
                      name={item.name}
                      status={item.status}
                      hero={true}
                      timeTag={dates}
                      distance={km}
                      elevation="1,450m"
                    />
                    {/* Three-dot menu trigger button on Hero top-right */}
                    <TouchableOpacity
                      style={styles.heroMenuTrigger}
                      accessibilityRole="button"
                      accessibilityLabel={`Options for ${item.name}`}
                      onPress={e => {
                        e.stopPropagation?.();
                        setMenuRideId(prev => (prev === item.id ? null : item.id));
                      }}
                    >
                      <Text style={styles.heroMenuIcon}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* 2. MAP + SUMMARY DESIGN FOR COMPLETED & PLANNED TRIPS */
                  <View style={styles.coverSection}>
                    <FallbackTripCover
                      tripId={item.id}
                      name={item.name}
                      status={item.status}
                      hero={false}
                      timeTag={dates}
                      distance={km}
                      elevation={isCompleted ? '+1,240m' : undefined}
                    />
                  </View>
                )}

                {/* Card Title & Header Row (for Non-Hero or Secondary Header) */}
                {!isLive && (
                  <View style={styles.cardHeader}>
                    <View style={styles.titleCol}>
                      <Text style={styles.tripName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {isPlanned && <Text style={styles.plannedTag}>UPCOMING EXPEDITION</Text>}
                    </View>
                    {/* Clean Three-Dot Overflow Trigger */}
                    <TouchableOpacity
                      style={styles.cardMenuTrigger}
                      accessibilityRole="button"
                      accessibilityLabel={`Options for ${item.name}`}
                      onPress={e => {
                        e.stopPropagation?.();
                        setMenuRideId(prev => (prev === item.id ? null : item.id));
                      }}
                    >
                      <Text style={styles.cardMenuIcon}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Frosted Glass Overflow Action Menu Overlay */}
                {isMenuOpen && (
                  <View style={styles.overflowMenuOverlay}>
                    {/* Edit Option */}
                    <TouchableOpacity
                      style={styles.menuRow}
                      onPress={e => {
                        e.stopPropagation?.();
                        setMenuRideId(null);
                        router.push(`/trip/${item.id}`);
                      }}
                    >
                      <Text style={styles.menuRowIcon}>✏️</Text>
                      <Text style={styles.menuRowText}>View / Edit Trip</Text>
                    </TouchableOpacity>

                    {/* Duplicate Action */}
                    <TouchableOpacity
                      style={[styles.menuRow, styles.cardActionBtn]}
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
                        <>
                          <Text style={styles.menuRowIcon}>📋</Text>
                          <Text style={styles.menuRowText}>Duplicate Trip</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {/* Share Action */}
                    <TouchableOpacity
                      style={styles.menuRow}
                      onPress={e => {
                        e.stopPropagation?.();
                        handleShareTrip(item);
                      }}
                    >
                      <Text style={styles.menuRowIcon}>📤</Text>
                      <Text style={styles.menuRowText}>Share Route</Text>
                    </TouchableOpacity>

                    {/* Delete / Leave Action */}
                    <TouchableOpacity
                      style={[styles.menuRow, styles.cardDeleteBtn]}
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
                        <>
                          <Text style={[styles.menuRowIcon, { color: theme.danger }]}>🗑️</Text>
                          <Text style={[styles.menuRowText, { color: theme.danger }]}>
                            {item.admin_id === user?.id ? 'Permanently delete' : 'Leave Ride'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* Signature Route Visualization */}
                <RouteLine
                  origin={item.origin}
                  destination={item.destination}
                  style={{ marginVertical: 8 }}
                />

                {/* Footer Metadata & Contextual Action */}
                <View style={styles.cardFooter}>
                  <View style={styles.metaCol}>
                    {dates && <Text style={styles.footerDate}>🗓️ {dates}</Text>}
                    <View style={styles.metaPillsRow}>
                      {km && <Text style={styles.footerDistance}>📏 {km}</Text>}
                      {durationText && <Text style={styles.footerDuration}>⏱️ {durationText}</Text>}
                    </View>
                  </View>

                  {/* Contextual Action Button */}
                  {isLive ? (
                    <TouchableOpacity
                      style={styles.liveHudBtn}
                      onPress={e => {
                        e.stopPropagation?.();
                        router.push(`/trip/${item.id}`);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Enter Live HUD for ${item.name}`}
                    >
                      <Text style={styles.liveHudBtnText}>Enter Live HUD ↗</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.openAction}>
                      View Details ↗
                    </Text>
                  )}
                </View>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (c: RidePalette, isDark: boolean) =>
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
      fontSize: 32,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.6,
    },
    countBadge: {
      backgroundColor: isDark ? 'rgba(33, 40, 54, 0.65)' : 'rgba(255, 255, 255, 0.85)',
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(226, 232, 240, 0.9)',
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
      gap: 5,
      backgroundColor: isDark ? 'rgba(23, 29, 39, 0.82)' : 'rgba(255, 255, 255, 0.85)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(226, 232, 240, 0.9)',
      paddingHorizontal: 13,
      paddingVertical: 7.5,
      borderRadius: 12,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.25 : 0.05,
      shadowRadius: 5,
      elevation: 2,
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
      shadowColor: c.accent,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 3,
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
      marginBottom: 10,
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
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.85)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(226, 232, 240, 0.9)',
    },
    sortBtnText: {
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
    },
    analyticsCard: {
      backgroundColor: isDark ? 'rgba(18, 24, 34, 0.72)' : 'rgba(255, 255, 255, 0.82)',
      borderRadius: 22,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.85)',
      padding: 18,
      marginHorizontal: 20,
      marginBottom: 16,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.08,
      shadowRadius: 14,
      elevation: 4,
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
      fontSize: 20,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.3,
    },
    statCaption: {
      fontSize: 10,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.8,
      marginTop: 2,
    },
    statDivider: {
      width: 1,
      height: 28,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
    },
    milestonesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 14,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    },
    milestonePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.92)',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(226, 232, 240, 0.9)',
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
      paddingBottom: 36,
      gap: 16,
    },
    tripCard: {
      marginBottom: 2,
      position: 'relative',
    },
    liveCard: {
      borderColor: isDark ? 'rgba(16, 185, 129, 0.65)' : 'rgba(16, 185, 129, 0.5)',
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.06)' : 'rgba(240, 253, 244, 0.92)',
    },
    heroSection: {
      position: 'relative',
      borderRadius: 18,
      overflow: 'hidden',
    },
    heroMenuTrigger: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.22)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 20,
    },
    heroMenuIcon: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: 'bold',
      lineHeight: 18,
    },
    coverSection: {
      position: 'relative',
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    titleCol: {
      flex: 1,
      marginRight: 8,
    },
    tripName: {
      fontSize: 18,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.2,
    },
    plannedTag: {
      fontSize: 9.5,
      fontWeight: '800',
      color: c.accent,
      letterSpacing: 0.8,
      marginTop: 2,
    },
    tripDesc: {
      fontSize: 13,
      color: c.textMuted,
      marginTop: 4,
    },
    cardMenuTrigger: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    cardMenuIcon: {
      fontSize: 14,
      color: c.text,
      fontWeight: 'bold',
      lineHeight: 16,
    },
    overflowMenuOverlay: {
      backgroundColor: isDark ? 'rgba(20, 26, 36, 0.95)' : 'rgba(255, 255, 255, 0.98)',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)',
      paddingVertical: 6,
      paddingHorizontal: 8,
      marginVertical: 8,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.45 : 0.12,
      shadowRadius: 16,
      elevation: 8,
      gap: 2,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 10,
      gap: 10,
    },
    menuRowIcon: {
      fontSize: 15,
    },
    menuRowText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
    },
    cardActionBtn: {
      backgroundColor: 'transparent',
    },
    cardDeleteBtn: {
      backgroundColor: 'transparent',
    },
    cardActionIcon: {
      fontSize: 14,
      color: c.text,
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 4,
    },
    metaCol: {
      gap: 3,
    },
    metaPillsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
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
    footerDuration: {
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
    liveHudBtn: {
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.18)' : 'rgba(236, 253, 245, 0.95)',
      borderColor: isDark ? 'rgba(16, 185, 129, 0.5)' : 'rgba(16, 185, 129, 0.4)',
      borderWidth: 1.2,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      shadowColor: '#10B981',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.3 : 0.12,
      shadowRadius: 6,
      elevation: 2,
    },
    liveHudBtnText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: c.green,
      letterSpacing: 0.3,
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
      gap: 14,
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      paddingVertical: 48,
    },
    emptyIconCircle: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: isDark ? 'rgba(23, 29, 39, 0.8)' : 'rgba(255, 255, 255, 0.85)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(226, 232, 240, 0.9)',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 18,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.3 : 0.06,
      shadowRadius: 10,
      elevation: 3,
    },
    emptyIcon: {
      fontSize: 34,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: c.text,
      textAlign: 'center',
    },
    emptySubtext: {
      fontSize: 14,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 21,
      maxWidth: 290,
    },
  });
