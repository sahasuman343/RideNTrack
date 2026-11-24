import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert as Dialog,
  Share,
  Linking,
  Dimensions,
  Platform,
  Image,
  ScrollView,
  TextInput,
  PanResponder,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Camera } from '@rnmapbox/maps';
import {
  type Ride,
  type LocationUpdate,
  type AlertType,
  ALERT_LABELS,
  isStale,
  distanceMeters,
  distanceToRouteMeters,
  buildGoogleMapsNavigationUrl,
  type ExternalNavProvider,
  type RoutePoint,
  getRiderLiveStatus,
  type RiderLiveStatus,
  type RideIceContact,
  calculatePackFormation,
  type PackRiderProgress,
  calculateLiveRideStats,
  type LiveRideStats,
  type MechanicalIssueType,
  MECHANICAL_ISSUE_LABELS,
  type AlertAcknowledgement,
  formatEmergencySms,
  evaluateStationaryOffRouteCheckIn,
  formatMechanicalBreakdownMessage,
  NATIONAL_EMERGENCY_HELPLINES,
  SEEDED_BREAKDOWN_DIRECTORY,
  type VerifiedBreakdownService,
  sendRideMessage,
  type RideMessageType,
  resolveRideEntitlements,
} from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRide } from '../../src/hooks/useRide';
import { useOfflineSync } from '../../src/hooks/useOfflineSync';
import { useRideTrail } from '../../src/hooks/useRideTrail';
import { useRideTheme, RidePalette, typography, elevation, radius, spacing } from '../../src/theme';
import { enqueueAlert, newQueueId } from '../../src/lib/offlineQueue';
import {
  formatNavProviderLabel,
  getDefaultNavProvider,
  getPreferredNavProvider,
  openExternalNavLeg,
  setPreferredNavProvider,
} from '../../src/lib/externalNav';
import { gpsStatus, type TrackerMode } from '../../src/lib/gpsStatus';
import { TripChatSheet } from '../../src/components/ride/TripChatSheet';
import { UpgradePromptModal } from '../../src/components/ui/UpgradePromptModal';
import {
  detachBackgroundLocationCallbacks,
  enableBackgroundLocationUpdates,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from '../../src/services/backgroundLocation';
import { playAlertSound } from '../../src/services/alertSound';
import { registerPushToken } from '../../src/services/pushNotifications';
import { HoldToConfirmButton, Icon, LiveDot } from '../../src/components/ui';
import { ALERT_ICONS, MECHANICAL_ICONS, plainLabel } from '../../src/icons';
import { RiderRoster } from '../../src/components/ride/RiderRoster';

// Graceful keep-awake in ride mode
let useKeepAwake: () => void = () => {};
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const keepAwakeModule = require('expo-keep-awake');
  if (keepAwakeModule && typeof keepAwakeModule.useKeepAwake === 'function') {
    useKeepAwake = keepAwakeModule.useKeepAwake;
  }
} catch {
  // expo-keep-awake optional fallback
}

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
let Mapbox: typeof import('@rnmapbox/maps').default | null = null;
if (MAPBOX_TOKEN) {
  try {
    Mapbox = require('@rnmapbox/maps').default;
    Mapbox?.setAccessToken(MAPBOX_TOKEN);
  } catch {
    /* Native maps are unavailable in Expo Go; the rider panel still works. */
  }
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {
    /* ignore */
  }
}

const SAFETY_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const safetyAlertCooldowns = new Map<string, number>();

export default function LiveRideScreen() {
  useKeepAwake();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const userId = user?.id;
  const name = profile?.display_name || 'Rider';
  const nameRef = useRef(name);
  nameRef.current = name;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useRideTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const sync = useOfflineSync();
  const { ride, participants, alerts, messages, error, publish, refresh, setRide } = useRide(id, userId || '', sync.isOnline);
  const camera = useRef<React.ComponentRef<typeof Camera>>(null);
  const [position, setPosition] = useState<LocationUpdate | null>(null);
  const { geoJson: actualTrailGeoJson, distanceMeters: distanceCoveredMeters } = useRideTrail(id, userId, position);
  const [tracking, setTracking] = useState<TrackerMode>('waiting');
  const gpsSession = useRef(0);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(true);
  const [gpsRetry, setGpsRetry] = useState(0);
  const [backgroundPermissionGranted, setBackgroundPermissionGranted] = useState(false);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy < -20 || gestureState.vy < -0.4) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setExpanded(true);
          } else if (gestureState.dy > 20 || gestureState.vy > 0.4) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setExpanded(false);
          }
        },
      }),
    []
  );

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  };

  const [sheetHeight, setSheetHeight] = useState(320);
  const { height: windowHeight, width: windowWidth } = Dimensions.get('window');
  const active = ride?.status === 'active';
  const rideLoaded = Boolean(ride);

  const cameraPadding = useMemo(() => {
    const maxTop = Math.max(20, Math.floor(windowHeight * 0.25));
    const maxBottom = Math.max(50, Math.floor(windowHeight * 0.45));
    const maxHoriz = Math.max(10, Math.floor(windowWidth * 0.2));
    return {
      paddingTop: Math.min(insets.top + (active ? 155 : 135), maxTop),
      paddingBottom: Math.min(sheetHeight + 28, maxBottom),
      paddingLeft: Math.min(45, maxHoriz),
      paddingRight: Math.min(45, maxHoriz),
    };
  }, [insets.top, sheetHeight, windowHeight, windowWidth, active]);
  const focusRider = useCallback((point: LocationUpdate) => {
    setFollow(false);
    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return;
    try {
      camera.current?.setCamera({ centerCoordinate: [point.lng, point.lat], zoomLevel: 15, padding: cameraPadding, animationDuration: 700 });
    } catch { /* ignore */ }
  }, [cameraPadding]);

  const lastCameraPosition = useRef<{ lat: number; lng: number } | null>(null);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapRetry, setMapRetry] = useState(0);
  const [route, setRoute] = useState<Ride['route_geometry']>();
  const [routeDeviation, setRouteDeviation] = useState<number | null>(null);
  const [lastArrivedWaypoint, setLastArrivedWaypoint] = useState<string | null>(null);
  const [upcomingWaypoints, setUpcomingWaypoints] = useState<Array<{ name: string; latitude: number; longitude: number; provider_place_id?: string | null; sequence: number }>>([]);
  const [targetWaypointIndex, setTargetWaypointIndex] = useState(0);
  const nextWaypoint = upcomingWaypoints[targetWaypointIndex] || null;
  const [regroupPoints, setRegroupPoints] = useState<Array<{ id: string; name: string; latitude: number; longitude: number; sequence: number; my_arrived?: boolean; status?: string; closed_at?: string; total_arrived?: number; total_riders?: number }>>([]);
  const [arrivingRegroupPoint, setArrivingRegroupPoint] = useState<{ id: string; name: string } | null>(null);
  const [sosModal, setSosModal] = useState(false);
  const [announcementModal, setAnnouncementModal] = useState(false);
  const [customAnnouncement, setCustomAnnouncement] = useState('');
  const [captainDashboardVisible, setCaptainDashboardVisible] = useState(false);
  const [mechanicalModalVisible, setMechanicalModalVisible] = useState(false);
  const [selectedMechanicalIssue, setSelectedMechanicalIssue] = useState<MechanicalIssueType>('puncture');
  const [mechanicalDetails, setMechanicalDetails] = useState('');
  const [breakdownDirectoryVisible, setBreakdownDirectoryVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [upgradePromptVisible, setUpgradePromptVisible] = useState(false);
  const [hasActiveSpectatorLink, setHasActiveSpectatorLink] = useState(false);
  const [rideProAccess, setRideProAccess] = useState(false);

  useEffect(() => {
    if (!id || !userId) return;
    let cancelled = false;
    void supabase.rpc('ride_has_pro_access', { p_ride_id: id }).then(({ data }) => {
      if (!cancelled && typeof data === 'boolean') setRideProAccess(data);
    });
    void supabase
      .from('ride_share_links')
      .select('id')
      .eq('ride_id', id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setHasActiveSpectatorLink(Boolean(data && data.length > 0));
      });
    return () => { cancelled = true; };
  }, [id, userId]);

  const entitlements = useMemo(
    () =>
      resolveRideEntitlements({
        userTier: profile?.subscription_tier ?? 'free',
        hasExpeditionPass: rideProAccess,
      }),
    [profile?.subscription_tier, rideProAccess],
  );

  async function shareFamilySpectatorLink(hours = 24) {
    if (!ride || !userId) return;
    if (!entitlements.limits.supportsSpectatorLink) {
      setUpgradePromptVisible(true);
      return;
    }
    try {
      const token = `${ride.id.slice(0, 8)}${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
      const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      const { error: linkErr } = await supabase
        .from('ride_share_links')
        .insert({ ride_id: ride.id, token, created_by: userId, expires_at: expiresAt });
      if (linkErr) throw linkErr;
      setHasActiveSpectatorLink(true);
      await Share.share({
        title: `${ride.name} · Live Family Link`,
        message: `Track our ride live on RideNTrack: https://ridentrack.app/track/${token}`,
      });
    } catch (e: any) {
      Dialog.alert('Could not create spectator link', e?.message || 'Pro Tourer or Expedition Pass required.');
    }
  }

  async function revokeFamilySpectatorLink() {
    if (!ride) return;
    const { error: revErr } = await supabase
      .from('ride_share_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('ride_id', ride.id)
      .is('revoked_at', null);
    if (!revErr) {
      setHasActiveSpectatorLink(false);
      setMessage('All active family spectator links revoked.');
    }
  }
  const [navProvider, setNavProvider] = useState<ExternalNavProvider>(getDefaultNavProvider);

  useEffect(() => {
    void getPreferredNavProvider().then(setNavProvider);
  }, []);

  const [now, setNow] = useState(() => Date.now());
  const [batteryBannerDismissed, setBatteryBannerDismissed] = useState(false);
  const [stationaryCountdown, setStationaryCountdown] = useState<number | null>(null);
  const stationarySinceRef = useRef<number | null>(null);
  const stationaryAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const stationaryCooldownUntilRef = useRef<number>(0);

  useEffect(() => {
    if (!active || !position) {
      stationarySinceRef.current = null;
      stationaryAnchorRef.current = null;
      setStationaryCountdown(null);
      return;
    }
    const nowMs = Date.now();
    const speedKmh = (position.speed || 0) * 3.6;
    const anchor = stationaryAnchorRef.current;
    const moved = anchor ? distanceMeters(anchor, { lat: position.lat, lng: position.lng }) >= 25 : true;
    if (speedKmh >= 2 || moved) {
      stationaryAnchorRef.current = { lat: position.lat, lng: position.lng };
      stationarySinceRef.current = nowMs;
      if (stationaryCountdown !== null) setStationaryCountdown(null);
      return;
    }
    if (!stationarySinceRef.current) {
      stationarySinceRef.current = nowMs;
      return;
    }
    if (nowMs < stationaryCooldownUntilRef.current) return;
    const check = evaluateStationaryOffRouteCheckIn({
      stationaryDurationMs: nowMs - stationarySinceRef.current,
      currentLat: position.lat,
      currentLng: position.lng,
      waypoints: upcomingWaypoints,
    });
    if (check.shouldPrompt && stationaryCountdown === null) {
      setStationaryCountdown(120);
    }
  }, [active, position?.lat, position?.lng, position?.speed, position?.timestamp, now, upcomingWaypoints, stationaryCountdown]);

  useEffect(() => {
    if (stationaryCountdown === null) return;
    if (stationaryCountdown <= 0) {
      setStationaryCountdown(null);
      stationaryCooldownUntilRef.current = Date.now() + 10 * 60 * 1000;
      if (position && userId && ride) {
        void sendAlert('emergency', 'Stationary off-route check-in unanswered — please check on rider.');
      }
      return;
    }
    const t = setTimeout(() => setStationaryCountdown(c => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [stationaryCountdown]);

  async function toggleNavProvider() {
    const next: ExternalNavProvider = navProvider === 'google_maps' ? 'apple_maps' : 'google_maps';
    setNavProvider(next);
    await setPreferredNavProvider(next);
    setMessage(`Maps app set to ${formatNavProviderLabel(next)}`);
  }
  const [breakdownServices, setBreakdownServices] = useState<VerifiedBreakdownService[]>(SEEDED_BREAKDOWN_DIRECTORY);
  const [iceByRider, setIceByRider] = useState<Record<string, RideIceContact>>({});
  const [acknowledgedAlertIds, setAcknowledgedAlertIds] = useState<string[]>([]);
  const [acknowledgementMap, setAcknowledgementMap] = useState<Record<string, { count: number; riders: string[] }>>({});
  const gps = gpsStatus(active && sharing ? tracking : 'paused', position?.timestamp, now);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const gpsRecoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [batterySaver, setBatterySaver] = useState(false);
  const [gpsRecoveryStatus, setGpsRecoveryStatus] = useState<'normal' | 'recovered'>('normal');
  const rideStartTimeMs = useRef<number | null>(null);
  const accumulatedMovingMs = useRef<number>(0);
  const lastCheckTimeMs = useRef<number>(Date.now());
  const maxSpeedKmh = useRef<number>(0);
  const currentAltitudeMeters = useRef<number | null>(null);
  const elevationGainMeters = useRef<number>(0);
  const admin = ride?.admin_id === userId;

  const points = useMemo(() => (position && active ? [...participants.filter(p => p.user_id !== userId), position] : participants), [participants, position, active, userId]);

  const packFormation = useMemo(() => {
    const routeCoords = route?.geometry?.coordinates;
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) return [];
    return calculatePackFormation(points, routeCoords, ride?.rider_behind_threshold_meters || 1000);
  }, [points, route?.geometry?.coordinates, ride?.rider_behind_threshold_meters]);

  const animated = points;
  const features = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: animated
      .filter(p => typeof p?.lng === 'number' && typeof p?.lat === 'number' && Number.isFinite(p.lng) && Number.isFinite(p.lat))
      .map(p => {
        const liveStatus = getRiderLiveStatus(p, ride?.status, now);
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
          properties: {
            name: p.display_name || 'Rider',
            mine: p.user_id === userId,
            stale: liveStatus.status === 'disconnected',
            status: liveStatus.status,
          },
        };
      }),
  }), [animated, userId, now, ride?.status]);

  const newest = alerts.find(a => a.user_id !== userId && !dismissed.includes(a.id) && now - Date.parse(a.created_at) < 300000);
  const lastPlayedAlertId = useRef<string | null>(null);

  useEffect(() => {
    if (newest && newest.id !== lastPlayedAlertId.current) {
      lastPlayedAlertId.current = newest.id;
      void playAlertSound(newest.type === 'emergency');
    }
  }, [newest?.id, newest?.type]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Ask for notification permission in context: SOS and regroup alerts must
  // reach this rider while the phone is locked in a tank bag.
  useEffect(() => {
    if (!active || !userId) return;
    void registerPushToken(userId, { prompt: true }).catch(e => console.warn('Push registration failed:', e));
  }, [active, userId]);

  useEffect(() => {
    if (!id || !active || !userId) { setIceByRider({}); return; }
    let cancelled = false;
    void supabase.rpc('get_ride_ice_contacts', { p_ride_id: id }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setMessage(error.message); return; }
      setIceByRider(Object.fromEntries(((data || []) as RideIceContact[]).map(contact => [contact.user_id, contact])));
    });
    return () => { cancelled = true; };
  }, [id, active, userId]);

  // Reserve the cooldown synchronously and keep it outside the component so
  // reopening the ride screen cannot re-send the same safety alert.
  const publishSafetyAlert = async (key: string, type: AlertType, lat: number, lng: number, alertMsg: string) => {
    if (!userId) return;
    const cooldownKey = id + ':' + userId + ':' + key;
    const nowMs = Date.now();
    if (nowMs - (safetyAlertCooldowns.get(cooldownKey) || 0) < SAFETY_ALERT_COOLDOWN_MS) return;
    safetyAlertCooldowns.set(cooldownKey, nowMs);
    try {
      await enqueueAlert({ id: await newQueueId(), ride_id: id, user_id: userId, type, lat, lng, message: alertMsg, created_at: new Date(nowMs).toISOString() });
      void sync.flushQueue();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not publish a group safety alert.');
    }
  };

  // Route deviation depends only on this rider's own fix; it does not need to
  // rerun on clock ticks or other riders' presence updates.
  useEffect(() => {
    if (!active || !position || !userId || isStale(position.timestamp) || !ride) return;
    const routeCoordinates = route?.geometry?.coordinates;
    if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      setRouteDeviation(null);
      return;
    }
    const deviation = distanceToRouteMeters(position, routeCoordinates);
    const limit = ride.route_deviation_threshold_meters || 500;
    setRouteDeviation(deviation);
    if (deviation > limit) {
      void publishSafetyAlert(
        'route-deviation',
        'route_deviation',
        position.lat,
        position.lng,
        'Rider is approximately ' + Math.round(deviation) + ' m from the planned route (threshold ' + limit + ' m).'
      );
    }
  }, [active, position, route, ride?.id, ride?.route_deviation_threshold_meters, userId, id]);

  // Only the leader broadcasts "rider behind" so each gap produces one group
  // alert. It also covers riders whose app is backgrounded. A lagging rider
  // gets a local notice instead of a duplicate broadcast.
  useEffect(() => {
    if (!active || !position || !userId || isStale(position.timestamp, now) || !ride) return;
    const limit = ride.rider_behind_threshold_meters || 1000;
    if (admin) {
      for (const rider of participants) {
        if (rider.user_id === ride.admin_id || rider.user_id === userId || isStale(rider.timestamp, now)) continue;
        if (!Number.isFinite(rider.lat) || !Number.isFinite(rider.lng)) continue;
        const gap = distanceMeters(position, rider);
        if (gap > limit) {
          void publishSafetyAlert(
            'rider-behind-' + rider.user_id,
            'rider_behind',
            rider.lat,
            rider.lng,
            rider.display_name + ' is approximately ' + Math.round(gap) + ' m from the leader (threshold ' + limit + ' m).'
          );
        }
      }
      return;
    }
    const leader = participants.find(point => point.user_id === ride.admin_id && !isStale(point.timestamp, now));
    if (!leader || !Number.isFinite(leader.lat) || !Number.isFinite(leader.lng)) return;
    const gap = distanceMeters(leader, position);
    const cooldownKey = id + ':' + userId + ':rider-behind-self';
    if (gap > limit && now - (safetyAlertCooldowns.get(cooldownKey) || 0) >= SAFETY_ALERT_COOLDOWN_MS) {
      safetyAlertCooldowns.set(cooldownKey, now);
      setMessage('You are approximately ' + Math.round(gap) + ' m from the leader (threshold ' + limit + ' m).');
    }
  }, [active, position, participants, ride?.id, ride?.admin_id, ride?.rider_behind_threshold_meters, admin, userId, id, now]);

  useEffect(() => {
    setPosition(null);
    setGpsError(null);
    setBackgroundPermissionGranted(false);
    setGpsRecoveryStatus('normal');
    // Wait for the ride to load: a null ride is "unknown", not "inactive",
    // and must not stop a tracker that is already sharing this ride.
    if (!userId || !rideLoaded) {
      setTracking('waiting');
      return;
    }
    if (!active || !sharing) {
      setTracking('paused');
      void stopBackgroundLocationUpdates(id).catch(e => setGpsError(e.message));
      return;
    }
    let cancelled = false;
    setTracking('waiting');
    void startBackgroundLocationUpdates({
      rideId: id,
      userId,
      displayName: nameRef.current,
      publish,
      batterySaver,
      onLocationUpdate: p => {
        if (!cancelled) { setNow(Date.now()); setPosition(p); }
      },
      onError: e => {
        if (!cancelled) setGpsError(e);
      },
      onAutoStop: () => {
        if (!cancelled) {
          setSharing(false);
          setTracking('paused');
        }
      },
      onGpsRecovered: () => {
        if (!cancelled) {
          setGpsRecoveryStatus('recovered');
          if (gpsRecoveryTimer.current) clearTimeout(gpsRecoveryTimer.current);
          gpsRecoveryTimer.current = setTimeout(() => {
            gpsRecoveryTimer.current = null;
            if (!cancelled) setGpsRecoveryStatus('normal');
          }, 6000);
        }
      },
    })
      .then(result => {
        if (cancelled) return;
        setTracking(result.mode === 'stopped' ? 'paused' : result.mode);
        if (result.mode === 'background') setBackgroundPermissionGranted(true);
      })
      .catch(e => {
        if (!cancelled) {
          setTracking('error');
          setGpsError(e.message);
        }
      });
    return () => {
      cancelled = true;
      ++gpsSession.current;
      if (gpsRecoveryTimer.current) {
        clearTimeout(gpsRecoveryTimer.current);
        gpsRecoveryTimer.current = null;
      }
      // Leaving the screen keeps sharing; only explicit actions stop it.
      detachBackgroundLocationCallbacks(id);
    };
  }, [id, userId, rideLoaded, active, sharing, publish, gpsRetry, batterySaver]);

  useEffect(() => {
    if (mapReady && follow && position && camera.current) {
      if (typeof position.lng === 'number' && typeof position.lat === 'number' && Number.isFinite(position.lng) && Number.isFinite(position.lat)) {
        const last = lastCameraPosition.current;
        if (last && Math.abs(position.lat - last.lat) < 0.00002 && Math.abs(position.lng - last.lng) < 0.00002) {
          return;
        }
        lastCameraPosition.current = { lat: position.lat, lng: position.lng };
        try {
          camera.current.setCamera({
            centerCoordinate: [position.lng, position.lat],
            zoomLevel: 14,
            padding: cameraPadding,
            animationMode: 'easeTo',
            animationDuration: 800,
          });
        } catch {
          /* Ignore transient camera update error */
        }
      }
    }
  }, [mapReady, follow, position, cameraPadding]);

  useEffect(() => {
    let cancelled = false;
    setUpcomingWaypoints([]);
    setTargetWaypointIndex(0);
    void supabase
      .from('trip_waypoints')
      .select('name,latitude,longitude,provider_place_id,sequence')
      .eq('ride_id', id)
      .neq('waypoint_type', 'origin')
      .order('sequence', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && Array.isArray(data)) setUpcomingWaypoints(data);
      });
    void supabase.rpc('get_regroup_points', { p_ride_id: id }).then(({ data, error }) => {
      if (cancelled) return;
      if (!error && Array.isArray(data)) setRegroupPoints(data as any);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!position || regroupPoints.length === 0) {
      setArrivingRegroupPoint(null);
      return;
    }
    const nearest = regroupPoints.find(rp => (!rp.status || rp.status === 'open') && !rp.my_arrived && distanceMeters(position, { lat: rp.latitude, lng: rp.longitude }) < 300);
    setArrivingRegroupPoint(nearest ? { id: nearest.id, name: nearest.name } : null);
  }, [position?.lat, position?.lng, regroupPoints]);

  useEffect(() => {
    if (!position || !nextWaypoint || targetWaypointIndex >= upcomingWaypoints.length - 1) return;
    const distance = distanceMeters(position, { lat: nextWaypoint.latitude, lng: nextWaypoint.longitude });
    if (distance < 250) {
      const arrivedName = nextWaypoint.name;
      setLastArrivedWaypoint(arrivedName);
      setTargetWaypointIndex(curr => Math.min(curr + 1, upcomingWaypoints.length - 1));
      const timer = setTimeout(() => setLastArrivedWaypoint(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [position?.lat, position?.lng, nextWaypoint?.latitude, nextWaypoint?.longitude, targetWaypointIndex, upcomingWaypoints.length]);

  const distanceToNextStopMeters = useMemo(() => {
    if (!position || !nextWaypoint) return null;
    return Math.round(distanceMeters(position, { lat: nextWaypoint.latitude, lng: nextWaypoint.longitude }));
  }, [position?.lat, position?.lng, nextWaypoint?.latitude, nextWaypoint?.longitude]);

  const currentSpeedKmh = gps.state === 'fresh' && position ? Math.round(position.speed * 3.6) : '—';

  useEffect(() => {
    if (!position) return;
    if (!rideStartTimeMs.current) rideStartTimeMs.current = Date.now();
    const nowMs = Date.now();
    const deltaMs = nowMs - lastCheckTimeMs.current;
    lastCheckTimeMs.current = nowMs;
    const speedKmh = (position.speed || 0) * 3.6;
    if (speedKmh >= 5) {
      accumulatedMovingMs.current += deltaMs;
    }
    if (speedKmh > maxSpeedKmh.current && speedKmh <= 220) {
      maxSpeedKmh.current = Math.round(speedKmh * 10) / 10;
    }
  }, [position]);

  const liveStats = useMemo(() => {
    return calculateLiveRideStats({
      rideStartTimeMs: rideStartTimeMs.current,
      currentTimeMs: now,
      accumulatedMovingMs: accumulatedMovingMs.current,
      lastMovingCheckMs: lastCheckTimeMs.current,
      currentSpeedMps: position?.speed,
      distanceCoveredMeters,
      maxSpeedKmh: maxSpeedKmh.current,
      currentAltitudeMeters: currentAltitudeMeters.current,
      elevationGainMeters: elevationGainMeters.current,
      participants,
      currentUserId: userId,
    });
  }, [now, position?.speed, distanceCoveredMeters, participants, userId]);

  async function navigateToNextWaypoint() {
    if (!nextWaypoint) return;
    try {
      if (position && Number.isFinite(position.lat) && Number.isFinite(position.lng)) {
        const remaining = upcomingWaypoints.slice(targetWaypointIndex);
        const legPoints: RoutePoint[] = [
          {
            sequence: 0,
            waypoint_type: 'origin',
            name: 'Current Location',
            latitude: position.lat,
            longitude: position.lng,
          },
          ...remaining.map((wp, idx) => ({
            sequence: idx + 1,
            waypoint_type: (idx === remaining.length - 1 ? 'destination' : 'stop') as RoutePoint['waypoint_type'],
            name: wp.name,
            latitude: wp.latitude,
            longitude: wp.longitude,
            provider_place_id: wp.provider_place_id,
          })),
        ];

        const result = await openExternalNavLeg(legPoints, navProvider);
        if (result.legCount > 1) {
          setMessage(`Opened leg 1 of ${result.legCount} in ${formatNavProviderLabel(result.provider)}`);
        }
        return;
      }

      await Linking.openURL(
        buildGoogleMapsNavigationUrl({
          latitude: nextWaypoint.latitude,
          longitude: nextWaypoint.longitude,
          placeId: nextWaypoint.provider_place_id,
        })
      );
    } catch (e: any) {
      Dialog.alert('Could not open navigation', e?.message || 'Please check that a maps app is available and try again.');
    }
  }

  useEffect(() => {
    if (ride?.route_geometry) {
      setRoute(ride.route_geometry);
      return;
    }
    if (!ride || !Array.isArray(ride.origin_coords) || !Array.isArray(ride.destination_coords) || !MAPBOX_TOKEN) return;
    const controller = new AbortController();
    const load = async () => {
      const response = await fetch(
        'https://api.mapbox.com/directions/v5/mapbox/driving/' +
          ride.origin_coords.join(',') +
          ';' +
          ride.destination_coords.join(',') +
          '?geometries=geojson&overview=simplified&access_token=' +
          MAPBOX_TOKEN,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error('Route unavailable. Rider positions still work.');
      const data = await response.json();
      if (!data.routes?.[0]) throw new Error('No driving route found.');
      const geo: NonNullable<Ride['route_geometry']> = { type: 'Feature', geometry: data.routes[0].geometry, properties: {} };
      if (controller.signal.aborted) return;
      setRoute(geo);
      if (admin) {
        const { error } = await supabase.from('rides').update({ route_geometry: geo }).eq('id', id);
        if (error) throw error;
      }
    };
    void load().catch(e => {
      if (!controller.signal.aborted) setMessage(e.message);
    });
    return () => controller.abort();
  }, [ride?.id, ride?.route_geometry, admin, id]);

  function fitGroup() {
    setFollow(false);
    const coords = points.length
      ? points.map(p => [p.lng, p.lat])
      : ride && Array.isArray(ride.origin_coords) && Array.isArray(ride.destination_coords)
      ? [ride.origin_coords, ride.destination_coords]
      : [];
    const validCoords = coords.filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!validCoords.length) return;
    try {
      if (validCoords.every(p => p[0] === validCoords[0][0] && p[1] === validCoords[0][1])) {
        camera.current?.setCamera({ centerCoordinate: validCoords[0], zoomLevel: 14, padding: cameraPadding, animationMode: 'easeTo', animationDuration: 800 });
        return;
      }
      camera.current?.fitBounds(
        [Math.max(...validCoords.map(p => p[0])), Math.max(...validCoords.map(p => p[1]))],
        [Math.min(...validCoords.map(p => p[0])), Math.min(...validCoords.map(p => p[1]))],
        [cameraPadding.paddingTop, 45, cameraPadding.paddingBottom, 45],
        800
      );
    } catch {
      /* Ignore camera bounds error */
    }
  }

  async function enableBackgroundGps() {
    if (!userId || tracking !== 'foreground' || !sharing || !active) return;
    const session = gpsSession.current;
    setGpsError(null);
    setMessage(null);
    let startupFailed = false;
    try {
      const result = await enableBackgroundLocationUpdates({
        rideId: id,
        userId,
        displayName: name,
        publish,
        batterySaver,
        onLocationUpdate: p => {
          if (session === gpsSession.current) { setNow(Date.now()); setPosition(p); }
        },
        onError: error => {
          if (session !== gpsSession.current) return;
          startupFailed = true;
          setGpsError(error);
        },
      });
      if (session !== gpsSession.current) return;
      setTracking(result.mode === 'stopped' ? 'error' : result.mode);
      if (result.mode === 'background') {
        setBackgroundPermissionGranted(true);
        setMessage(null);
      } else if (result.permissionGranted && !startupFailed) {
        setBackgroundPermissionGranted(true);
        setMessage('Background permission granted. Tap Start background GPS again to activate it.');
      } else if (!startupFailed && !result.permissionGranted) {
        setMessage('Background permission was not granted. Keep the app open for foreground GPS.');
      }
    } catch (e) {
      if (session !== gpsSession.current) return;
      setGpsError(e instanceof Error ? e.message : 'Android could not enable background GPS.');
    }
  }

  async function changeStatus(status: 'active' | 'completed') {
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.from('rides').update({ status }).eq('id', id).select().single();
      if (error) throw error;
      setRide(data as Ride);
      if (status === 'completed') {
        await stopBackgroundLocationUpdates(id);
        await sync.flushQueue();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not update ride.');
    } finally {
      setBusy(false);
    }
  }

  async function sendAlert(type: AlertType, customMessage?: string): Promise<'sent' | 'queued' | 'failed'> {
    if (!position || !userId || isStale(position.timestamp)) {
      setMessage('Wait for a fresh GPS fix before sending an alert.');
      return 'failed';
    }
    setBusy(true);
    try {
      const alert = { id: await newQueueId(), ride_id: id, user_id: userId, type, message: customMessage, lat: position.lat, lng: position.lng, created_at: new Date().toISOString() };
      if (sync.isOnline) {
        const { error, status } = await supabase.from('alerts').upsert(alert, { onConflict: 'id', ignoreDuplicates: true });
        if (!error) {
          setModal(false);
          void refresh();
          return 'sent';
        }
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          setMessage(error.message);
          return 'failed';
        }
      }
      await enqueueAlert(alert);
      setModal(false);
      void sync.updateCounts().catch(() => {});
      setMessage('Alert queued for delivery.');
      return 'queued';
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save alert.');
      return 'failed';
    } finally {
      setBusy(false);
    }
  }

  async function broadcastAnnouncement(msg: string): Promise<boolean> {
    if (!msg || !msg.trim()) return false;
    const outcome = await sendAlert('announcement', msg.trim());
    if (outcome === 'sent') {
      setAnnouncementModal(false);
      setCustomAnnouncement('');
      setMessage(`Broadcast sent: "${msg.trim()}"`);
      return true;
    }
    return false;
  }

  async function confirmArrival(regroupPointId: string) {
    setBusy(true);
    try {
      const { error: confirmError } = await supabase.rpc('confirm_regroup_arrival', { p_regroup_point_id: regroupPointId });
      if (confirmError) throw confirmError;
      setRegroupPoints(prev => prev.map(p => (p.id === regroupPointId ? { ...p, my_arrived: true } : p)));
      setArrivingRegroupPoint(null);
      setMessage('Confirmed arrival at regroup point.');
    } catch (e: any) {
      setMessage(e?.message || 'Could not confirm arrival.');
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeAnnouncement(alertId: string) {
    if (!alertId) return;
    try {
      const { error: ackErr } = await supabase.rpc('acknowledge_alert', { p_alert_id: alertId });
      if (ackErr) throw ackErr;
      setAcknowledgedAlertIds(prev => (prev.includes(alertId) ? prev : [...prev, alertId]));
      setMessage('Announcement acknowledged');
    } catch (e: any) {
      setMessage(e?.message || 'Could not acknowledge announcement. Tap to retry.');
    }
  }

  async function fetchAcknowledgements(alertId: string) {
    try {
      const { data, error } = await supabase.rpc('get_alert_acknowledgements', { p_alert_id: alertId });
      if (!error && Array.isArray(data)) {
        setAcknowledgementMap(prev => ({
          ...prev,
          [alertId]: {
            count: data.length,
            riders: data.map((d: any) => d.display_name || 'Rider'),
          },
        }));
      }
    } catch {
      // Offline fallback
    }
  }

  async function handleCloseRegroup(pointId: string) {
    setBusy(true);
    try {
      const { error: closeErr } = await supabase.rpc('close_regroup_point', { p_regroup_point_id: pointId });
      if (closeErr) throw closeErr;
      setRegroupPoints(prev => prev.map(p => (p.id === pointId ? { ...p, status: 'closed', closed_at: new Date().toISOString() } : p)));
      if (arrivingRegroupPoint?.id === pointId) {
        setArrivingRegroupPoint(null);
      }
      await broadcastAnnouncement('Regroup point completed. Pack is resuming ride.');
    } catch (e: any) {
      setMessage(e?.message || 'Could not close regroup point.');
    } finally {
      setBusy(false);
    }
  }

  async function broadcastPaceAdvisory(paceKmh: number, paceLabel: string) {
    await broadcastAnnouncement(`Pace advisory: Target ${paceKmh} km/h (${paceLabel})`);
  }

  async function sendMechanicalBreakdownAlert() {
    if (!position || !userId) {
      setMessage('Wait for GPS fix before sending alert.');
      return;
    }
    const msg = formatMechanicalBreakdownMessage({
      issueType: selectedMechanicalIssue,
      riderName: nameRef.current,
      latitude: position.lat,
      longitude: position.lng,
      details: mechanicalDetails.trim() || undefined,
    });
    const outcome = await sendAlert('mechanical', msg);
    if (outcome === 'sent') {
      setMechanicalModalVisible(false);
      setMechanicalDetails('');
      setMessage(`Mechanical alert sent: ${MECHANICAL_ISSUE_LABELS[selectedMechanicalIssue].label}`);
      Dialog.alert(
        'Mechanical Assistance',
        'Alert broadcast to your pack with your live GPS location. Would you like to view roadside assistance & breakdown helplines?',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'View Directory', onPress: () => void loadBreakdownDirectory() },
        ]
      );
    }
  }

  async function loadBreakdownDirectory() {
    setBreakdownDirectoryVisible(true);
    try {
      const { data, error } = await supabase.rpc('get_breakdown_assistance_directory');
      if (!error && Array.isArray(data) && data.length > 0) {
        setBreakdownServices(data as VerifiedBreakdownService[]);
      }
    } catch {
      // Fallback already set to SEEDED_BREAKDOWN_DIRECTORY
    }
  }

  async function escalateEmergency(alertId?: string) {
    if (alertId) {
      try {
        await supabase.rpc('escalate_emergency_alert', {
          p_alert_id: alertId,
          p_notes: 'Rider or Captain requested emergency service escalation',
        });
      } catch {
        // offline fallback
      }
    }
    Dialog.alert('Escalate emergency (112)', 'Direct dial National Emergency Helpline 112 immediately?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call 112', style: 'destructive', onPress: () => void Linking.openURL('tel:112') },
    ]);
  }

  useEffect(() => {
    if (captainDashboardVisible) {
      const announcements = alerts.filter(a => a.type === 'announcement');
      for (const a of announcements) {
        void fetchAcknowledgements(a.id);
      }
      void supabase.rpc('get_regroup_points', { p_ride_id: id }).then(({ data, error }) => {
        if (!error && Array.isArray(data)) setRegroupPoints(data as any);
      });
    }
  }, [captainDashboardVisible, alerts, id]);

  function triggerSosWorkflow() {
    setModal(false);
    setSosModal(true);
  }

  async function broadcastSosToGroup() {
    setSosModal(false);
    if (!position || !userId || isStale(position.timestamp)) {
      setMessage('Wait for a fresh GPS fix before sending an emergency alert.');
      return;
    }
    if ((await sendAlert('emergency')) !== 'sent') return;
    setMessage('Emergency alert broadcast to group with your live coordinates.');
  }

  async function dialEmergencyContact() {
    setSosModal(false);
    const phone = profile?.emergency_contact || '112';
    try {
      await Linking.openURL('tel:' + phone);
    } catch {
      setMessage('Could not launch phone dialer.');
    }
  }

  async function sendEmergencySms() {
    setSosModal(false);
    if (!position) {
      setMessage('No GPS fix available.');
      return;
    }
    const phone = profile?.emergency_contact || '';
    if (!phone) {
      Dialog.alert('No Emergency Contact Set', 'Set an emergency contact in your Profile to send 1-tap SOS SMS.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go to Profile', onPress: () => router.push('/(tabs)/profile') },
      ]);
      return;
    }
    if (userId && !isStale(position.timestamp)) {
      void sendAlert('emergency');
    }
    const mapsLink = `https://maps.google.com/?q=${position.lat},${position.lng}`;
    const body = `EMERGENCY SOS: I need help during my motorcycle ride "${ride?.name || 'Ride'}". My current location is: ${mapsLink}`;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    const smsUrl = `sms:${phone}${sep}body=${encodeURIComponent(body)}`;
    try {
      const canOpen = await Linking.canOpenURL(smsUrl);
      if (canOpen) {
        await Linking.openURL(smsUrl);
      } else {
        await Share.share({ message: body });
      }
      setMessage('Emergency SOS initiated.');
    } catch {
      setMessage('Could not launch SMS.');
    }
  }

  async function shareLiveLocation() {
    if (!position) {
      setMessage('Waiting for GPS position to share.');
      return;
    }
    const mapsLink = `https://maps.google.com/?q=${position.lat},${position.lng}`;
    const text = `🏍️ Tracking my motorcycle ride "${ride?.name || 'Ride'}" on RideNTrack.\nMy current location: ${mapsLink}\nJoin Code: ${ride?.ride_code || ''}`;
    try {
      await Share.share({ message: text });
    } catch {
      setMessage('Could not open share options.');
    }
  }

  const pending = sync.pendingLocationsCount + sync.pendingAlertsCount;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  if (!ride) {
    return (
      <View style={s.loading}>
        <Image source={require('../../assets/RnT_logo.png')} style={{ width: 64, height: 64, borderRadius: 16 }} resizeMode="contain" />
        <Text style={s.brand}>RIDEN TRACK</Text>
        {error ? <Text style={s.text}>{error}</Text> : <ActivityIndicator color={theme.accent} size="large" />}
        <TouchableOpacity onPress={() => void refresh()}>
          <Text style={s.link}>Retry connection</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleBack}>
          <Text style={s.link}>Back to rides</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activeRidersCount = points.filter(p => !isStale(p.timestamp, now)).length;
  const gpsColor = gps.state === 'fresh' ? theme.green : gps.state === 'error' ? theme.danger : theme.textMuted;
  const canRetryFix = gps.state === 'stale' || (gps.state === 'waiting' && (tracking === 'foreground' || tracking === 'background'));

  return (
    <View style={s.screen}>
      {/* Upper Area: Dark Cockpit Map Canvas Render */}
      {Mapbox && MAPBOX_TOKEN ? (
        <Mapbox.MapView
          key={mapRetry}
          style={StyleSheet.absoluteFill}
          styleURL={theme?.scheme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/outdoors-v12'}
          onDidFinishLoadingMap={() => {
            setMapReady(true);
            setMapError(false);
          }}
          onMapLoadingError={() => setMapError(true)}
          onCameraChanged={state => {
            if (state?.gestures?.isGestureActive) setFollow(false);
          }}
          logoPosition={{ bottom: Math.min(sheetHeight + 8, 200), left: 10 }}
          attributionPosition={{ bottom: Math.min(sheetHeight + 8, 200), right: 10 }}
          compassEnabled
        >
          <Mapbox.Camera
            ref={camera}
            defaultSettings={{
              centerCoordinate: Array.isArray(ride.origin_coords) && ride.origin_coords.length === 2 && Number.isFinite(ride.origin_coords[0]) && Number.isFinite(ride.origin_coords[1]) ? ride.origin_coords : [77.5946, 12.9716],
              zoomLevel: 14,
            }}
          />
          {route && route.geometry && Array.isArray(route.geometry.coordinates) && route.geometry.coordinates.length >= 2 && (
            <Mapbox.ShapeSource id="route" shape={route}>
              <Mapbox.LineLayer id="route-edge" style={{ lineColor: '#000', lineWidth: 8, lineCap: 'round', lineJoin: 'round' }} />
              <Mapbox.LineLayer id="route-line" style={{ lineColor: '#de7136', lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
            </Mapbox.ShapeSource>
          )}
          {actualTrailGeoJson && (
            <Mapbox.ShapeSource id="actual-trail" shape={actualTrailGeoJson}>
              <Mapbox.LineLayer
                id="actual-trail-edge"
                style={{
                  lineColor: '#003824',
                  lineWidth: 6,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineOpacity: 0.75,
                }}
              />
              <Mapbox.LineLayer
                id="actual-trail-line"
                style={{
                  lineColor: '#38bdf8',
                  lineWidth: 3,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </Mapbox.ShapeSource>
          )}
          <Mapbox.ShapeSource
            id="endpoints"
            shape={{
              type: 'FeatureCollection',
              features: [ride.origin_coords, ride.destination_coords]
                .filter((c): c is [number, number] => Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && Number.isFinite(c[0]) && Number.isFinite(c[1]))
                .map((coordinates, i) => ({
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates },
                  properties: { label: i === 0 ? 'A' : 'B' },
                })),
            }}
          >
            <Mapbox.CircleLayer id="endpoint-dot" style={{ circleColor: '#213e44', circleRadius: 13, circleStrokeWidth: 3, circleStrokeColor: theme.surface }} />
            <Mapbox.SymbolLayer id="endpoint-label" style={{ textField: ['coalesce', ['to-string', ['get', 'label']], ''], textSize: 12, textColor: '#fff' }} />
          </Mapbox.ShapeSource>
          <Mapbox.ShapeSource id="riders" shape={features}>
            <Mapbox.CircleLayer id="rider-halo" style={{ circleRadius: 18, circleColor: theme.accent, circleOpacity: 0.22 }} />
            <Mapbox.CircleLayer
              id="rider-dot"
              style={{
                circleRadius: 8,
                circleColor: [
                  'case',
                  ['==', ['get', 'mine'], true],
                  theme.accent,
                  ['==', ['get', 'status'], 'disconnected'],
                  theme.subtle,
                  ['==', ['get', 'status'], 'stopped'],
                  '#EAB308',
                  theme.green,
                ],
                circleStrokeWidth: 3,
                circleStrokeColor: '#fff',
              }}
            />
            <Mapbox.SymbolLayer
              id="rider-label"
              style={{
                textField: ['coalesce', ['to-string', ['get', 'name']], 'Rider'],
                textOffset: [0, 1.8],
                textSize: 12,
                textColor: theme.text,
                textHaloColor: theme.surface,
                textHaloWidth: 2,
              }}
            />
          </Mapbox.ShapeSource>
        </Mapbox.MapView>
      ) : (
        <View style={s.fallback}>
          <Text style={s.heading}>Cockpit Ride Mode Active</Text>
          <Text style={s.muted}>The native map is unavailable. GPS status and ride controls are shown below.</Text>
        </View>
      )}

      {/* Floating Slim Cockpit Status Strip (Top-aligned Glove Glance) */}
      <View style={[s.cockpitStatusStrip, { top: insets.top + 6 }]}>
        {/* GPS Status */}
        <TouchableOpacity style={s.statusPillItem}
          disabled={!canRetryFix}
          accessibilityRole="button" accessibilityHint="Restart GPS to request a new fix"
          onPress={() => setGpsRetry(v => v + 1)}>
          <LiveDot pulse={gps.state === 'fresh'} size={6} color={gpsColor} />
          <Text style={[s.statusStripText, { color: gpsColor }]}>
            {gps.label}{canRetryFix ? ' · Retry' : ''}
          </Text>
        </TouchableOpacity>

        {/* Cellular / Network Link */}
        <View style={s.statusPillItem}>
          <Icon name={sync.isOnline ? 'cellular-outline' : 'cloud-offline-outline'} size="xs" color={sync.isOnline ? theme.textMuted : theme.danger} />
          <Text style={s.statusStripText}>{sync.isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
        </View>

        {/* Formation Pack Count */}
        <View style={s.statusPillItem}>
          <Icon name="people-outline" size="xs" color={theme.textMuted} />
          <Text style={s.statusStripText}>{activeRidersCount}/{points.length} PACK</Text>
        </View>
      </View>

      {/* Calm Offline Indicator Banner if queued updates > 0 */}
      {pending > 0 && (
        <View style={[s.calmOfflineBanner, { top: insets.top + 44 }]}>
          <Text style={s.calmOfflineText}>
            {pending} {pending === 1 ? 'update' : 'updates'} queued, syncing when signal returns
          </Text>
        </View>
      )}

      {/* Top Header Controls (Back, Ride Title, SOS, Captain) */}
      <View style={[s.top, { top: insets.top + (pending > 0 ? 76 : 50) }]}>
        <TouchableOpacity accessibilityLabel="Back to rides" style={s.square} onPress={handleBack}>
          <Icon name="chevron-back" size="lg" color={theme.text} />
        </TouchableOpacity>
        <View style={s.title}>
          <Text numberOfLines={1} style={s.heading}>{ride.name}</Text>
          <Text numberOfLines={1} style={s.muted}>
            {ride.origin && ride.destination && !ride.origin.includes('+')
              ? `${ride.origin} → ${ride.destination}`
              : `Code: ${ride.ride_code} · ${active ? 'Live' : ride.status}`}
          </Text>
        </View>
        <TouchableOpacity accessibilityLabel="Emergency SOS" style={s.sosTopButton} onPress={triggerSosWorkflow}>
          <Text style={s.sosTopButtonText}>SOS</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="Trip Chat" style={s.square} onPress={() => setChatVisible(true)}>
          <Icon name="chatbubbles-outline" size="md" color={theme.text} />
        </TouchableOpacity>
        {admin && (
          <TouchableOpacity accessibilityLabel="Captain Dashboard" style={[s.square, { borderColor: theme.accent }]} onPress={() => setCaptainDashboardVisible(true)}>
            <Icon name="ribbon-outline" size="md" color={theme.accent} />
          </TouchableOpacity>
        )}
      </View>

      {/* Floating Next Waypoint Pin (Rohtang Top style) */}
      {active && nextWaypoint && (
        <View style={[s.floatingApexPin, { top: insets.top + (pending > 0 ? 134 : 108) }]}>
          <Icon name="flag-outline" size="md" color={theme.accent} />
          <View>
            <Text style={s.apexPinTitle} numberOfLines={1}>{nextWaypoint.name}</Text>
            <Text style={s.apexPinSub}>
              {distanceToNextStopMeters != null
                ? `${(distanceToNextStopMeters / 1000).toFixed(1)} KM • PASS APEX`
                : 'NEXT STOP'}
            </Text>
          </View>
        </View>
      )}

      {/* Floating Recenter Map Controls */}
      <View style={[s.controls, { top: insets.top + (pending > 0 ? 134 : 108) }]}>
        <TouchableOpacity
          accessibilityLabel="Follow my location"
          style={[s.control, follow && s.selected]}
          disabled={!position}
          onPress={() => {
            lastCameraPosition.current = null;
            setFollow(true);
          }}
        >
          <Text style={[s.controlText, follow && s.selectedText]}>◎ Me</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.control} onPress={fitGroup}>
          <Text style={s.controlText}>⊞ Group</Text>
        </TouchableOpacity>
      </View>

      {/* Android Pre-Ride Battery Readiness Banner */}
      {Platform.OS === 'android' && !active && !batteryBannerDismissed && (
        <View style={[s.floatingAlertBanner, { top: insets.top + 64 }]}>
          <View style={s.floatingAlertHeader}>
            <Icon name="battery-charging-outline" size="sm" color={theme.warning} />
            <Text style={[s.floatingAlertTitle, { flex: 1 }]}>Disable battery optimization for uninterrupted background GPS</Text>
            <TouchableOpacity onPress={() => setBatteryBannerDismissed(true)} accessibilityLabel="Dismiss battery check">
              <Icon name="close" size="sm" color={theme.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <TouchableOpacity style={s.floatingAlertSecondaryBtn} onPress={() => void Linking.openSettings()}>
              <Text style={s.floatingAlertActionText}>Open Battery Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Stationary Off-Route Safety Check-In */}
      {stationaryCountdown !== null && (
        <View style={[s.floatingAlertBanner, s.floatingAlertEmergency, { top: insets.top + 118 }]}>
          <View style={s.floatingAlertHeader}>
            <Icon name="alert-circle-outline" size="sm" color={theme.danger} />
            <Text style={[s.floatingAlertTitle, { flex: 1 }]}>Stopped off-route — Are you okay? ({stationaryCountdown}s)</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <TouchableOpacity
              style={s.floatingAlertSecondaryBtn}
              onPress={() => {
                setStationaryCountdown(null);
                stationaryCooldownUntilRef.current = Date.now() + 10 * 60 * 1000;
              }}
            >
              <Text style={s.floatingAlertActionText}>I&apos;m Okay</Text>
            </TouchableOpacity>
            {!!profile?.emergency_contact && !!position && !!ride && (
              <TouchableOpacity
                style={s.floatingAlertSecondaryBtn}
                onPress={() => {
                  const smsBody = formatEmergencySms({
                    riderName: name,
                    motorcycleModel: profile.motorcycle_model,
                    rideName: ride.name,
                    latitude: position.lat,
                    longitude: position.lng,
                  });
                  void Linking.openURL(`sms:${profile.emergency_contact}?body=${encodeURIComponent(smsBody)}`);
                }}
              >
                <Text style={s.floatingAlertActionText}>Send SOS SMS</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Prominent Floating Alert Overlay Card */}
      {newest && (
        <View
          style={[
            s.floatingAlertBanner,
            { top: insets.top + (active ? 174 : 110) },
            newest.type === 'emergency' && s.floatingAlertEmergency,
            newest.type === 'announcement' && s.floatingAlertAnnouncement,
            newest.type === 'fuel' && s.floatingAlertFuel,
            newest.type === 'break' && s.floatingAlertBreak,
          ]}
        >
          <View style={s.floatingAlertHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Icon name={ALERT_ICONS[newest.type] ?? 'warning-outline'} size="sm" color={newest.type === 'emergency' ? theme.danger : theme.text} />
              <Text style={[s.floatingAlertTitle, { flexShrink: 1 }]} numberOfLines={1}>
                {ALERT_LABELS[newest.type] ? plainLabel(ALERT_LABELS[newest.type]) : 'Rider Alert'} · {newest.display_name || 'Rider'}
              </Text>
            </View>
            <TouchableOpacity accessibilityLabel="Dismiss alert" onPress={() => setDismissed(ids => [...ids, newest.id])} style={s.floatingAlertDismiss}>
              <Icon name="close" size="md" color={theme.muted} />
            </TouchableOpacity>
          </View>

          {newest.message ? <Text style={s.floatingAlertMessage}>"{newest.message}"</Text> : null}

          <View style={s.floatingAlertActionsRow}>
            {newest.type === 'announcement' && (
              acknowledgedAlertIds.includes(newest.id) ? (
                <View style={s.acknowledgedBadge}>
                  <Icon name="checkmark" size="sm" color={theme.green} />
                  <Text style={s.acknowledgedText}>✓ Acknowledged</Text>
                </View>
              ) : (
                <TouchableOpacity style={s.floatingAlertActionBtn} onPress={() => void acknowledgeAnnouncement(newest.id)}>
                  <Text style={s.floatingAlertActionText}>👍 Acknowledge</Text>
                </TouchableOpacity>
              )
            )}

            {newest.type === 'emergency' && (
              <TouchableOpacity style={[s.floatingAlertActionBtn, { backgroundColor: theme.danger }]} onPress={() => void escalateEmergency(newest.id)}>
                <Icon name="call" size="sm" color={theme.onDanger} />
                  <Text style={[s.floatingAlertActionText, { color: theme.onDanger }]}>Escalate / Call 112</Text>
              </TouchableOpacity>
            )}

            {newest.lat && newest.lng && (
              <>
                <TouchableOpacity
                  style={s.floatingAlertSecondaryBtn}
                  onPress={() => {
                    setFollow(false);
                    if (typeof newest.lat === 'number' && typeof newest.lng === 'number') {
                      try {
                        camera.current?.setCamera({
                          centerCoordinate: [newest.lng, newest.lat],
                          zoomLevel: 15,
                          animationDuration: 700,
                        });
                      } catch {}
                    }
                  }}
                >
                  <Icon name="locate-outline" size="sm" color={theme.text} />
                      <Text style={s.floatingAlertSecondaryText}>Focus on map</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.floatingAlertSecondaryBtn} onPress={() => void Linking.openURL(`https://maps.google.com/?q=${newest.lat},${newest.lng}`)}>
                  <Icon name="navigate-outline" size="sm" color={theme.text} />
                      <Text style={s.floatingAlertSecondaryText}>Directions</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}

      {/* Regroup Banner Toast */}
      {arrivingRegroupPoint && (
        <View style={[s.regroupBanner, { top: insets.top + (active ? 210 : 140) }]}>
          <Text numberOfLines={1} style={s.regroupBannerText}>Near Regroup: {arrivingRegroupPoint.name}</Text>
          <TouchableOpacity style={s.confirmRegroupButton} disabled={busy} onPress={() => void confirmArrival(arrivingRegroupPoint.id)}>
            <Text style={s.confirmRegroupText}>Confirm arrival</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Route Deviation Alert */}
      {gps.state === 'fresh' && routeDeviation != null && routeDeviation > (ride?.route_deviation_threshold_meters || 500) && (
        <View style={[s.deviationWarning, { top: insets.top + (active ? 210 : 140) }]}>
          <Text style={s.deviationWarningText}>Route Deviation: ~{Math.round(routeDeviation)} m from planned route</Text>
        </View>
      )}

      {/* Waypoint Arrival Toast */}
      {lastArrivedWaypoint && (
        <View style={[s.arrivalToast, { top: insets.top + (active ? 210 : 140) }]}>
          <Text style={s.arrivalToastText}>Arrived at {lastArrivedWaypoint}! Next stop loaded.</Text>
        </View>
      )}

      {/* GPS Signal Restored Toast */}
      {gpsRecoveryStatus === 'recovered' && (
        <View style={[s.arrivalToast, { top: insets.top + (active ? 210 : 140) }]}>
          <Text style={s.arrivalToastText}>GPS signal restored. Tracking resumed.</Text>
        </View>
      )}

      {(message || gpsError || error || mapError) && (
        <View style={[s.warning, { top: insets.top + (active ? 250 : 160) }]}>
          <Text style={s.warningText}>{message || gpsError || error || 'Map tiles could not load.'}</Text>
          <TouchableOpacity onPress={() => {
            if (message) setMessage(null);
            else if (gpsError && active && sharing) setGpsRetry(v => v + 1);
            else if (gpsError) setGpsError(null);
            else if (error) void refresh();
            else { setMapReady(false); setMapError(false); setMapRetry(v => v + 1); }
          }}>
            <Text style={s.link}>{message || (gpsError && (!active || !sharing)) ? 'Dismiss' : gpsError ? 'Retry GPS' : error ? 'Retry connection' : 'Retry map'}</Text>
          </TouchableOpacity>
          {tracking === 'error' && (
            <TouchableOpacity onPress={() => void Linking.openSettings()}>
              <Text style={s.link}>Open settings</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Bottom Console Sheet: Glanceable Telemetry & Giant 64dp+ Action Deck */}
      <View
        onLayout={event => setSheetHeight(event.nativeEvent.layout.height)}
        style={[
          s.sheet,
          { paddingBottom: Math.max(insets.bottom + 12, 28) },
          expanded && s.sheetExpanded,
        ]}
      >
        <View {...panResponder.panHandlers}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse rider drawer' : 'Swipe up or tap to expand rider drawer'}
            onPress={toggleExpanded}
            style={s.sheetHeader}
            activeOpacity={0.8}
          >
            <View style={s.handle} />

            {/* Hero Waypoint Split Display */}
            {active && (
              <View style={s.heroApexSplitRow}>
                <View style={s.heroApexTargetCol}>
                  <Text style={s.apexSubLabel}>NEXT APEX TARGET</Text>
                  <View style={s.apexTitleRow}>
                    <Icon name="navigate" size="md" color={theme.accent} />
                    <Text style={s.apexTargetTitle} numberOfLines={1}>
                      {nextWaypoint ? nextWaypoint.name : ride.destination || 'Summit Base'}
                    </Text>
                  </View>
                </View>
                <View style={s.heroApexDistCol}>
                  <Text style={s.apexSubLabel}>DIST REMAINING</Text>
                  <View style={s.apexDistRow}>
                    <Text style={s.apexDistNumeral}>
                      {distanceToNextStopMeters != null
                        ? (distanceToNextStopMeters / 1000).toFixed(1)
                        : (distanceCoveredMeters / 1000).toFixed(1)}
                    </Text>
                    <Text style={s.apexDistUnit}>KM</Text>
                  </View>
                </View>
              </View>
            )}

            {/* High-Contrast Secondary Metric HUD Row */}
            {active && (
              <TouchableOpacity activeOpacity={0.88} onPress={() => setStatsModalVisible(true)} style={s.hudContainer}>
                <View style={s.hudItem}>
                  <Text style={s.hudValue}>{currentSpeedKmh}</Text>
                  <Text style={s.hudLabel}>KM/H</Text>
                </View>
                <View style={s.hudDivider} />
                <View style={s.hudItem}>
                  <Text style={s.hudValue}>
                    {distanceCoveredMeters >= 1000 ? (distanceCoveredMeters / 1000).toFixed(1) + ' km' : distanceCoveredMeters + ' m'}
                  </Text>
                  <Text style={s.hudLabel}>TRAIL</Text>
                </View>
                <View style={s.hudDivider} />
                <View style={s.hudItem}>
                  <Text style={s.hudValue}>
                    {distanceToNextStopMeters != null
                      ? distanceToNextStopMeters >= 1000
                        ? (distanceToNextStopMeters / 1000).toFixed(1) + ' km'
                        : distanceToNextStopMeters + ' m'
                      : '—'}
                  </Text>
                  <Text style={s.hudLabel}>NEXT STOP</Text>
                </View>
                <View style={s.hudDivider} />
                <View style={s.hudItem}>
                  <Icon name="stats-chart-outline" size="lg" color={theme.accent} />
                  <Text style={s.hudLabel}>STATS</Text>
                </View>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </View>

        {/* Giant Glove-Friendly Action Deck (Min 64dp Touch Targets) */}
        {active && (
          <View style={s.giantActionDeck}>
            <View style={s.actionGridRow}>
              {/* Action 1: Navigate External Maps */}
                <TouchableOpacity
                style={[s.giantActionBtn, s.actionButton]}
                onPress={() => void navigateToNextWaypoint()}
                onLongPress={() => void toggleNavProvider()}
                accessibilityRole="button"
                accessibilityLabel={nextWaypoint ? `Navigate leg to ${nextWaypoint.name} in ${formatNavProviderLabel(navProvider)}` : 'Navigate Leg'}
              >
                <View style={s.giantBtnIconWrap}>
                  <Icon name="navigate-outline" size="lg" color={theme.text} />
                </View>
                <View style={s.giantBtnTextCol}>
                  <Text style={s.giantBtnTitle}>NAVIGATE LEG</Text>
                  {active && nextWaypoint ? (
                    <Text style={s.giantBtnSubtitle} numberOfLines={1}>
                      Navigate to {nextWaypoint.name} ({formatNavProviderLabel(navProvider)})
                    </Text>
                  ) : (
                    <Text style={s.giantBtnSubtitle} numberOfLines={1}>
                      {formatNavProviderLabel(navProvider)} (hold to switch)
                    </Text>
                  )}
                </View>
              </TouchableOpacity>

              {/* Action 2: Alert Group */}
              <TouchableOpacity
                style={[s.giantActionBtn, s.alertButton]}
                onPress={() => setModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Broadcast alert to group"
              >
                <View style={s.giantBtnIconWrap}>
                  <Icon name="megaphone-outline" size="lg" color={theme.text} />
                </View>
                <View style={s.giantBtnTextCol}>
                  <Text style={s.giantBtnTitle}>ALERT</Text>
                  <Text style={s.giantBtnSubtitle}>Broadcast Horn</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={s.actionGridRow}>
              {/* Action 3: Regroup Point */}
              <TouchableOpacity
                style={[s.giantActionBtn, s.actionButton]}
                onPress={() => {
                  if (arrivingRegroupPoint) {
                    void confirmArrival(arrivingRegroupPoint.id);
                  } else if (admin) {
                    setCaptainDashboardVisible(true);
                  } else {
                    Dialog.alert('Regroup Point', 'No active regroup point nearby. Captain coordinates meetup points.');
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Regroup drop marker"
              >
                <View style={s.giantBtnIconWrap}>
                  <Icon name="flag-outline" size="lg" color={theme.text} />
                </View>
                <View style={s.giantBtnTextCol}>
                  <Text style={s.giantBtnTitle}>REGROUP</Text>
                  <Text style={s.giantBtnSubtitle}>
                    {arrivingRegroupPoint ? 'Confirm Arrival' : 'Drop Marker'}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Action 4: Hold-to-Confirm Emergency SOS (2s Radial Countdown) */}
              <HoldToConfirmButton
                onConfirm={broadcastSosToGroup}
                durationMs={2000}
                title="HOLD FOR SOS"
                confirmTitle="SOS DISPATCHED"
                style={s.sosGiantBtn}
              />
            </View>
          </View>
        )}

        {/* Expandable Drawer Content (Roster, Secondary Actions, Pack Formation) */}
        {expanded && (
          <ScrollView style={s.drawerContent} contentContainerStyle={s.drawerScrollContent} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {packFormation.length > 1 && (
              <View style={s.formationContainer}>
                <View style={s.formationHeader}>
                  <Text style={s.formationTitle}>FORMATION & SPACING</Text>
                  {packFormation.some(p => p.isSeparated) && <Text style={s.separationBadge}>Gap alert</Text>}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.formationStrip}>
                  {packFormation.map(rider => (
                    <View key={rider.userId} style={s.formationItem}>
                      <View style={[s.formationBadge, rider.isLeader ? s.leaderBadge : rider.isTail ? s.tailBadge : s.memberBadge]}>
                        <Text style={s.formationBadgeText}>
                          {rider.isLeader ? 'LEAD' : rider.isTail ? 'SWEEP' : `#${rider.order}`}
                        </Text>
                      </View>
                      <Text numberOfLines={1} style={s.formationName}>{rider.displayName}</Text>
                      <Text style={[s.formationGap, rider.isSeparated ? s.separatedGap : null]}>
                        {rider.isLeader ? 'Lead' : `+${rider.gapToAheadMeters >= 1000 ? (rider.gapToAheadMeters / 1000).toFixed(1) + 'km' : rider.gapToAheadMeters + 'm'}`}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {active ? (
              <View style={s.activeActionsContainer}>
                <View style={s.actionsRow}>
                  <TouchableOpacity
                    style={s.actionButton}
                    onPress={() => setSharing(v => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={sharing ? 'Pause GPS tracking' : 'Resume GPS tracking'}
                  >
                    <View style={s.inlineRow}>
                      <Icon name={sharing ? 'pause' : 'play'} size="sm" color={theme.text} />
                      <Text style={s.actionButtonText} numberOfLines={1}>{sharing ? 'Pause GPS' : 'Resume GPS'}</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={s.actionButton}
                    disabled={!position}
                    onPress={() => void shareLiveLocation()}
                    accessibilityRole="button"
                    accessibilityLabel="Share live location with contact"
                  >
                    <View style={s.inlineRow}>
                      <Icon name="share-outline" size="sm" color={theme.text} />
                      <Text style={s.actionButtonText} numberOfLines={1}>Share</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={s.actionButton}
                    onPress={() => router.push('/trip/' + id)}
                    accessibilityRole="button"
                    accessibilityLabel="Trip workspace and details"
                  >
                    <View style={s.inlineRow}>
                      <Icon name="document-text-outline" size="sm" color={theme.text} />
                      <Text style={s.actionButtonText} numberOfLines={1}>Details</Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {((tracking === 'foreground' && sharing) || (admin && active)) && (
                  <View style={s.subActionsRow}>
                    {tracking === 'foreground' && sharing && (
                      <TouchableOpacity
                        style={[s.subActionButton, admin && active ? { flex: 1 } : { width: '100%' }]}
                        onPress={() => void enableBackgroundGps()}
                        accessibilityRole="button"
                        accessibilityLabel="Enable background GPS tracking"
                      >
                        <Text style={s.subActionText} numberOfLines={1}>
                          {backgroundPermissionGranted ? 'Start background GPS' : 'Enable background GPS'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {admin && active && (
                      <TouchableOpacity
                        accessibilityLabel="End ride for everyone"
                        style={[s.endRideButton, tracking !== 'background' && sharing ? { flex: 1 } : { width: '100%' }]}
                        disabled={busy}
                        onPress={() =>
                          Dialog.alert('End this ride?', 'Sharing stops when each device receives the update.', [
                            { text: 'Keep riding', style: 'cancel' },
                            { text: 'End ride', style: 'destructive', onPress: () => void changeStatus('completed') },
                          ])
                        }
                      >
                        <Text style={s.endRideText}>End Ride</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            ) : admin && ride.status === 'planned' ? (
              <View style={s.actions}>
                <TouchableOpacity style={s.primary} disabled={busy} onPress={() => void changeStatus('active')}>
                  <Text style={s.buttonText}>{busy ? 'Starting…' : 'Start the ride'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.actions}>
                <Text style={s.muted}>
                  {ride.status === 'completed' ? 'Ride ended. Location sharing is off.' : 'Waiting for the organizer to start.'}
                </Text>
              </View>
            )}

            <RiderRoster
              points={points}
              userId={userId}
              rideStatus={ride.status}
              now={now}
              iceByRider={iceByRider}
              onFocusRider={focusRider}
            />

            {(pending > 0 || sync.syncError) && (
              <TouchableOpacity disabled={sync.isSyncing} onPress={() => void sync.flushQueue()} style={s.sync}>
                <Text style={s.muted}>{sync.isSyncing ? 'Uploading saved updates…' : pending + ' updates saved · tap to sync'}</Text>
                {sync.syncError && <Text style={s.warningText}>{sync.syncError}</Text>}
              </TouchableOpacity>
            )}
          </ScrollView>
        )}
      </View>

      {/* Modals */}
      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <View style={s.overlay}>
          <View style={[s.modal, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <Text style={s.heading}>Let your group know</Text>
            <Text style={s.muted}>Your location is attached. Offline alerts are delivered after reconnecting.</Text>
            {admin && (
              <TouchableOpacity
                style={[s.alertOption, { backgroundColor: theme.accentSoft, borderColor: theme.accent, borderWidth: 1 }]}
                disabled={busy}
                onPress={() => {
                  setModal(false);
                  setAnnouncementModal(true);
                }}
              >
                <Icon name="megaphone-outline" size="md" color={theme.accent} />
                <Text style={[s.text, { color: theme.accent }]}>Captain Announcement…</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.alertOption, { backgroundColor: theme.surfaceRaised, borderColor: theme.warning, borderWidth: 1 }]}
              disabled={busy}
              onPress={() => {
                setModal(false);
                setMechanicalModalVisible(true);
              }}
            >
              <Icon name="construct-outline" size="md" color={theme.warning} />
              <Text style={[s.text, { color: theme.warning }]}>Mechanical Breakdown…</Text>
            </TouchableOpacity>
            {(Object.keys(ALERT_LABELS) as AlertType[])
              .filter(t => t !== 'announcement' && t !== 'mechanical')
              .map(type => (
                <TouchableOpacity
                  key={type}
                  style={[s.alertOption, type === 'emergency' && s.emergency]}
                  disabled={busy}
                  onPress={() => (type === 'emergency' ? triggerSosWorkflow() : void sendAlert(type))}
                >
                  <Icon name={ALERT_ICONS[type]} size="md" color={type === 'emergency' ? theme.danger : theme.textMuted} />
                  <Text style={s.text}>{plainLabel(ALERT_LABELS[type])}</Text>
                </TouchableOpacity>
              ))}
            <TouchableOpacity
              style={[s.alertOption, { borderColor: theme.border, borderWidth: 1 }]}
              onPress={() => {
                setModal(false);
                void loadBreakdownDirectory();
              }}
            >
              <Icon name="call-outline" size="md" color={theme.textMuted} />
              <Text style={s.text}>Breakdown Assistance Directory (1033 / RSA)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondary} onPress={() => setModal(false)}>
              <Text style={s.text}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={announcementModal} transparent animationType="slide" onRequestClose={() => setAnnouncementModal(false)}>
        <View style={s.overlay}>
          <View style={[s.modal, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <Text style={[s.heading, { color: theme.accent }]}>Captain Announcement</Text>
            {message && <Text style={s.warningText}>{message}</Text>}
            <Text style={s.muted}>Broadcast a quick directive or sticky status alert to all riders' heads-up display.</Text>
            <View style={{ gap: 8, marginVertical: 4 }}>
              {[
                'Fuel stop at next pump (~5km)',
                'Chai & stretch break ahead',
                'Wet roads / rain ahead — reduce speed',
                'Road hazard / debris observed',
                'Regroup at next junction',
                'Pull over safely now',
              ].map((preset, idx) => (
                <TouchableOpacity key={idx} style={s.presetOption} disabled={busy} onPress={() => void broadcastAnnouncement(preset)}>
                  <Text style={s.presetText}>{preset}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <TextInput
                style={s.announcementInput}
                placeholder="Or type custom announcement..."
                placeholderTextColor={theme.muted}
                value={customAnnouncement}
                onChangeText={setCustomAnnouncement}
                maxLength={120}
              />
              <TouchableOpacity
                style={[s.sendAnnouncementBtn, !customAnnouncement.trim() && s.disabled]}
                disabled={busy || !customAnnouncement.trim()}
                onPress={() => void broadcastAnnouncement(customAnnouncement)}
              >
                <Text style={s.sendAnnouncementText}>Send</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.secondary} onPress={() => setAnnouncementModal(false)}>
              <Text style={s.text}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={sosModal} transparent animationType="slide" onRequestClose={() => setSosModal(false)}>
        <View style={s.overlay}>
          <View style={[s.modal, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <Text style={[s.heading, { color: theme.danger }]}>Motorcycle Emergency SOS</Text>
            <Text style={s.muted}>Broadcast an instant emergency alert with your live GPS location to your group, and reach your emergency contact.</Text>
            <TouchableOpacity style={s.sosEmergencyOption} disabled={busy} onPress={() => void broadcastSosToGroup()}>
              <Text style={s.sosEmergencyText}>Broadcast to Group Now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.alertOption} disabled={busy} onPress={() => void sendEmergencySms()}>
              <Icon name="chatbubble-outline" size="md" color={theme.textMuted} />
              <Text style={[s.text, { flexShrink: 1 }]}>SMS GPS to Contact ({profile?.emergency_contact || 'None set'})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.alertOption} disabled={busy} onPress={() => void dialEmergencyContact()}>
              <Icon name="call-outline" size="md" color={theme.textMuted} />
              <Text style={[s.text, { flexShrink: 1 }]}>Call Emergency Contact ({profile?.emergency_contact || '112'})</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1 }]}
              onPress={() => {
                setSosModal(false);
                void loadBreakdownDirectory();
              }}
            >
              <Icon name="call-outline" size="md" color={theme.accent} />
              <Text style={[s.text, { color: theme.accent, flexShrink: 1 }]}>Highway Assistance & RSA Directory (1033 / 112)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondary} onPress={() => setSosModal(false)}>
              <Text style={s.text}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Live Ride Statistics Modal */}
      <Modal visible={statsModalVisible} transparent animationType="slide" onRequestClose={() => setStatsModalVisible(false)}>
        <View style={s.overlay}>
          <View style={[s.modal, { maxHeight: '85%', paddingBottom: Math.max(insets.bottom, 24) }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={s.heading}>Live Ride Telemetry & Statistics</Text>
                <TouchableOpacity onPress={() => setStatsModalVisible(false)} accessibilityLabel="Close statistics">
                  <Icon name="close" size="lg" color={theme.muted} />
                </TouchableOpacity>
              </View>
              <Text style={[s.muted, { marginBottom: 14 }]}>Real-time speed, pace, moving time, and pack spread statistics.</Text>

              {/* Time Stats */}
              <View style={s.statsCard}>
                <Text style={s.statsCardHeader}>TIME & DURATION</Text>
                <View style={s.statsGrid}>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.formatted.elapsedTime}</Text>
                    <Text style={s.statsLabel}>ELAPSED</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={[s.statsValue, { color: theme.green }]}>{liveStats.formatted.movingTime}</Text>
                    <Text style={s.statsLabel}>MOVING TIME</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.formatted.stoppedTime}</Text>
                    <Text style={s.statsLabel}>STOPPED</Text>
                  </View>
                </View>
              </View>

              {/* Speed Stats */}
              <View style={s.statsCard}>
                <Text style={s.statsCardHeader}>SPEED & DISTANCE</Text>
                <View style={s.statsGrid}>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.formatted.currentSpeed}</Text>
                    <Text style={s.statsLabel}>CURRENT</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={[s.statsValue, { color: theme.accent }]}>{liveStats.formatted.avgSpeed}</Text>
                    <Text style={s.statsLabel}>AVG MOVING</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.formatted.maxSpeed}</Text>
                    <Text style={s.statsLabel}>TOP SPEED</Text>
                  </View>
                </View>
                <View style={[s.statsGrid, { marginTop: 10 }]}>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.formatted.distance}</Text>
                    <Text style={s.statsLabel}>RECORDED TRAIL</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.formatted.altitude}</Text>
                    <Text style={s.statsLabel}>ALTITUDE</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.elevationGainMeters} m</Text>
                    <Text style={s.statsLabel}>ASCENT GAIN</Text>
                  </View>
                </View>
              </View>

              {/* Pack Telemetry */}
              <View style={s.statsCard}>
                <Text style={s.statsCardHeader}>PACK FORMATION & TELEMETRY</Text>
                <View style={s.statsGrid}>
                  <View style={s.statsGridItem}>
                    <Text style={[s.statsValue, { color: theme.accent }]}>{liveStats.formatted.packSpread}</Text>
                    <Text style={s.statsLabel}>LEAD-TO-SWEEP SPREAD</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.packSummary.ridingCount}</Text>
                    <Text style={s.statsLabel}>RIDING NOW</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.packSummary.stoppedCount}</Text>
                    <Text style={s.statsLabel}>STOPPED</Text>
                  </View>
                </View>
              </View>

              {/* Battery Saver Option */}
              <View style={[s.statsCard, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[s.statsCardHeader, { marginBottom: 2 }]}>TOURING BATTERY SAVER</Text>
                  <Text style={s.muted}>Adapts GPS interval (15s/25m) for all-day tours to conserve phone battery.</Text>
                </View>
                <TouchableOpacity style={[s.control, batterySaver && s.selected]} onPress={() => setBatterySaver(v => !v)}>
                  <Text style={[s.controlText, batterySaver && s.selectedText]}>{batterySaver ? 'ON' : 'OFF'}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={s.secondary} onPress={() => setStatsModalVisible(false)}>
                <Text style={s.text}>Close Statistics</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Captain Command Dashboard Modal */}
      <Modal visible={captainDashboardVisible} transparent animationType="slide" onRequestClose={() => setCaptainDashboardVisible(false)}>
        <View style={s.overlay}>
          <View style={[s.modal, { maxHeight: '88%', paddingBottom: Math.max(insets.bottom, 24) }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={[s.heading, { color: theme.accent }]}>Captain Command Dashboard</Text>
                <TouchableOpacity onPress={() => setCaptainDashboardVisible(false)} accessibilityLabel="Close dashboard">
                  <Icon name="close" size="lg" color={theme.muted} />
                </TouchableOpacity>
              </View>
              <Text style={[s.muted, { marginBottom: 14 }]}>Lead controls, pack spacing overview, speed advisories, and regroup coordination.</Text>

              {/* Pack Overview Card */}
              <View style={s.statsCard}>
                <Text style={s.statsCardHeader}>PACK STATUS & SPREAD</Text>
                <View style={s.statsGrid}>
                  <View style={s.statsGridItem}>
                    <Text style={[s.statsValue, { color: theme.green }]}>{liveStats.packSummary.ridingCount}</Text>
                    <Text style={s.statsLabel}>RIDING</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={s.statsValue}>{liveStats.packSummary.stoppedCount}</Text>
                    <Text style={s.statsLabel}>STOPPED</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={[s.statsValue, packFormation.some(p => p.isSeparated) ? { color: theme.danger } : null]}>
                      {packFormation.filter(p => p.isSeparated).length}
                    </Text>
                    <Text style={s.statsLabel}>SEPARATED</Text>
                  </View>
                  <View style={s.statsGridItem}>
                    <Text style={[s.statsValue, { color: theme.accent }]}>{liveStats.formatted.packSpread}</Text>
                    <Text style={s.statsLabel}>SPREAD</Text>
                  </View>
                </View>
              </View>

              {/* Pace Advisory Actions */}
              <View style={s.statsCard}>
                <Text style={s.statsCardHeader}>BROADCAST PACE ADVISORY</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                  <TouchableOpacity style={s.paceButton} onPress={() => void broadcastPaceAdvisory(40, 'Curves / Ghats')}>
                    <Text style={s.paceButtonText}>40 km/h (Ghats)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.paceButton} onPress={() => void broadcastPaceAdvisory(60, 'Cruising')}>
                    <Text style={s.paceButtonText}>60 km/h (Cruising)</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity style={s.paceButton} onPress={() => void broadcastPaceAdvisory(80, 'Highway')}>
                    <Text style={s.paceButtonText}>80 km/h (Highway)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.paceButton} onPress={() => void broadcastPaceAdvisory(30, 'Wet Road / Rain')}>
                    <Text style={s.paceButtonText}>30 km/h (Rain)</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Active Regroup Points Coordination */}
              <View style={s.statsCard}>
                <Text style={s.statsCardHeader}>REGROUP POINTS COORDINATION</Text>
                {regroupPoints.length === 0 ? (
                  <Text style={s.muted}>No regroup points set for this ride. Add them in Trip Workspace.</Text>
                ) : (
                  regroupPoints.map(point => {
                    const isClosed = point.status === 'closed';
                    return (
                      <View key={point.id} style={s.regroupActionItem}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={s.text}>#{point.sequence} {point.name}</Text>
                          <Text style={s.muted}>{isClosed ? 'Closed & completed' : `${point.total_arrived || 0}/${participants.length} arrived`}</Text>
                        </View>
                        {isClosed ? (
                          <View style={s.acknowledgedBadge}>
                            <Text style={s.acknowledgedText}>Closed</Text>
                          </View>
                        ) : (
                          <TouchableOpacity style={s.regroupCloseBtn} disabled={busy} onPress={() => void handleCloseRegroup(point.id)}>
                            <Text style={s.regroupCloseBtnText}>Close & Resume</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </View>

              {/* Announcements & Acknowledgements Monitor */}
              <View style={s.statsCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={s.statsCardHeader}>ANNOUNCEMENT ACKNOWLEDGEMENTS</Text>
                  <TouchableOpacity
                    style={{ backgroundColor: theme.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}
                    onPress={() => {
                      setCaptainDashboardVisible(false);
                      setAnnouncementModal(true);
                    }}
                  >
                    <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '800' }}>+ New Broadcast</Text>
                  </TouchableOpacity>
                </View>
                {alerts.filter(a => a.type === 'announcement').length === 0 ? (
                  <Text style={s.muted}>No announcements broadcast yet.</Text>
                ) : (
                  alerts
                    .filter(a => a.type === 'announcement')
                    .slice(0, 5)
                    .map(alertItem => {
                      const ack = acknowledgementMap[alertItem.id];
                      return (
                        <View key={alertItem.id} style={{ backgroundColor: theme.surface, padding: 10, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: theme.border }}>
                          <Text style={[s.text, { fontSize: 13 }]}>"{alertItem.message}"</Text>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                            <Text style={s.muted}>{new Date(alertItem.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                            <Text style={[s.statsValue, { fontSize: 12, color: theme.accent }]}>
                              {ack ? `${ack.count}/${participants.length} acknowledged` : 'Checking...'}
                            </Text>
                          </View>
                          {ack && ack.riders.length > 0 && <Text style={[s.muted, { fontSize: 10, marginTop: 2 }]}>Acknowledged by {ack.riders.join(', ')}</Text>}
                        </View>
                      );
                    })
                )}
              </View>

              <TouchableOpacity
                style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1, marginBottom: 12, justifyContent: 'center' }]}
                onPress={() => void shareFamilySpectatorLink(24)}
              >
                <Icon name="share-social-outline" size="md" color={theme.accent} />
                <Text style={[s.text, { color: theme.accent }]}>Share Live Family Link (24h)</Text>
              </TouchableOpacity>
              {hasActiveSpectatorLink && (
                <TouchableOpacity
                  style={[s.alertOption, { borderColor: theme.danger, borderWidth: 1, marginBottom: 12, justifyContent: 'center' }]}
                  onPress={() => void revokeFamilySpectatorLink()}
                >
                  <Icon name="close-circle-outline" size="md" color={theme.danger} />
                  <Text style={[s.text, { color: theme.danger }]}>Revoke Active Family Link</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1, marginBottom: 12, justifyContent: 'center' }]}
                onPress={() => {
                  setCaptainDashboardVisible(false);
                  void loadBreakdownDirectory();
                }}
              >
                <Icon name="call-outline" size="md" color={theme.accent} />
                <Text style={[s.text, { color: theme.accent }]}>Open Roadside Breakdown Directory</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.secondary} onPress={() => setCaptainDashboardVisible(false)}>
                <Text style={s.text}>Close Dashboard</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Upgrade Prompt Modal */}
      <UpgradePromptModal
        visible={upgradePromptVisible}
        featureTitle="Live Family Spectator Link"
        featureDescription="Share a read-only live map link with family and friends (no app install required). Unlock with Pro Tourer or an Expedition Pass."
        onClose={() => setUpgradePromptVisible(false)}
      />

      {/* Trip Chat Sheet */}
      <TripChatSheet
        visible={chatVisible}
        onClose={() => setChatVisible(false)}
        messages={messages}
        currentUserId={userId}
        isOnline={sync.isOnline}
        onSend={async (body: string, messageType: RideMessageType) => {
          if (!userId || !id) return;
          await sendRideMessage(supabase, { rideId: id, senderId: userId, body, messageType });
        }}
      />

      {/* Mechanical Breakdown Modal */}
      <Modal visible={mechanicalModalVisible} transparent animationType="slide" onRequestClose={() => setMechanicalModalVisible(false)}>
        <View style={s.overlay}>
          <View style={[s.modal, { maxHeight: '85%', paddingBottom: Math.max(insets.bottom, 24) }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={[s.heading, { color: theme.warning }]}>Mechanical Breakdown Alert</Text>
                <TouchableOpacity onPress={() => setMechanicalModalVisible(false)} accessibilityLabel="Close">
                  <Icon name="close" size="lg" color={theme.muted} />
                </TouchableOpacity>
              </View>
              <Text style={[s.muted, { marginBottom: 14 }]}>Notify your pack of bike issues and attach your exact live location so sweep and teammates can assist.</Text>

              <Text style={[s.statsCardHeader, { marginBottom: 8 }]}>SELECT ISSUE TYPE</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {(Object.keys(MECHANICAL_ISSUE_LABELS) as MechanicalIssueType[]).map(issue => (
                  <TouchableOpacity
                    key={issue}
                    style={[s.issueChip, selectedMechanicalIssue === issue && s.issueChipSelected]}
                    onPress={() => setSelectedMechanicalIssue(issue)}
                  >
                    <Icon name={MECHANICAL_ICONS[issue]} size="sm" color={selectedMechanicalIssue === issue ? theme.accent : theme.textMuted} />
                    <Text style={[s.issueChipText, selectedMechanicalIssue === issue && s.issueChipTextSelected]}>{MECHANICAL_ISSUE_LABELS[issue].label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.statsCardHeader, { marginBottom: 6 }]}>ADDITIONAL DETAILS (OPTIONAL)</Text>
              <TextInput
                style={[s.announcementInput, { marginBottom: 14, minHeight: 44 }]}
                placeholder="e.g. Rear tire flat, need pump or patch kit..."
                placeholderTextColor={theme.muted}
                value={mechanicalDetails}
                onChangeText={setMechanicalDetails}
                maxLength={140}
              />

              <TouchableOpacity style={[s.primary, { backgroundColor: theme.warningSoft, borderWidth: 1, borderColor: theme.warning, marginBottom: 10 }]} disabled={busy} onPress={() => void sendMechanicalBreakdownAlert()}>
                <Text style={[s.buttonText, { color: theme.warning, fontWeight: '800' }]}>Broadcast Breakdown Alert</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.alertOption, { borderColor: theme.border, borderWidth: 1, marginBottom: 10, justifyContent: 'center' }]}
                onPress={() => {
                  setMechanicalModalVisible(false);
                  void loadBreakdownDirectory();
                }}
              >
                <Icon name="call-outline" size="md" color={theme.textMuted} />
                <Text style={s.text}>View Roadside Assistance Numbers</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.secondary} onPress={() => setMechanicalModalVisible(false)}>
                <Text style={s.text}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Breakdown Directory Modal */}
      <Modal visible={breakdownDirectoryVisible} transparent animationType="slide" onRequestClose={() => setBreakdownDirectoryVisible(false)}>
        <View style={s.overlay}>
          <View style={[s.modal, { maxHeight: '88%', paddingBottom: Math.max(insets.bottom, 24) }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={[s.heading, { color: theme.accent }]}>Roadside Breakdown Directory</Text>
                <TouchableOpacity onPress={() => setBreakdownDirectoryVisible(false)} accessibilityLabel="Close directory">
                  <Icon name="close" size="lg" color={theme.muted} />
                </TouchableOpacity>
              </View>
              <Text style={[s.muted, { marginBottom: 14 }]}>24x7 verified highway helplines, motorcycle roadside recovery, and emergency towing.</Text>

              {/* National Helplines */}
              <Text style={s.statsCardHeader}>24X7 NATIONAL HELPLINES</Text>
              {NATIONAL_EMERGENCY_HELPLINES.map((helpline, idx) => (
                <View key={idx} style={s.directoryCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={s.directoryName}>{helpline.name}</Text>
                      <Text style={s.directoryCoverage}>{helpline.purpose}</Text>
                    </View>
                    <TouchableOpacity style={s.callButton} onPress={() => void Linking.openURL('tel:' + helpline.number)}>
                      <Icon name="call" size="xs" color={theme.onAccent} />
                      <Text style={s.callButtonText}>{helpline.number}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              {/* Verified Breakdown Services */}
              <Text style={[s.statsCardHeader, { marginTop: 10 }]}>MOTORCYCLE RSA & TOWING SERVICES</Text>
              {breakdownServices.map((service, idx) => (
                <View key={service.id || idx} style={s.directoryCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={s.directoryName}>{service.name}</Text>
                      <Text style={s.directoryCoverage}>{service.region} · {service.category}</Text>
                      {(service.notes || service.description) && <Text style={s.directoryPhone}>{service.notes || service.description}</Text>}
                    </View>
                    <TouchableOpacity style={s.callButton} onPress={() => void Linking.openURL('tel:' + service.phone)}>
                      <Icon name="call" size="xs" color={theme.onAccent} />
                      <Text style={s.callButtonText}>Call</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <TouchableOpacity style={[s.secondary, { marginTop: 8 }]} onPress={() => setBreakdownDirectoryVisible(false)}>
                <Text style={s.text}>Close Directory</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, padding: 28, backgroundColor: c.background },
    brand: { color: c.accent, fontSize: 16, fontWeight: '800', letterSpacing: 4 },
    text: { color: c.text, fontSize: 14, fontWeight: '600' },
    muted: { color: c.muted, fontSize: 12, lineHeight: 18 },
    heading: { color: c.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },

    // Top Cockpit Status Strip
    cockpitStatusStrip: {
      position: 'absolute',
      left: 14,
      right: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      zIndex: 30,
    },
    statusPillItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusStripText: { color: c.text, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

    // Calm Offline Indicator
    calmOfflineBanner: {
      position: 'absolute',
      left: 14,
      right: 14,
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      zIndex: 29,
      alignItems: 'center',
    },
    calmOfflineText: { color: c.accent, fontSize: 11, fontWeight: '700' },

    // Top Header
    top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', gap: 8, alignItems: 'center', zIndex: 28 },
    title: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 14,
      backgroundColor: c.surface + 'EE',
      borderWidth: 1,
      borderColor: c.border,
    },
    square: {
      width: 44,
      height: 48,
      borderRadius: 14,
      backgroundColor: c.surface + 'EE',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    sosTopButton: {
      width: 46,
      height: 48,
      borderRadius: 14,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sosTopButtonText: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },

    // Floating Apex Pin
    floatingApexPin: {
      position: 'absolute',
      left: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      zIndex: 25,
      maxWidth: '55%',
      ...elevation('floating', c),
    },
    apexPinTitle: { color: c.text, fontSize: 12, fontWeight: '800' },
    apexPinSub: { color: c.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

    controls: { position: 'absolute', right: 14, flexDirection: 'row', gap: 8, zIndex: 25 },
    control: {
      backgroundColor: c.surface,
      paddingHorizontal: 14,
      minHeight: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    selected: { borderColor: c.accent, backgroundColor: c.accentSoft },
    controlText: { color: c.text, fontSize: 13, fontWeight: '700' },
    selectedText: { color: c.accent, fontWeight: '800' },

    // Floating Alert Banner
    floatingAlertBanner: {
      position: 'absolute',
      left: 14,
      right: 14,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      padding: 14,
      borderWidth: 1.5,
      borderColor: c.accent,
      zIndex: 50,
      ...elevation('overlay', c),
    },
    floatingAlertEmergency: { backgroundColor: c.dangerSoft, borderColor: c.danger, borderWidth: 2 },
    floatingAlertAnnouncement: { backgroundColor: c.accentSoft, borderColor: c.accent },
    floatingAlertFuel: { backgroundColor: c.warningSoft, borderColor: c.warning },
    floatingAlertBreak: { backgroundColor: c.warningSoft, borderColor: c.warning },
    floatingAlertHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    floatingAlertTitle: { color: c.text, fontSize: 14, fontWeight: '800' },
    floatingAlertDismiss: { padding: 4, marginLeft: 8 },
    floatingAlertMessage: { color: c.text, fontSize: 13, fontWeight: '600', lineHeight: 18, marginBottom: 10 },
    floatingAlertActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    floatingAlertActionBtn: { flexDirection: 'row', gap: 6, backgroundColor: c.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    floatingAlertActionText: { color: c.onAccent, fontSize: 12, fontWeight: '800' },
    floatingAlertSecondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceRaised, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.border },
    floatingAlertSecondaryText: { color: c.text, fontSize: 12, fontWeight: '700' },

    regroupBanner: {
      position: 'absolute',
      left: 14,
      right: 14,
      backgroundColor: c.surface,
      borderColor: c.accent,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      zIndex: 40,
    },
    regroupBannerText: { color: c.text, fontSize: 13, fontWeight: '700', flex: 1 },
    confirmRegroupButton: { backgroundColor: c.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    confirmRegroupText: { color: c.onAccent, fontSize: 12, fontWeight: '800' },

    deviationWarning: {
      position: 'absolute',
      left: 14,
      right: 14,
      backgroundColor: c.accentSoft,
      borderColor: c.accent,
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
      alignItems: 'center',
      zIndex: 40,
    },
    deviationWarningText: { color: c.danger, fontSize: 12, fontWeight: '800' },

    arrivalToast: {
      position: 'absolute',
      left: 14,
      right: 14,
      backgroundColor: c.greenSoft,
      borderColor: c.green,
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
      alignItems: 'center',
      zIndex: 40,
    },
    arrivalToastText: { color: c.green, fontSize: 12, fontWeight: '800' },

    warning: { position: 'absolute', left: 16, right: 16, backgroundColor: c.accentSoft, borderRadius: 15, padding: 12, gap: 4, zIndex: 35 },
    warningText: { color: c.text, fontSize: 12, lineHeight: 18 },
    link: { color: c.accent, fontWeight: '700', paddingVertical: 8 },
    fallback: { padding: 36, paddingTop: 180, gap: 14 },

    // Bottom Console Sheet
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: c.border,
      zIndex: 20,
      ...elevation('sheet', c),
    },
    sheetExpanded: { maxHeight: '75%' },
    sheetHeader: { paddingTop: 8, paddingBottom: 6 },
    handle: { width: 44, height: 5, backgroundColor: c.border, borderRadius: 3, alignSelf: 'center', marginBottom: 10 },

    // Hero Apex Waypoint Split
    heroApexSplitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
    heroApexTargetCol: { flex: 1, paddingRight: 10 },
    apexSubLabel: { color: c.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
    apexTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    apexTargetTitle: { color: c.text, fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
    heroApexDistCol: { alignItems: 'flex-end' },
    apexDistRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginTop: 2 },
    apexDistNumeral: { color: c.accent, fontSize: 36, fontWeight: '900', letterSpacing: -1 },
    apexDistUnit: { color: c.accent, fontSize: 14, fontWeight: '800' },

    // Secondary Metric HUD Row
    hudContainer: {
      backgroundColor: c.surfaceRaised,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 10,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      marginBottom: 10,
    },
    hudItem: { alignItems: 'center', flex: 1 },
    hudValue: { color: c.text, fontSize: 18, fontWeight: '900' },
    hudLabel: { color: c.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
    hudDivider: { width: 1, height: 26, backgroundColor: c.border },

    // Giant Glove-Friendly Action Deck (64dp+ Height Zones)
    giantActionDeck: { gap: 10, marginVertical: 6 },
    actionGridRow: { flexDirection: 'row', gap: 10 },
    giantActionBtn: {
      flex: 1,
      minHeight: 64,
      height: 70,
      backgroundColor: c.surfaceRaised,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      gap: 10,
    },
    actionButton: { flex: 1, backgroundColor: c.surfaceRaised, borderRadius: 16, minHeight: 64, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    alertButton: { flex: 1, backgroundColor: c.surfaceRaised, borderRadius: 16, minHeight: 64, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    giantBtnIconWrap: { width: 42, height: 42, borderRadius: 10, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
    giantBtnTextCol: { flex: 1, justifyContent: 'center' },
    giantBtnTitle: { color: c.text, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
    giantBtnSubtitle: { color: c.muted, fontSize: 10, fontWeight: '700', marginTop: 2 },
    sosGiantBtn: { flex: 1, minHeight: 64, height: 70, borderRadius: 16 },

    // Expandable Drawer Details
    drawerContent: { marginTop: 6 },
    drawerScrollContent: { paddingBottom: 20 },
    formationContainer: { marginBottom: 12, backgroundColor: c.surfaceRaised, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: c.border },
    formationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    formationTitle: { color: c.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    separationBadge: { color: c.danger, fontSize: 10, fontWeight: '800' },
    formationStrip: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    formationItem: { alignItems: 'center', minWidth: 68, backgroundColor: c.surface, borderRadius: 8, padding: 6, borderWidth: 1, borderColor: c.border },
    formationBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginBottom: 4 },
    leaderBadge: { backgroundColor: c.accentSoft },
    tailBadge: { backgroundColor: c.warningSoft },
    memberBadge: { backgroundColor: c.surfaceRaised },
    formationBadgeText: { color: c.text, fontSize: 9, fontWeight: '800' },
    formationName: { color: c.text, fontSize: 11, fontWeight: '700', maxWidth: 70 },
    formationGap: { color: c.muted, fontSize: 10, fontWeight: '600', marginTop: 2 },
    separatedGap: { color: c.danger, fontWeight: '800' },

    activeActionsContainer: { gap: 8, width: '100%', marginVertical: 8 },
    actionsRow: { flexDirection: 'row', gap: 8, alignItems: 'center', width: '100%' },
    actionButtonText: { color: c.text, fontSize: 13, fontWeight: '700' },
    alertButtonText: { color: c.text, fontSize: 13, fontWeight: '800' },
    subActionsRow: { flexDirection: 'row', gap: 8, alignItems: 'center', width: '100%', marginTop: 2 },
    subActionButton: { backgroundColor: c.surfaceRaised, borderRadius: 12, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    subActionText: { color: c.accent, fontSize: 12, fontWeight: '700' },
    endRideButton: { backgroundColor: c.dangerSoft, borderColor: c.danger, borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
    endRideText: { color: c.danger, fontSize: 12, fontWeight: '800' },

    actions: { flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 8 },
    primary: { flex: 1, backgroundColor: c.accent, borderRadius: 15, minHeight: 52, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    secondary: { backgroundColor: c.surfaceRaised, borderRadius: 15, minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    buttonText: { color: c.text, fontSize: 14, fontWeight: '700' },


    sync: { paddingVertical: 10, alignItems: 'center' },

    // Modals
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.shadow + '88' },
    modal: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, backgroundColor: c.surface, gap: 12 },
    alertOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: c.surfaceRaised },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    emergency: { backgroundColor: c.accentSoft },
    announcementInput: { flex: 1, backgroundColor: c.surfaceRaised, borderRadius: 10, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 13 },
    sendAnnouncementBtn: { backgroundColor: c.accent, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10 },
    sendAnnouncementText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
    presetOption: { padding: 12, borderRadius: 8, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border },
    presetText: { color: c.text, fontSize: 13, fontWeight: '600' },
    disabled: { opacity: 0.5 },

    sosEmergencyOption: { padding: 16, borderRadius: 10, backgroundColor: c.danger, alignItems: 'center' },
    sosEmergencyText: { color: c.onDanger, fontSize: 15, fontWeight: '800' },

    statsCard: { backgroundColor: c.surfaceRaised, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    statsCardHeader: { color: c.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 },
    statsGrid: { flexDirection: 'row', justifyContent: 'space-around' },
    statsGridItem: { alignItems: 'center', flex: 1 },
    statsValue: { color: c.text, fontSize: 16, fontWeight: '800' },
    statsLabel: { color: c.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.3, marginTop: 2 },

    paceButton: { flex: 1, backgroundColor: c.surfaceRaised, padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: c.border },
    paceButtonText: { color: c.text, fontSize: 11, fontWeight: '700' },
    regroupActionItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.surface, padding: 10, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    regroupCloseBtn: { backgroundColor: c.green, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
    regroupCloseBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
    acknowledgedBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: c.greenSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm },
    acknowledgedText: { color: c.green, fontSize: 12, fontWeight: '800' },

    issueChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border, marginBottom: spacing.xs },
    issueChipSelected: { backgroundColor: c.accentSoft, borderColor: c.accent },
    issueChipText: { color: c.text, fontSize: 12, fontWeight: '600' },
    issueChipTextSelected: { color: c.accent, fontWeight: '800' },

    directoryCard: { backgroundColor: c.surfaceRaised, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    directoryName: { color: c.text, fontSize: 14, fontWeight: '800' },
    directoryCoverage: { color: c.accent, fontSize: 11, fontWeight: '700', marginTop: 2 },
    directoryPhone: { color: c.muted, fontSize: 12, marginTop: 2 },
    callButton: { flexDirection: 'row', gap: 4, backgroundColor: c.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    callButtonText: { color: c.onAccent, fontSize: 12, fontWeight: '800' },
  });
