import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Ride } from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';
import {
  Card,
  LiveDot,
  Button,
  RouteLine,
  Avatar,
  AvatarStack,
  Skeleton,
  FallbackTripCover,
} from '../../src/components/ui';

export default function HomeScreen() {
  const [ongoingTrip, setOngoingTrip] = useState<Ride | null>(null);
  const [nextTrip, setNextTrip] = useState<Ride | null>(null);
  const [activePackCount, setActivePackCount] = useState<number>(0);
  const [lastUpdatedSec, setLastUpdatedSec] = useState<number>(12);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { user, profile } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const safeHeaderTop = Math.max(topInset, Platform.OS === 'android' ? 44 : 20) + 12;
  const styles = useMemo(() => makeStyles(theme), [theme]);

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

  // Relative last updated timer
  useEffect(() => {
    if (!ongoingTrip) return;
    const interval = setInterval(() => {
      setLastUpdatedSec(prev => (prev >= 60 ? 5 : prev + 5));
    }, 5000);
    return () => clearInterval(interval);
  }, [ongoingTrip]);

  useFocusEffect(
    useCallback(() => {
      void fetchHomeData();
    }, [user?.id])
  );

  async function fetchHomeData() {
    if (!user) return;
    try {
      const { data: participantsData } = await supabase
        .from('ride_participants')
        .select('ride_id, rides(*)')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('joined_at', { ascending: false });

      if (participantsData) {
        const userRides: Ride[] = participantsData
          .map((p: any) => p.rides)
          .filter(Boolean);

        // Find active/ongoing trip as hero
        const live = userRides.find(r => r.status === 'active') || null;
        setOngoingTrip(live);

        // Fetch pack count for live trip
        if (live) {
          const { count } = await supabase
            .from('ride_participants')
            .select('*', { count: 'exact', head: true })
            .eq('ride_id', live.id)
            .eq('is_active', true);
          setActivePackCount(count || 1);
        }

        // Find next planned trip
        const todayStr = new Date().toISOString().split('T')[0];
        const upcoming = userRides
          .filter(r => r.status === 'planned')
          .sort((a, b) => {
            const dateA = a.start_date || '9999';
            const dateB = b.start_date || '9999';
            return dateA.localeCompare(dateB);
          });

        setNextTrip(upcoming[0] || null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchHomeData();
    setLastUpdatedSec(2);
    setRefreshing(false);
  }

  // Next trip days calculation
  const nextTripDaysText = useMemo(() => {
    if (!nextTrip?.start_date) return 'in upcoming days';
    const start = new Date(nextTrip.start_date).getTime();
    const diffDays = Math.ceil((start - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    return `in ${diffDays} days`;
  }, [nextTrip?.start_date]);

  return (
    <View style={styles.container}>
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
              <Text style={styles.steedIcon}>🏍️</Text>
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

        {/* Loading Skeleton */}
        {loading ? (
          <View style={{ marginTop: 20 }}>
            <Skeleton height={280} borderRadius={24} />
          </View>
        ) : ongoingTrip ? (
          /* ======================================================== */
          /* 1. ONGOING TRIP HERO (Large, green blinking LED, LIVE HUD) */
          /* ======================================================== */
          <Card
            variant="activeGlow"
            style={styles.heroCard}
            onPress={() => router.push(`/trip/${ongoingTrip.id}`)}
            accessibilityLabel={`Ongoing live trip: ${ongoingTrip.name}. Tap to open trip details.`}
          >
            {/* Scenic Cover Banner & Elevation Header */}
            <View style={styles.heroCoverWrap}>
              <FallbackTripCover
                tripId={ongoingTrip.id}
                name={ongoingTrip.name}
                status="active"
                stageInfo="Live Sector"
                elevation={
                  ongoingTrip.estimated_distance_meters
                    ? `${Math.round(ongoingTrip.estimated_distance_meters / 1000)}km`
                    : 'Tracked'
                }
              />
            </View>

            {/* Live Indicator Top Row */}
            <View style={styles.heroTopRow}>
              <View style={styles.liveBadgeRow}>
                <LiveDot size={8} color={theme.green} />
                <Text style={styles.liveBadgeText}>LIVE HUD</Text>
              </View>
              <View style={styles.lastUpdatedPill}>
                <Text style={styles.lastUpdatedText}>
                  Updated {lastUpdatedSec}s ago
                </Text>
              </View>
            </View>

            {/* Leg / Sector Tag */}
            <Text style={styles.sectorTag}>Active Expedition Sector</Text>

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
                <Text style={styles.telemetryLabel}>DISTANCE</Text>
                <Text style={styles.telemetryValue}>
                  {ongoingTrip.estimated_distance_meters
                    ? `${Math.round(ongoingTrip.estimated_distance_meters / 1000)} km`
                    : 'Tracked'}
                </Text>
              </View>
              <View style={styles.telemetryDivider} />
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>PACK STATUS</Text>
                <Text style={[styles.telemetryValue, { color: theme.green }]}>
                  {activePackCount} {activePackCount === 1 ? 'Rider' : 'Riders'} Live
                </Text>
              </View>
              <View style={styles.telemetryDivider} />
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>DRIFT</Text>
                <Text style={[styles.telemetryValue, { color: theme.textMuted }]}>
                  On Track
                </Text>
              </View>
            </View>

            {/* Pack Avatar Stack */}
            <View style={styles.packRow}>
              <AvatarStack totalCount={activePackCount} maxDisplay={4} size={28} />
              <Text style={styles.packSummaryText}>
                {activePackCount} RIDERS PACK · All Connected
              </Text>
            </View>

            {/* Direct Primary Action: Resume Live Tracking */}
            <View style={{ marginTop: 18 }}>
              <Button
                title="Resume Live Tracking"
                variant="primary"
                size="lg"
                iconRight={<Text style={{ fontSize: 18, color: '#0E1013' }}>→</Text>}
                onPress={() => router.push(`/ride/${ongoingTrip.id}`)}
                accessibilityLabel="Resume live tracking ride mode"
              />
            </View>
          </Card>
        ) : (
          /* ======================================================== */
          /* 2. POLISHED EMPTY STATE (No ongoing ride)                 */
          /* ======================================================== */
          <View style={styles.emptyContainer}>
            <Card variant="raised" style={styles.emptyHeroCard}>
              <View style={styles.radarGraphic}>
                <Text style={styles.radarIcon}>🧭</Text>
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
                  icon={<Text style={{ fontSize: 18, color: '#0E1013' }}>＋</Text>}
                  onPress={() => router.push('/create')}
                />
                <Button
                  title="Join a ride"
                  variant="secondary"
                  size="md"
                  icon={<Text style={{ fontSize: 16, color: theme.text }}>↗</Text>}
                  onPress={() => router.push('/join')}
                />
              </View>
            </Card>

            {/* Next Scheduled Trip Line (Quiet, non-intrusive) */}
            {nextTrip && (
              <TouchableOpacity
                style={styles.nextTripPill}
                onPress={() => router.push(`/trip/${nextTrip.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Next trip: ${nextTrip.name} ${nextTripDaysText}. Tap to view.`}
              >
                <View style={styles.nextTripDot} />
                <Text style={styles.nextTripIcon}>🗓️</Text>
                <Text style={styles.nextTripText} numberOfLines={1}>
                  Next trip: <Text style={styles.nextTripBold}>{nextTrip.name}</Text>{' '}
                  {nextTripDaysText}
                </Text>
                <Text style={styles.nextTripChevron}>›</Text>
              </TouchableOpacity>
            )}

            {/* Fast Standby Telemetry Status Band */}
            <View style={styles.standbyBand}>
              <View style={styles.standbyTile}>
                <Text style={styles.standbyLabel}>Sat Comms</Text>
                <Text style={[styles.standbyVal, { color: theme.green }]}>
                  LOCKED
                </Text>
              </View>
              <View style={styles.standbyTile}>
                <Text style={styles.standbyLabel}>Telemetry</Text>
                <Text style={styles.standbyVal}>STANDBY</Text>
              </View>
              <View style={styles.standbyTile}>
                <Text style={styles.standbyLabel}>Pack Sync</Text>
                <Text style={[styles.standbyVal, { color: theme.accent }]}>
                  Ready
                </Text>
              </View>
            </View>
          </View>
        )}
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
    steedIcon: {
      fontSize: 13,
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
      borderRadius: 24,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 16,
      elevation: 3,
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
    packRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 8,
    },
    packSummaryText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.3,
    },
    emptyContainer: {
      gap: 16,
    },
    emptyHeroCard: {
      alignItems: 'center',
      paddingVertical: 36,
      paddingHorizontal: 20,
      borderRadius: 24,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 2,
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
    radarIcon: {
      fontSize: 28,
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
    nextTripDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: c.tertiary,
    },
    nextTripIcon: {
      fontSize: 13,
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
    nextTripChevron: {
      fontSize: 16,
      color: c.textMuted,
      fontWeight: 'bold',
    },
    standbyBand: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    standbyTile: {
      flex: 1,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingVertical: 10,
      alignItems: 'center',
    },
    standbyLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    standbyVal: {
      fontSize: 13,
      fontWeight: '800',
      color: c.text,
      marginTop: 2,
    },
  });
