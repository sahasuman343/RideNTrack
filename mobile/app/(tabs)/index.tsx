import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { loadHomeData, nextPlannedTrip } from '../../src/lib/homeData';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette, radius } from '../../src/theme';
import { useSwipeTab } from '../../src/hooks/useSwipeTab';
import {
  Card,
  Button,
  RouteLine,
  Avatar,
  Skeleton,
  FallbackTripCover,
  Icon,
} from '../../src/components/ui';
import { ClubsStrip } from '../../src/components/club/ClubsStrip';

export default function HomeScreen() {
  const { user, profile } = useAuth();
  return <HomeContent key={user?.id ?? 'signed-out'} userId={user?.id} profile={profile} />;
}

function HomeContent({ userId, profile }: { userId?: string; profile: ReturnType<typeof useAuth>['profile'] }) {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof loadHomeData>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const request = useRef(0);
  const ongoingTrip = snapshot?.ongoingTrip;
  const next = snapshot && nextPlannedTrip(snapshot.planned, new Date(now));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const router = useRouter();
  const theme = useRideTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const safeHeaderTop = Math.max(topInset, Platform.OS === 'android' ? 48 : 44) + 18;
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const swipeHandlers = useSwipeTab('home');

  // Dynamic time-based greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Default motorcycle name
  const motorcycleName = useMemo(() => {
    const make = profile?.motorcycle_make?.trim() || '';
    const model = profile?.motorcycle_model?.trim() || '';
    if (make || model) return `${make} ${model}`.trim();
    return 'No bike added';
  }, [profile?.motorcycle_make, profile?.motorcycle_model]);

  const fetchHomeData = useCallback(async () => {
    const version = ++request.current;
    try {
      if (!userId) throw new Error('Sign in to load your trips.');
      const data = await loadHomeData(userId);
      if (version === request.current) {
        setSnapshot(data);
        setError(data.ongoingTrip && data.members === null ? 'Member count unavailable.' : null);
      }
    } catch (e) {
      if (version === request.current) setError(`Could not load trips. ${e instanceof Error ? e.message : 'Please retry.'}`);
    } finally {
      if (version === request.current) {
        setLoading(false);
        setRefreshing(false);
        setNow(Date.now());
      }
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    void fetchHomeData();
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { ++request.current; clearInterval(timer); };
  }, [fetchHomeData]));

  async function onRefresh() {
    setRefreshing(true);
    await fetchHomeData();
  }

  return (
    <View style={styles.container} {...swipeHandlers}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: safeHeaderTop }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
          />
        }
      >
        {/* Top Header: Time-based Greeting & Steed Pill */}
        <View style={styles.masthead}>
          <View style={styles.greetingCol}>
            <Text style={styles.greetingText}>
              {greeting}, {profile?.display_name || 'Rider'}
            </Text>
            <TouchableOpacity
              style={styles.steedPill}
              onPress={() => router.push('/profile')}
              accessibilityRole="button"
              accessibilityLabel={profile?.motorcycle_model ? `Primary motorcycle: ${motorcycleName}. Tap to open garage.` : 'No motorcycle configured. Tap to add motorcycle in garage.'}
            >
              <Icon name="speedometer-outline" size="sm" color={theme.textMuted} />
              <Text style={styles.steedText} numberOfLines={1}>
                {motorcycleName}
              </Text>
              {!profile?.motorcycle_model && !profile?.motorcycle_make && (
                <Text style={styles.steedAddHint}>+ Add</Text>
              )}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
          >
            <Avatar
              uri={profile?.avatar_url}
              name={profile?.display_name || 'Rider'}
              size={44}
              borderColor={theme.border}
            />
          </TouchableOpacity>
        </View>

        {error && (
          <Card variant="raised">
            <Text accessibilityRole="alert" style={styles.emptySubtitle}>{error}</Text>
            {snapshot && <Text style={styles.emptySubtitle}>Showing trip data from {new Date(snapshot.checkedAt).toLocaleString()}.</Text>}
            <Button title="Retry" onPress={onRefresh} />
          </Card>
        )}
        {loading ? (
          <View style={{ marginTop: 20 }}>
            <Skeleton height={280} borderRadius={24} />
          </View>
        ) : !snapshot ? null : ongoingTrip ? (
          <>
          <Card
            variant="activeGlow"
            style={styles.heroCard}
            onPress={() => router.push(`/trip/${ongoingTrip.id}`)}
            accessibilityLabel={`Active trip: ${ongoingTrip.name}. Tap to open trip details.`}
          >
            {/* Scenic Cover Banner & Elevation Header */}
            <View style={styles.heroCoverWrap}>
              <FallbackTripCover
                tripId={ongoingTrip.id}
                name={ongoingTrip.name}
                status="active"
                stageInfo="Active trip"
              />
            </View>

            {/* Live Indicator Top Row */}
            <View style={styles.heroTopRow}>
              <View style={styles.liveBadgeRow}>
                <Text style={styles.liveBadgeText}>TRIP ACTIVE</Text>
              </View>
              <View style={styles.lastUpdatedPill}>
                <Text style={styles.lastUpdatedText}>
                  Trip data checked {new Date(snapshot.checkedAt).toLocaleString()}
                </Text>
              </View>
            </View>

            {/* Leg / Sector Tag */}
            <Text style={styles.sectorTag}>Riding now</Text>

            {/* Trip Title */}
            <Text style={styles.heroTripName} numberOfLines={1}>
              {ongoingTrip.name}
            </Text>

            {/* Signature Route Line */}
            <RouteLine
              origin={ongoingTrip.origin}
              destination={ongoingTrip.destination}
              style={{ marginVertical: 14 }}
            />

            {/* Telemetry Progress Info */}
            <View style={styles.telemetryStrip}>
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>EST. DISTANCE</Text>
                <Text style={styles.telemetryValue}>
                  {ongoingTrip.estimated_distance_meters != null
                    ? `${Math.round(ongoingTrip.estimated_distance_meters / 1000)} km`
                    : 'Unavailable'}
                </Text>
              </View>
              <View style={styles.telemetryDivider} />
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>TRIP MEMBERS</Text>
                <Text style={styles.telemetryValue}>
                  {snapshot.members ?? 'Unavailable'}
                </Text>
              </View>
            </View>

            {/* Direct Primary Action: Resume Live Tracking */}
            <View style={{ marginTop: 18 }}>
              <Button
                title="Resume Live Tracking"
                variant="primary"
                size="lg"
                iconRight={<Icon name="arrow-forward" size="md" color={theme.onAccent} />}
                onPress={() => router.push(`/ride/${ongoingTrip.id}`)}
                accessibilityLabel="Resume live tracking ride mode"
              />
            </View>
          </Card>
          {ongoingTrip && (
            <View style={styles.toolkitSection}>
              <Text style={styles.toolkitTitle}>RIDER TOOLKIT</Text>
              <View style={styles.toolkitRow}>
                <TouchableOpacity
                  style={styles.toolkitCard}
                  onPress={() => router.push('/create')}
                  accessibilityRole="button"
                  accessibilityLabel="Plan a trip"
                >
                  <View style={[styles.toolkitIconCircle, { backgroundColor: theme.accentSoft }]}>
                    <Icon name="add" size="lg" color={theme.accent} />
                  </View>
                  <Text style={styles.toolkitLabel}>Plan Trip</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.toolkitCard}
                  onPress={() => router.push('/join')}
                  accessibilityRole="button"
                  accessibilityLabel="Join a ride"
                >
                  <View style={[styles.toolkitIconCircle, { backgroundColor: theme.greenSoft }]}>
                    <Icon name="enter-outline" size="md" color={theme.green} />
                  </View>
                  <Text style={styles.toolkitLabel}>Join Ride</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.toolkitCard}
                  onPress={() => router.push('/trips')}
                  accessibilityRole="button"
                  accessibilityLabel="View all trips"
                >
                  <View style={[styles.toolkitIconCircle, { backgroundColor: theme.surfaceHigh }]}>
                    <Icon name="map-outline" size="md" color={theme.text} />
                  </View>
                  <Text style={styles.toolkitLabel}>All Trips</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
        ) : (
          /* ======================================================== */
          /* 2. POLISHED EMPTY STATE (No ongoing ride)                 */
          /* ======================================================== */
          <View style={styles.emptyContainer}>
            <Card variant="raised" style={styles.emptyHeroCard}>
              <View style={styles.radarGraphic}>
                <Icon name="compass-outline" size="xl" color={theme.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No ride in progress</Text>
              <Text style={styles.emptySubtitle}>
                Start a spontaneous group tracking session or plan your next expedition.
              </Text>

              {/* Action Buttons */}
              <View style={styles.emptyActions}>
                <Button
                  title="Plan a trip"
                  variant="primary"
                  size="md"
                  icon={<Icon name="add" size="md" color={theme.onAccent} />}
                  onPress={() => router.push('/create')}
                />
                <Button
                  title="Join a ride"
                  variant="secondary"
                  size="md"
                  icon={<Icon name="enter-outline" size="md" color={theme.text} />}
                  onPress={() => router.push('/join')}
                />
              </View>
            </Card>

            {/* Next Scheduled Trip Line (Quiet, non-intrusive) */}
            {next && (
              <TouchableOpacity
                style={styles.nextTripPill}
                onPress={() => router.push(`/trip/${next.trip.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${next.title}: ${next.trip.name}, ${next.when}. Tap to view.`}
              >
                <Icon name="calendar-outline" size="sm" color={theme.tertiary} />
                <Text style={styles.nextTripText} numberOfLines={1}>
                  {next.title}: <Text style={styles.nextTripBold}>{next.trip.name}</Text>{' '}
                  {next.when}
                </Text>
                <Icon name="chevron-forward" size="sm" color={theme.textMuted} />
              </TouchableOpacity>
            )}

          </View>
        )}
        <ClubsStrip />
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    masthead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    greetingCol: {
      flex: 1,
      marginRight: 12,
    },
    greetingText: {
      fontSize: 26,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.5,
    },
    steedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 14,
      marginTop: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: c.border,
    },
    steedText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textMuted,
    },
    steedAddHint: {
      fontSize: 11,
      fontWeight: '800',
      color: c.accent,
      marginLeft: 2,
    },
    avatarWrap: {
      padding: 2,
    },
    heroCard: {
      padding: 16,
      borderRadius: radius.lg,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
    },
    heroCoverWrap: {
      marginBottom: 12,
      borderRadius: 16,
      overflow: 'hidden',
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    liveBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.greenSoft,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 9999,
    },
    liveBadgeText: {
      fontSize: 12,
      fontWeight: '800',
      color: c.green,
      letterSpacing: 0.6,
    },
    lastUpdatedPill: {
      backgroundColor: c.surfaceHigh,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    lastUpdatedText: {
      fontSize: 11,
      fontWeight: '600',
      color: c.textMuted,
    },
    sectorTag: {
      fontSize: 11,
      fontWeight: '700',
      color: c.accent,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginTop: 14,
    },
    heroTripName: {
      fontSize: 24,
      fontWeight: '900',
      color: c.text,
      letterSpacing: -0.5,
      marginTop: 4,
    },
    telemetryStrip: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginVertical: 10,
      borderWidth: 1,
      borderColor: c.border,
    },
    telemetryItem: {
      flex: 1,
      alignItems: 'center',
    },
    telemetryLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.5,
    },
    telemetryValue: {
      fontSize: 14,
      fontWeight: '800',
      color: c.text,
      marginTop: 2,
    },
    telemetryDivider: {
      width: 1,
      height: 24,
      backgroundColor: c.border,
    },
    emptyContainer: {
      gap: 16,
    },
    emptyHeroCard: {
      alignItems: 'center',
      paddingVertical: 36,
      paddingHorizontal: 20,
      borderRadius: radius.lg,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    radarGraphic: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.surfaceHigh,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: c.text,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontSize: 14,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: 6,
      lineHeight: 20,
      maxWidth: 280,
    },
    emptyActions: {
      flexDirection: 'column',
      width: '100%',
      gap: 10,
      marginTop: 24,
    },
    nextTripPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 9999,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 8,
      alignSelf: 'center',
    },
    nextTripText: {
      fontSize: 12,
      color: c.textMuted,
      fontWeight: '600',
    },
    nextTripBold: {
      color: c.text,
      fontWeight: '800',
    },
    toolkitSection: {
      marginTop: 22,
    },
    toolkitTitle: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: c.textMuted,
      marginBottom: 10,
    },
    toolkitRow: {
      flexDirection: 'row',
      gap: 10,
    },
    toolkitCard: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 14,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    toolkitIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    toolkitLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: c.text,
    },
  });
