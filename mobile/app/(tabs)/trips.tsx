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
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRideTheme, RidePalette, radius, spacing } from '../../src/theme';
import { useSwipeTab } from '../../src/hooks/useSwipeTab';
import { stopBackgroundLocationUpdates } from '../../src/services/backgroundLocation';
import {
  Card,
  StatusBadge,
  SegmentedControl,
  RouteLine,
  Skeleton,
  Button,
  FallbackTripCover,
  Icon,
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
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [headerBottom, setHeaderBottom] = useState(180);
  const swipeHandlers = useSwipeTab('trips', { ignoreTopArea: true, topBoundary: headerBottom });

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
        return theme.green;
      case 'planned':
        return theme.warning;
      case 'completed':
        return theme.textMuted;
      case 'archived':
        // #607D8B legacy archived color migrated to theme.muted
        return theme.muted;
      default:
        return theme.textMuted;
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
    <View style={styles.container} {...swipeHandlers}>
      {/* Top Header */}
      <View
        style={[styles.header, { paddingTop: safeHeaderTop }]}
        onLayout={e => setHeaderBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.pageTitle}>Trips</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => router.push('/join')}
            accessibilityRole="button"
            accessibilityLabel="Join a ride"
          >
            <Ionicons name="enter-outline" size={16} color={theme.text} />
            <Text style={styles.headerActionText}>Join</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerActionBtn, styles.headerActionBtnPrimary]}
            onPress={() => router.push('/create')}
            accessibilityRole="button"
            accessibilityLabel="Plan a trip"
          >
            <Ionicons name="add" size={18} color={theme.onAccent} />
            <Text style={styles.headerActionPrimaryText}>Plan</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status filters */}
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
            <Icon name={sortBy === 'date_desc' ? 'arrow-down' : 'arrow-up'} size="xs" color={theme.text} />
            <Text style={styles.sortBtnText}>
              Date
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

      {/* Riding summary */}
      {analytics && filterTab !== 'community' && (filterTab === 'all' || filterTab === 'past' || displayedRides.length > 0) && (
        <View style={styles.analyticsCard}>
          <View style={styles.analyticsStats}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{analytics.total_distance_km} km</Text>
              <Text style={styles.statCaption}>EST. COMPLETED KM</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{analytics.total_hours} hrs</Text>
              <Text style={styles.statCaption}>EST. COMPLETED HOURS</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{analytics.completed_trips}</Text>
              <Text style={styles.statCaption}>TOURS DONE</Text>
            </View>
          </View>
          {Array.isArray(analytics.milestones) && analytics.milestones.length > 0 && (
            <View style={styles.milestonesRow}>
              {analytics.milestones.map(m => (
                <View key={m.id} style={styles.milestonePill}>
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
            <Skeleton height={18} width="65%" style={{ marginBottom: 8 }} />
            <Skeleton height={14} width="100%" style={{ marginBottom: 8 }} />
            <Skeleton height={14} width="45%" />
          </Card>
          <Card variant="raised" style={styles.tripCard}>
            <Skeleton height={18} width="50%" style={{ marginBottom: 8 }} />
            <Skeleton height={14} width="100%" style={{ marginBottom: 8 }} />
            <Skeleton height={14} width="40%" />
          </Card>
        </View>
      ) : filterTab === 'community' ? (
        communityTrips.length === 0 ? !unavailable.community && (
          <View style={styles.empty}>
            <Ionicons name="earth-outline" size={36} color={theme.subtle} style={styles.emptyIcon} />
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
                  style={styles.tripCard}
                  onPress={() => router.push(`/trip/${item.id}`)}
                >
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
                        <Ionicons name="copy-outline" size={18} color={theme.textMuted} />
                      )}
                    </TouchableOpacity>
                  </View>
                  {!!item.description && (
                    <Text style={styles.tripDesc} numberOfLines={1}>
                      {item.description}
                    </Text>
                  )}
                  <RouteLine origin={item.origin} destination={item.destination} style={{ marginVertical: 6 }} />
                  <View style={styles.cardFooter}>
                    <Text style={styles.footerMeta}>
                      {item.waypoint_count || 2} STOPS ·{' '}
                      {item.estimated_distance_meters
                        ? `${Math.round(item.estimated_distance_meters / 1000)} KM`
                        : 'ROUTE'}
                    </Text>
                    <Text style={styles.openLabel}>
                      BY {item.organizer_name?.toUpperCase() || 'CAPTAIN'}
                    </Text>
                  </View>
                </Card>
              )}
            />
          </>
        )
      ) : displayedRides.length === 0 ? !unavailable.rides && (
        <View style={styles.empty}>
          <Ionicons name="navigate-circle-outline" size={44} color={theme.subtle} style={styles.emptyIcon} />
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
              title="Plan a Trip"
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
                variant={isLive ? 'activeGlow' : 'default'}
                style={styles.tripCard}
                onPress={() => {
                  setMenuRideId(null);
                  router.push(`/trip/${item.id}`);
                }}
              >
                {/* Header Row: Status Badge + Trip Name + Three-Dot Overflow Trigger */}
                <View style={styles.cardHeader}>
                  <View style={styles.headerLeftCol}>
                    <StatusBadge status={item.status} size="sm" />
                    <Text style={styles.tripName} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.cardMenuTrigger}
                    accessibilityRole="button"
                    accessibilityLabel={`Options for ${item.name}`}
                    onPress={e => {
                      e.stopPropagation?.();
                      setMenuRideId(prev => (prev === item.id ? null : item.id));
                    }}
                  >
                    <Ionicons name="ellipsis-horizontal" size={18} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Overflow actions */}
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
                      <Ionicons name="create-outline" size={18} color={theme.text} style={styles.menuRowIcon} />
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
                          <Ionicons name="copy-outline" size={18} color={theme.text} style={styles.menuRowIcon} />
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
                      <Ionicons name="share-outline" size={18} color={theme.text} style={styles.menuRowIcon} />
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
                          <Ionicons name="trash-outline" size={18} color={theme.danger} style={styles.menuRowIcon} />
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
                  style={{ marginVertical: 6 }}
                />

                {/* Footer Metadata & Contextual Action */}
                <View style={styles.cardFooter}>
                  <View style={styles.metaRow}>
                    {[dates, km, durationText].filter(Boolean).map((value, index) => (
                      <React.Fragment key={index}>
                        {index > 0 && <Text style={styles.footerMeta}>·</Text>}
                        <Text style={index === 0 && dates ? styles.footerDate : styles.footerDistance}>{value}</Text>
                      </React.Fragment>
                    ))}
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
                      <Text style={styles.liveHudBtnText}>Live HUD</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.openAction}>
                      View
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
      paddingHorizontal: spacing.screen,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
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
    headerActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    headerActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: 'transparent',
    },
    headerActionText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.text,
    },
    headerActionBtnPrimary: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    headerActionPrimaryText: {
      fontSize: 14,
      fontWeight: '700',
      color: c.onAccent,
    },
    filterSection: {
      marginBottom: spacing.sm,
    },
    sortRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.xs,
      marginBottom: spacing.xxs,
    },
    sortLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: c.textMuted,
    },
    sortBtn: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    sortBtnText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.text,
    },
    // A plain stat strip between hairlines: summary data, not another floating card.
    analyticsCard: {
      marginHorizontal: spacing.screen,
      marginBottom: spacing.md,
      paddingVertical: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
    },
    analyticsStats: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    statItem: {
      flex: 1,
      alignItems: 'flex-start',
      paddingHorizontal: spacing.sm,
    },
    statNumber: {
      fontSize: 18,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.3,
      fontVariant: ['tabular-nums'],
    },
    statCaption: {
      fontSize: 10,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.6,
      marginTop: spacing.xxs,
    },
    statDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      backgroundColor: c.borderStrong,
    },
    milestonesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    milestonePill: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.xs,
      backgroundColor: c.surfaceRaised,
    },
    milestoneTitle: {
      fontSize: 11,
      fontWeight: '600',
      color: c.text,
    },
    listContent: {
      paddingHorizontal: spacing.screen,
      paddingBottom: 36,
      gap: 10,
    },
    tripCard: {
      borderRadius: radius.lg,
      paddingHorizontal: 15,
      paddingVertical: spacing.md,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xxs,
    },
    headerLeftCol: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flex: 1,
      marginRight: spacing.sm,
    },
    tripName: {
      fontSize: 16,
      fontWeight: '700',
      color: c.text,
      letterSpacing: -0.2,
      flexShrink: 1,
    },
    tripDesc: {
      fontSize: 13,
      color: c.textMuted,
      marginTop: spacing.xxs,
    },
    // 40pt hit area for gloved taps; icon itself stays visually quiet.
    cardMenuTrigger: {
      width: 40,
      height: 40,
      marginRight: -10,
      marginVertical: -8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    overflowMenuOverlay: {
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      paddingVertical: spacing.xs,
      marginVertical: 6,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      paddingHorizontal: spacing.md,
      gap: 10,
    },
    menuRowIcon: {
      width: 20,
    },
    menuRowText: {
      fontSize: 14,
      fontWeight: '500',
      color: c.text,
    },
    cardActionBtn: {
      backgroundColor: 'transparent',
    },
    cardDeleteBtn: {
      backgroundColor: 'transparent',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: spacing.xxs,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
      flex: 1,
      marginRight: spacing.sm,
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
      fontVariant: ['tabular-nums'],
    },
    footerMeta: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.5,
    },
    liveHudBtn: {
      minHeight: 32,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
      backgroundColor: c.green,
    },
    liveHudBtnText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.scheme === 'light' ? c.onAccent : c.background,
    },
    openAction: {
      fontSize: 13,
      fontWeight: '600',
      color: c.accent,
    },
    openLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.accent,
      letterSpacing: 0.5,
    },
    skeletonContainer: {
      paddingHorizontal: spacing.screen,
      paddingTop: spacing.sm,
      gap: 10,
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing.xxxl,
      paddingVertical: 48,
    },
    emptyIcon: {
      marginBottom: spacing.md,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
    },
    emptySubtext: {
      fontSize: 14,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: spacing.sm,
      lineHeight: 21,
      maxWidth: 290,
    },
  });
