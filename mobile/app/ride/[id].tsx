import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert as Dialog,
  Share,
  Linking,
  Dimensions,
  Platform,
  Image,
  ScrollView,
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
  type AttentionItem,
  isStale,
  validCoordinates,
  distanceMeters,
  distanceToRouteMeters,
  buildGoogleMapsNavigationUrl,
  type ExternalNavProvider,
  type RoutePoint,
  getRiderLiveStatus,
  type RideIceContact,
  calculatePackFormation,
  calculateLiveRideStats,
  type MechanicalIssueType,
  MECHANICAL_ISSUE_LABELS,
  formatEmergencySms,
  formatMechanicalBreakdownMessage,
  SEEDED_BREAKDOWN_DIRECTORY,
  type VerifiedBreakdownService,
  resolveRideEntitlements,
  attentionFromAlerts,
  crashCountdownAttention,
  checkInAttention,
  regroupArrivalAttention,
  routeDeviationAttention,
  noticeAttention,
  selectAttention,
  lowBatteryAttention,
  estimateBattery,
  hoursLeft,
  profileForRole,
  LOW_BATTERY_PERCENT,
  riderPresence,
  lockScreenCard,
  roadReportFeatures,
  roadReportAheadAttention,
} from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRide } from '../../src/hooks/useRide';
import { useOfflineSync } from '../../src/hooks/useOfflineSync';
import { useRideTrail } from '../../src/hooks/useRideTrail';
import { useStationaryCheckIn } from '../../src/hooks/ride/useStationaryCheckIn';
import { useRegroupPoints } from '../../src/hooks/ride/useRegroupPoints';
import { useRideAlerts } from '../../src/hooks/ride/useRideAlerts';
import { useSosWorkflow } from '../../src/hooks/ride/useSosWorkflow';
import { useCrashDetection } from '../../src/hooks/ride/useCrashDetection';
import { useSafetyWatch } from '../../src/hooks/ride/useSafetyWatch';
import { useRideChat } from '../../src/hooks/ride/useRideChat';
import { useSpectatorLinks } from '../../src/hooks/ride/useSpectatorLinks';
import { useLastFuelWarning } from '../../src/hooks/ride/useLastFuelWarning';
import { useRoadReports } from '../../src/hooks/ride/useRoadReports';
import { RoadReportSheet } from '../../src/components/ride/RoadReportSheet';
import { postRideStartCard, useLockScreenCardSetting } from '../../src/services/lockScreenCard';
import { useThrottledValue } from '../../src/hooks/ride/useThrottledValue';
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
import { track } from '../../src/services/analytics';
import { HoldToConfirmButton, Icon, LiveDot } from '../../src/components/ui';
import { RiderRoster } from '../../src/components/ride/RiderRoster';
import { useRideStyles } from '../../src/components/ride/rideStyles';
import { RideMap, type RiderFeatureCollection } from '../../src/components/ride/RideMap';
import { RideHud } from '../../src/components/ride/RideHud';
import { RideAttentionBar } from '../../src/components/ride/RideAttentionBar';
import { CaptainDashboard } from '../../src/components/ride/CaptainDashboard';
import { BriefingSheet } from '../../src/components/ride/BriefingSheet';
import { RollCallSheet } from '../../src/components/ride/RollCallSheet';
import { DebriefSheet } from '../../src/components/ride/DebriefSheet';
import { useCaptainFlow } from '../../src/hooks/ride/useCaptainFlow';
import { CaptainStepCard } from '../../src/components/ride/CaptainStepCard';
import { FamilyUpdatesRow } from '../../src/components/ride/FamilyUpdatesRow';
import { useFlag, useFlagPayload } from '../../src/hooks/useFeatureFlags';
import { useBatteryLevel } from '../../src/hooks/useBatteryLevel';
import { getCachedTrip, saveCachedRoute } from '../../src/lib/tripCache';
import { SosSheet } from '../../src/components/ride/SosSheet';
import {
  AlertPickerSheet,
  AnnouncementSheet,
  BreakdownDirectorySheet,
  MechanicalSheet,
  RideStatsSheet,
} from '../../src/components/ride/RideSheets';

// Graceful keep-awake in ride mode
let useKeepAwake: () => void = () => {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const keepAwakeModule = require('expo-keep-awake');
  if (keepAwakeModule && typeof keepAwakeModule.useKeepAwake === 'function') {
    useKeepAwake = keepAwakeModule.useKeepAwake;
  }
} catch {
  // expo-keep-awake optional fallback
}

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {
    /* ignore */
  }
}


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
  const { s, theme } = useRideStyles();
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

  useEffect(() => {
    if (id) track('ride_screen_opened');
  }, [id]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5,
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
  // destination_coords is [lng, lat]. Kept in a ref so the tracker effect does
  // not restart GPS when the ride row refreshes with the same coordinates.
  const destinationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  {
    const coords = ride?.destination_coords;
    destinationRef.current = Array.isArray(coords) && validCoordinates(coords[1], coords[0])
      ? { latitude: coords[1], longitude: coords[0] }
      : null;
  }

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
  const focusPoint = useCallback((lat: number, lng: number) => {
    setFollow(false);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    try {
      camera.current?.setCamera({ centerCoordinate: [lng, lat], zoomLevel: 15, padding: cameraPadding, animationDuration: 700 });
    } catch { /* ignore */ }
  }, [cameraPadding]);
  const focusRider = useCallback((point: LocationUpdate) => focusPoint(point.lat, point.lng), [focusPoint]);

  const lastCameraPosition = useRef<{ lat: number; lng: number } | null>(null);
  const [modal, setModal] = useState(false);
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
  const [announcementModal, setAnnouncementModal] = useState(false);
  const [customAnnouncement, setCustomAnnouncement] = useState('');
  const [captainDashboardVisible, setCaptainDashboardVisible] = useState(false);
  const [mechanicalModalVisible, setMechanicalModalVisible] = useState(false);
  const [breakdownDirectoryVisible, setBreakdownDirectoryVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [upgradePromptVisible, setUpgradePromptVisible] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [dismissedAttention, setDismissedAttention] = useState<string[]>([]);
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [gpsRecoveryStatus, setGpsRecoveryStatus] = useState<'normal' | 'recovered'>('normal');
  const gpsRecoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [breakdownServices, setBreakdownServices] = useState<VerifiedBreakdownService[]>(SEEDED_BREAKDOWN_DIRECTORY);
  const [iceByRider, setIceByRider] = useState<Record<string, RideIceContact>>({});
  const rideStartTimeMs = useRef<number | null>(null);
  const accumulatedMovingMs = useRef<number>(0);
  const lastCheckTimeMs = useRef<number>(Date.now());
  const maxSpeedKmh = useRef<number>(0);
  const currentAltitudeMeters = useRef<number | null>(null);
  const elevationGainMeters = useRef<number>(0);
  const admin = ride?.admin_id === userId;
  const gps = gpsStatus(active && sharing ? tracking : 'paused', position?.timestamp, now);

  const rideAlerts = useRideAlerts({
    rideId: id,
    userId,
    position,
    isOnline: sync.isOnline,
    refresh,
    updateCounts: sync.updateCounts,
    setMessage,
  });
  const { busy, setBusy, sendAlert, acknowledgedAlertIds, acknowledgeAnnouncement, acknowledgementMap, fetchAcknowledgements } = rideAlerts;
  const { regroupPoints, arrivingRegroupPoint, refreshRegroupPoints, confirmArrival: confirmRegroupArrival, closeRegroupPoint } = useRegroupPoints(id, position);
  const captainFlow = useCaptainFlow({
    rideId: id,
    rideName: ride?.name ?? 'Ride',
    rideStatus: ride?.status,
    userId,
    isAdmin: admin,
    position,
    distanceKm: ride?.estimated_distance_meters ? ride.estimated_distance_meters / 1000 : null,
  });
  const leader = captainFlow.isLeader;
  // F4: GPS profile follows the role; the battery estimate is one sentence.
  const gpsRole = captainFlow.myRole;
  const battery = useBatteryLevel();
  const batteryEstimate = useMemo(() => estimateBattery({
    role: gpsRole,
    hours: ride?.estimated_duration_seconds ? Math.max(1, ride.estimated_duration_seconds / 3600 * 1.3) : 8,
    levelPercent: battery.levelPercent,
  }), [gpsRole, ride?.estimated_duration_seconds, battery.levelPercent]);
  const [briefingVisible, setBriefingVisible] = useState(false);
  const [rollCallVisible, setRollCallVisible] = useState(false);
  const [debriefVisible, setDebriefVisible] = useState(false);
  const serverSmsFlag = useFlag('server_sms');
  const sos = useSosWorkflow({
    ride,
    profile,
    riderName: name,
    position,
    online: sync.isOnline,
    serverSms: serverSmsFlag,
    sendAlert,
    setMessage,
    onMissingContact: () =>
      Dialog.alert('No emergency contact', 'Set an emergency contact in your Profile to send 1-tap SOS SMS.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go to profile', onPress: () => router.push('/(tabs)/profile') },
      ]),
  });
  const { triggerSosWorkflow, broadcastSosToGroup } = sos;
  // F9: opt-in emergency card in the live-ride notification (lock screen).
  const lockScreenFlag = useFlag('lock_screen_card');
  const [lockCardOn] = useLockScreenCardSetting();
  const captainContact = sos.recipients.find(r => r.role === 'captain') ?? null;
  const emergencyCard = useMemo(() => (lockScreenFlag && lockCardOn
    ? lockScreenCard({ riderName: name, bloodGroup: profile?.blood_group, emergencyContact: profile?.emergency_contact, captain: captainContact })
    : null), [lockScreenFlag, lockCardOn, name, profile?.blood_group, profile?.emergency_contact, captainContact?.name, captainContact?.phone]); // eslint-disable-line react-hooks/exhaustive-deps
  const emergencyCardRef = useRef(emergencyCard);
  emergencyCardRef.current = emergencyCard;
  const emergencyCardKey = emergencyCard ? emergencyCard.title + emergencyCard.body : '';
  const postedCardFor = useRef<string | null>(null);
  useEffect(() => {
    if (!emergencyCard || !active || !sharing || postedCardFor.current === id) return;
    postedCardFor.current = id;
    void postRideStartCard(emergencyCard, id);
  }, [emergencyCard, active, sharing, id]);
  // F8: chat goes through the offline queue, so it works in dead zones.
  const chat = useRideChat({
    rideId: id, userId, online: sync.isOnline, messages,
    pendingMessagesCount: sync.pendingMessagesCount, flushQueue: sync.flushQueue,
  });
  // F7: crash countdown (beta flag) and the hidden sensor recorder.
  const crashDetectionFlag = useFlag('crash_detection_beta');
  const sensorRecorderFlag = useFlag('sensor_recorder');
  const crashThresholds = useFlagPayload('crash_detection_beta');
  const crash = useCrashDetection({
    rideId: id,
    userId,
    active: active && sharing,
    position,
    online: sync.isOnline,
    detectionEnabled: crashDetectionFlag,
    recorderEnabled: sensorRecorderFlag,
    researchConsent: Boolean(profile?.crash_research_consent_at),
    thresholdsPayload: crashThresholds,
    sendAlert: (type, message) => sendAlert(type, message),
    escalate: () => sos.escalateCrash(),
  });
  const { stationaryCountdown, confirmOk: confirmStationaryOk } = useStationaryCheckIn({
    active,
    position,
    now,
    waypoints: upcomingWaypoints,
    routeCoordinates: route?.geometry?.coordinates,
    onUnanswered: () => {
      if (userId && ride) void sendAlert('check_in_missed', 'Stopped off-route and did not answer the check-in. Please check on them.');
    },
  });

  // Family spectator links (free during a ride with decision 3, otherwise Pro).
  const { hasActiveSpectatorLink, shareFamilySpectatorLink, revokeFamilySpectatorLink } = useSpectatorLinks({
    ride, rideId: id, userId, subscriptionTier: profile?.subscription_tier, setMessage, onNeedsUpgrade: () => setUpgradePromptVisible(true),
  });
  const [navProvider, setNavProvider] = useState<ExternalNavProvider>(getDefaultNavProvider);

  useEffect(() => {
    void getPreferredNavProvider().then(setNavProvider);
  }, []);

  async function toggleNavProvider() {
    const next: ExternalNavProvider = navProvider === 'google_maps' ? 'apple_maps' : 'google_maps';
    setNavProvider(next);
    await setPreferredNavProvider(next);
    setMessage(`Maps app set to ${formatNavProviderLabel(next)}`);
  }

  const points = useMemo(() => (position && active ? [...participants.filter(p => p.user_id !== userId), position] : participants), [participants, position, active, userId]);

  const packFormation = useMemo(() => {
    const routeCoords = route?.geometry?.coordinates;
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) return [];
    return calculatePackFormation(points, routeCoords, ride?.rider_behind_threshold_meters || 1000);
  }, [points, route?.geometry?.coordinates, ride?.rider_behind_threshold_meters]);

  const riderFeatures = useMemo<RiderFeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: points
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
            age: p.user_id === userId ? '' : (() => { const presence = riderPresence(p.timestamp, now); return presence.state === 'live' ? '' : presence.label; })(),
          },
        };
      }),
  }), [points, userId, now, ride?.status]);

  // The newest alert from another rider still chimes, once per alert.
  const newest = alerts.find(a => a.user_id !== userId && now - Date.parse(a.created_at) < 300000);
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

  // The check-in countdown ticks every second; keep "now" in step while it runs.
  useEffect(() => {
    if (stationaryCountdown !== null) setNow(Date.now());
  }, [stationaryCountdown]);

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

  // Route deviation and "rider behind" safety alerts (one per gap, with cooldowns).
  useSafetyWatch({ rideId: id, userId, active, admin, ride, route, position, participants, now, setRouteDeviation, setMessage, flushQueue: sync.flushQueue });

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
      role: gpsRole,
      lockScreenCard: emergencyCardRef.current,
      destination: destinationRef.current,
      onLocationUpdate: p => {
        if (!cancelled) { setNow(Date.now()); setPosition(p); }
      },
      onError: e => {
        if (!cancelled) setGpsError(e);
      },
      onAutoStop: reason => {
        if (!cancelled) {
          setSharing(false);
          setTracking('paused');
          setMessage(reason === 'arrived'
            ? 'You reached the destination, so location sharing stopped.'
            : 'Location sharing stopped after 12 hours. Turn it back on if you are still riding.');
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
  }, [id, userId, rideLoaded, active, sharing, publish, gpsRetry, gpsRole, emergencyCardKey]);

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

  // F5 offline-first: with no signal, the ride, route and stops come from the
  // trip cache saved when the trip was opened, so the map still works.
  useEffect(() => {
    if (!id || !userId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void getCachedTrip(id, userId).then(cached => {
        if (cancelled || !cached) return;
        setRide(current => current ?? (cached.trip as Ride));
        setUpcomingWaypoints(current => current.length ? current : cached.waypoints
          .filter(w => w.waypoint_type !== 'origin')
          .map(w => ({ name: w.name, latitude: w.latitude, longitude: w.longitude, provider_place_id: w.provider_place_id ?? null, sequence: w.sequence })));
      });
    }, sync.isOnline ? 4000 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, userId, sync.isOnline, setRide]);

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
    return () => {
      cancelled = true;
    };
  }, [id]);

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

  // The HUD reads throttled values: at most one repaint a second.
  const hudPosition = useThrottledValue(position, 1000);
  const distanceToNextStopMeters = useMemo(() => {
    if (!hudPosition || !nextWaypoint) return null;
    return Math.round(distanceMeters(hudPosition, { lat: nextWaypoint.latitude, lng: nextWaypoint.longitude }));
  }, [hudPosition?.lat, hudPosition?.lng, nextWaypoint?.latitude, nextWaypoint?.longitude]);

  const currentSpeedKmh = gps.state === 'fresh' && hudPosition ? Math.round(hudPosition.speed * 3.6) : '—';
  const hudDistanceCovered = useThrottledValue(distanceCoveredMeters, 1000);

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
      // Only a fresh fix may be the route origin. Without one, hand the maps
      // app just the next stop so it starts from the phone's real location
      // instead of from a stale point or from a planned waypoint.
      if (position && !isStale(position.timestamp) && validCoordinates(position.lat, position.lng)) {
        const remaining = upcomingWaypoints.slice(targetWaypointIndex);
        const legPoints: RoutePoint[] = [
          { sequence: 0, waypoint_type: 'origin', name: 'Current Location', latitude: position.lat, longitude: position.lng },
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
        navProvider === 'apple_maps'
          ? `https://maps.apple.com/?daddr=${nextWaypoint.latitude},${nextWaypoint.longitude}&dirflg=d`
          : buildGoogleMapsNavigationUrl({
              latitude: nextWaypoint.latitude,
              longitude: nextWaypoint.longitude,
              placeId: nextWaypoint.provider_place_id,
            })
      );
    } catch (e: unknown) {
      Dialog.alert('Could not open navigation', e instanceof Error ? e.message : 'Please check that a maps app is available and try again.');
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
      void saveCachedRoute(id, userId, geo);
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
        role: gpsRole,
        lockScreenCard: emergencyCardRef.current,
        destination: destinationRef.current,
        onAutoStop: reason => {
          if (session !== gpsSession.current) return;
          setSharing(false);
          setTracking('paused');
          setMessage(reason === 'arrived'
            ? 'You reached the destination, so location sharing stopped.'
            : 'Location sharing stopped after 12 hours. Turn it back on if you are still riding.');
        },
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

  // Ride status changes only through start_ride / end_ride (F1). Starting goes
  // through the roll call sheet; it throws StartNeedsReasonError when riders
  // are still waiting so the sheet can ask for a one-tap reason.
  async function startRideFromRollCall(reason?: string) {
    const data = await captainFlow.startRide(reason);
    if (data) setRide(data as Ride);
    track('ride_started');
  }

  async function endRideForEveryone() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await captainFlow.endRide();
      if (data) setRide(data as Ride);
      track('ride_ended');
      await stopBackgroundLocationUpdates(id);
      await sync.flushQueue();
      setDebriefVisible(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not end the ride.');
    } finally {
      setBusy(false);
    }
  }

  async function markAllThrough(pointId: string) {
    setBusy(true);
    try {
      const missing = await captainFlow.markAllThrough(pointId);
      setMessage(missing.length ? `All through. Not seen: ${missing.map(m => m.display_name).join(', ')}.` : 'All through. Everyone accounted for.');
      await refreshRegroupPoints();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Could not mark all through.');
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
      await confirmRegroupArrival(regroupPointId);
      setMessage('Confirmed arrival at regroup point.');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Could not confirm arrival.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseRegroup(pointId: string) {
    setBusy(true);
    try {
      await closeRegroupPoint(pointId);
      await broadcastAnnouncement('Regroup point completed. Pack is resuming ride.');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Could not close regroup point.');
    } finally {
      setBusy(false);
    }
  }

  async function broadcastPaceAdvisory(paceKmh: number, paceLabel: string) {
    await broadcastAnnouncement(`Pace advisory: Target ${paceKmh} km/h (${paceLabel})`);
  }

  async function sendMechanicalBreakdownAlert(issue: MechanicalIssueType, details: string): Promise<boolean> {
    if (!position || !userId) {
      setMessage('Wait for GPS fix before sending alert.');
      return false;
    }
    const msg = formatMechanicalBreakdownMessage({
      issueType: issue,
      riderName: nameRef.current,
      latitude: position.lat,
      longitude: position.lng,
      details: details.trim() || undefined,
    });
    const outcome = await sendAlert('mechanical', msg);
    if (outcome !== 'sent') return false;
    setMechanicalModalVisible(false);
    setMessage(`Mechanical alert sent: ${MECHANICAL_ISSUE_LABELS[issue].label}`);
    Dialog.alert(
      'Mechanical Assistance',
      'Alert broadcast to your pack with your live GPS location. Would you like to view roadside assistance & breakdown helplines?',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'View Directory', onPress: () => void loadBreakdownDirectory() },
      ]
    );
    return true;
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
      for (const a of alerts.filter(a => a.type === 'announcement')) void fetchAcknowledgements(a.id);
      void refreshRegroupPoints();
    }
  }, [captainDashboardVisible, alerts, id]);

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

  function textEmergencyContactFromCheckIn() {
    if (!profile?.emergency_contact || !position || !ride) return;
    const smsBody = formatEmergencySms({
      riderName: name,
      motorcycleModel: profile.motorcycle_model,
      rideName: ride.name,
      latitude: position.lat,
      longitude: position.lng,
    });
    const sep = Platform.OS === 'ios' ? '&' : '?';
    void Linking.openURL(`sms:${profile.emergency_contact}${sep}body=${encodeURIComponent(smsBody)}`);
  }

  // ---------------------------------------------------------------------------
  // Ride attention queue: every banner on this screen is an item here, and the
  // RideAttentionBar shows exactly one of them at a time (shared/attention.ts).
  // ---------------------------------------------------------------------------
  const briefingTrip = useMemo(() => {
    const byRole = (roles: string[]) => captainFlow.riders.find(r => r.role && roles.includes(r.role))?.name ?? null;
    return {
      rideName: ride?.name ?? 'Ride',
      meetupName: ride?.origin ?? null,
      startTime: ride?.start_date && ride.start_date.includes('T') ? new Date(ride.start_date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null,
      lead: byRole(['captain', 'leader']),
      sweep: byRole(['sweeper', 'sweep']),
      regroupPoints: regroupPoints.map(p => ({ name: p.name })),
      distanceKm: ride?.estimated_distance_meters ? ride.estimated_distance_meters / 1000 : null,
    };
  }, [ride?.name, ride?.origin, ride?.start_date, ride?.estimated_distance_meters, captainFlow.riders, regroupPoints]);

  const nowIso = new Date(now).toISOString();
  const lastFuel = useLastFuelWarning({ ride, route, profile, position, online: sync.isOnline, nowIso });
  // F11: rider road reports (map layer, "ahead of you" warning, report sheet).
  const roadReportsFlag = useFlag('road_reports');
  const road = useRoadReports({
    enabled: roadReportsFlag, rideId: id, userId, routeCoords: route?.geometry?.coordinates, position,
    online: sync.isOnline, pendingCount: sync.pendingRoadReportsCount, flushQueue: sync.flushQueue,
  });
  const [roadSheet, setRoadSheet] = useState<{ open: boolean; selectedId: string | null }>({ open: false, selectedId: null });
  const roadFeatures = useMemo(() => roadReportFeatures(road.reports, now), [road.reports, Math.floor(now / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const roadAhead = useMemo(
    () => (active ? roadReportAheadAttention(position, route?.geometry?.coordinates, road.reports, nowIso) : null),
    [active, position?.lat, position?.lng, route, road.reports, Math.floor(now / 30000)], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const deviationLimit = ride?.route_deviation_threshold_meters || 500;
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = attentionFromAlerts(alerts, { myUserId: userId, now, acknowledgedIds: acknowledgedAlertIds });
    if (crash.secondsLeft != null) items.push(crashCountdownAttention(crash.secondsLeft, nowIso));
    if (lastFuel.item) items.push(lastFuel.item);
    if (roadAhead) items.push(roadAhead);
    if (stationaryCountdown !== null) {
      items.push(checkInAttention(stationaryCountdown, Boolean(profile?.emergency_contact && position && ride), nowIso));
    }
    if (arrivingRegroupPoint) items.push(regroupArrivalAttention(arrivingRegroupPoint, nowIso, { canMarkAllThrough: captainFlow.canMarkAllThrough }));
    if (active && battery.levelPercent != null && !battery.charging && battery.levelPercent <= LOW_BATTERY_PERCENT) {
      items.push(lowBatteryAttention(battery.levelPercent, hoursLeft(battery.levelPercent, profileForRole(gpsRole)), nowIso));
    }
    if (gps.state === 'fresh' && routeDeviation != null && routeDeviation > deviationLimit) {
      items.push(routeDeviationAttention(routeDeviation, nowIso));
    }
    if (lastArrivedWaypoint) items.push(noticeAttention('arrived', `Arrived at ${lastArrivedWaypoint}`, nowIso, { body: 'Next stop loaded.' }));
    if (gpsRecoveryStatus === 'recovered') items.push(noticeAttention('gps-restored', 'GPS signal restored', nowIso, { body: 'Tracking resumed.' }));
    // Setup prompts (battery optimisation, permissions) live on the Ride ready card, not here.
    const problem = message || gpsError || error || (mapError ? 'Map tiles could not load.' : null);
    if (problem) {
      const actionLabel = message || (gpsError && (!active || !sharing)) ? undefined : gpsError ? 'Retry GPS' : error ? 'Retry connection' : 'Retry map';
      items.push({ ...noticeAttention('problem', problem, nowIso, { actionLabel }), id: `notice:problem:${problem}` });
    }
    return items;
  }, [alerts, userId, now, acknowledgedAlertIds, crash.secondsLeft, lastFuel.item, roadAhead, stationaryCountdown, profile?.emergency_contact, position, ride, arrivingRegroupPoint, captainFlow.canMarkAllThrough, battery.levelPercent, battery.charging, gpsRole, gps.state, routeDeviation, deviationLimit, lastArrivedWaypoint, gpsRecoveryStatus, active, message, gpsError, error, mapError, sharing, nowIso]);

  const attentionView = selectAttention(attentionItems, { now, dismissedIds: dismissedAttention });

  const dismissAttention = useCallback((item: AttentionItem) => {
    track('attention_dismissed', { kind: item.kind });
    setDismissedAttention(ids => (ids.includes(item.id) ? ids : [...ids, item.id]));
    if (item.id.startsWith('notice:problem')) {
      if (message) setMessage(null);
      else if (gpsError) setGpsError(null);
    }
  }, [message, gpsError]);

  const handleAttentionAction = (item: AttentionItem, actionId: string) => {
    track('attention_action', { kind: item.kind, action: actionId });
    const alertId = item.id.startsWith('alert:') ? item.id.slice(6) : null;
    const alert = alertId ? alerts.find(a => a.id === alertId) : undefined;
    switch (actionId) {
      case 'crash_ok':
        crash.cancelCrash();
        return;
      case 'crash_help':
        crash.requestHelp();
        return;
      case 'fuel_directions': {
        const station = lastFuel.stationFor(item.id);
        if (station) void Linking.openURL(`https://maps.google.com/?q=${station.lat},${station.lng}`);
        return;
      }
      case 'dismiss_fuel':
      case 'dismiss_road':
        dismissAttention(item);
        return;
      case 'road_confirm':
        void road.confirm(item.id.replace(/^road:/, ''));
        dismissAttention(item);
        return;
      case 'ok':
        confirmStationaryOk();
        return;
      case 'sms':
        textEmergencyContactFromCheckIn();
        return;
      case 'confirm':
        if (arrivingRegroupPoint) void confirmArrival(arrivingRegroupPoint.id);
        return;
      case 'dismiss_battery':
        dismissAttention(item);
        return;
      case 'all_through':
        if (arrivingRegroupPoint) void markAllThrough(arrivingRegroupPoint.id);
        return;
      case 'ack':
        if (alertId) void acknowledgeAnnouncement(alertId);
        return;
      case 'escalate':
        void escalateEmergency(alertId ?? undefined);
        return;
      case 'focus':
        if (alert?.lat != null && alert.lng != null) focusPoint(alert.lat, alert.lng);
        return;
      case 'directions':
        if (alert?.lat != null && alert.lng != null) void Linking.openURL(`https://maps.google.com/?q=${alert.lat},${alert.lng}`);
        return;
      case 'navigate':
        void navigateToNextWaypoint();
        return;
      case 'retry':
        if (gpsError && active && sharing) setGpsRetry(v => v + 1);
        else if (error) void refresh();
        else if (mapError) { setMapReady(false); setMapError(false); setMapRetry(v => v + 1); }
        if (tracking === 'error') void Linking.openSettings();
        return;
    }
  };

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
  const floatTop = insets.top + (pending > 0 ? 134 : 108);
  const attentionShowing = Boolean(attentionView.current);

  return (
    <View style={s.screen}>
      <RideMap
        offline={!sync.isOnline}
        s={s}
        theme={theme}
        mapRetry={mapRetry}
        sheetHeight={sheetHeight}
        cameraRef={camera}
        origin={ride.origin_coords}
        destination={ride.destination_coords}
        route={route}
        trail={actualTrailGeoJson}
        riders={riderFeatures}
        roadReports={roadReportsFlag ? roadFeatures : undefined}
        onRoadReportPress={reportId => setRoadSheet({ open: true, selectedId: reportId })}
        onReady={() => { setMapReady(true); setMapError(false); }}
        onError={() => setMapError(true)}
        onUserGesture={() => setFollow(false)}
      />

      {/* Floating Slim Cockpit Status Strip (Top-aligned Glove Glance) */}
      <View style={[s.cockpitStatusStrip, { top: insets.top + 6 }]}>
        <TouchableOpacity style={s.statusPillItem}
          disabled={!canRetryFix}
          accessibilityRole="button" accessibilityHint="Restart GPS to request a new fix"
          onPress={() => setGpsRetry(v => v + 1)}>
          <LiveDot pulse={gps.state === 'fresh'} size={6} color={gpsColor} />
          <Text style={[s.statusStripText, { color: gpsColor }]}>
            {gps.label}{canRetryFix ? ' · Retry' : ''}
          </Text>
        </TouchableOpacity>
        <View style={s.statusPillItem}>
          <Icon name={sync.isOnline ? 'cellular-outline' : 'cloud-offline-outline'} size="xs" color={sync.isOnline ? theme.textMuted : theme.danger} />
          <Text style={s.statusStripText}>{sync.isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
        </View>
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
        <TouchableOpacity accessibilityLabel="Emergency SOS" style={s.sosTopButton} onPress={() => { setModal(false); triggerSosWorkflow(); }}>
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

      {/* Floating next waypoint pin. Hidden while the attention bar is up, so only one thing competes for the eye. */}
      {active && nextWaypoint && !attentionShowing && (
        <View style={[s.floatingApexPin, { top: floatTop }]}>
          <Icon name="flag-outline" size="md" color={theme.accent} />
          <View>
            <Text style={s.apexPinTitle} numberOfLines={1}>{nextWaypoint.name}</Text>
            <Text style={s.apexPinSub}>
              {distanceToNextStopMeters != null ? `${(distanceToNextStopMeters / 1000).toFixed(1)} KM • PASS APEX` : 'NEXT STOP'}
            </Text>
          </View>
        </View>
      )}

      {/* Floating Recenter Map Controls */}
      {!attentionShowing && (
        <View style={[s.controls, { top: floatTop }]}>
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
      )}

      {/* The one alert surface. */}
      <RideAttentionBar
        items={attentionItems}
        dismissedIds={dismissedAttention}
        now={now}
        top={floatTop}
        onAction={handleAttentionAction}
        onDismiss={dismissAttention}
      />

      {/* Bottom Console Sheet: Glanceable Telemetry & Giant 64dp+ Action Deck */}
      <View
        onLayout={event => setSheetHeight(event.nativeEvent.layout.height)}
        style={[s.sheet, { paddingBottom: Math.max(insets.bottom + 12, 28) }, expanded && s.sheetExpanded]}
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
            {active && (
              <RideHud
                s={s}
                theme={theme}
                targetName={nextWaypoint ? nextWaypoint.name : ride.destination || 'Summit Base'}
                distanceToNextStopMeters={distanceToNextStopMeters}
                distanceCoveredMeters={hudDistanceCovered}
                currentSpeedKmh={currentSpeedKmh}
                onOpenStats={() => setStatsModalVisible(true)}
              />
            )}
          </TouchableOpacity>
        </View>

        {/* Giant Glove-Friendly Action Deck (Min 64dp Touch Targets) */}
        {active && (
          <View style={s.giantActionDeck}>
            <View style={s.actionGridRow}>
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
                  <Text style={s.giantBtnSubtitle}>{arrivingRegroupPoint ? 'Confirm Arrival' : 'Drop Marker'}</Text>
                </View>
              </TouchableOpacity>

              {/* Hold-to-Confirm Emergency SOS (2s Radial Countdown) */}
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
                        <Text style={s.formationBadgeText}>{rider.isLeader ? 'LEAD' : rider.isTail ? 'SWEEP' : `#${rider.order}`}</Text>
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
                            { text: 'End ride', style: 'destructive', onPress: () => void endRideForEveryone() },
                          ])
                        }
                      >
                        <Text style={s.endRideText}>End Ride</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            ) : (
              <CaptainStepCard
                leader={leader}
                rideStatus={ride.status}
                phase={captainFlow.phase}
                rollCallHeadline={captainFlow.rollCall.headline}
                briefingShared={Boolean(captainFlow.briefing)}
                briefingRead={captainFlow.briefingRead}
                myCheckIn={captainFlow.myCheckIn}
                debriefSaved={Boolean(captainFlow.savedDebrief)}
                onBriefing={() => setBriefingVisible(true)}
                onRollCall={() => { void captainFlow.refreshRollCall(); setRollCallVisible(true); }}
                onCheckInSelf={() => { if (userId) void captainFlow.setRiderStatus(userId, 'checked_in').catch(() => {}); }}
                onDebrief={() => setDebriefVisible(true)}
              />
            )}

            {(ride.status === 'active' || ride.status === 'planned') && (
              <FamilyUpdatesRow rideId={id} live={active} onShareLink={() => void shareFamilySpectatorLink()} />
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

      {/* Sheets */}
      <AlertPickerSheet
        s={s}
        theme={theme}
        bottomInset={insets.bottom}
        visible={modal}
        onClose={() => setModal(false)}
        busy={busy}
        isCaptain={admin}
        onAnnouncement={() => { setModal(false); setAnnouncementModal(true); }}
        onMechanical={() => { setModal(false); setMechanicalModalVisible(true); }}
        onSos={() => { setModal(false); triggerSosWorkflow(); }}
        onAlert={type => void sendAlert(type).then(outcome => { if (outcome !== 'failed') setModal(false); })}
        onRoadsideHelp={() => { setModal(false); void loadBreakdownDirectory(); }}
        onRoadReport={roadReportsFlag ? () => { setModal(false); setRoadSheet({ open: true, selectedId: null }); } : undefined}
      />

      <RoadReportSheet
        visible={roadSheet.open}
        onClose={() => setRoadSheet({ open: false, selectedId: null })}
        bottomInset={insets.bottom}
        hasFix={Boolean(position)}
        online={sync.isOnline}
        selected={road.reports.find(r => r.id === roadSheet.selectedId) ?? null}
        canHide={leader}
        onReport={road.report}
        onConfirm={reportId => void road.confirm(reportId)}
        onHide={reportId => void road.hide(reportId)}
      />

      <AnnouncementSheet
        s={s}
        theme={theme}
        bottomInset={insets.bottom}
        visible={announcementModal}
        onClose={() => setAnnouncementModal(false)}
        busy={busy}
        message={message}
        customAnnouncement={customAnnouncement}
        setCustomAnnouncement={setCustomAnnouncement}
        onBroadcast={msg => void broadcastAnnouncement(msg)}
      />

      <SosSheet
        s={s}
        theme={theme}
        bottomInset={insets.bottom}
        visible={sos.sosModal}
        busy={busy}
        emergencyContact={profile?.emergency_contact}
        started={sos.started}
        steps={sos.steps}
        recipients={sos.recipients}
        primaryLabel={sos.primaryLabel}
        onClose={sos.closeSos}
        onPrimary={() => void (sos.started ? sos.openComposer() : sos.sendSos())}
        onCallContact={() => void sos.dialEmergencyContact()}
        onCall112={() => void sos.dial112()}
        onHighwayHelp={() => { sos.closeSos(); void loadBreakdownDirectory(); }}
      />

      <RideStatsSheet
        s={s}
        theme={theme}
        bottomInset={insets.bottom}
        visible={statsModalVisible}
        onClose={() => setStatsModalVisible(false)}
        liveStats={liveStats}
        batterySentence={battery.levelPercent != null ? `${battery.levelPercent}% now. ${batteryEstimate.sentence}` : batteryEstimate.sentence}
      />

      <BriefingSheet
        visible={briefingVisible}
        onClose={() => setBriefingVisible(false)}
        bottomInset={insets.bottom}
        isLeader={leader}
        briefing={captainFlow.briefing}
        trip={briefingTrip}
        onPublish={captainFlow.publishBriefing}
        onOpened={captainFlow.markBriefingRead}
      />
      {leader && (
        <RollCallSheet
          visible={rollCallVisible}
          onClose={() => setRollCallVisible(false)}
          bottomInset={insets.bottom}
          summary={captainFlow.rollCall}
          onSetStatus={captainFlow.setRiderStatus}
          onStart={startRideFromRollCall}
        />
      )}
      {leader && (
        <DebriefSheet
          visible={debriefVisible}
          onClose={() => setDebriefVisible(false)}
          bottomInset={insets.bottom}
          generated={captainFlow.generatedDebrief}
          saved={captainFlow.savedDebrief}
          onSave={captainFlow.saveDebrief}
        />
      )}

      {admin && (
        <CaptainDashboard
          s={s}
          theme={theme}
          bottomInset={insets.bottom}
          visible={captainDashboardVisible}
          onClose={() => setCaptainDashboardVisible(false)}
          busy={busy}
          liveStats={liveStats}
          packFormation={packFormation}
          participantsCount={participants.length}
          regroupPoints={regroupPoints}
          alerts={alerts}
          acknowledgementMap={acknowledgementMap}
          hasActiveSpectatorLink={hasActiveSpectatorLink}
          onPaceAdvisory={(kmh, label) => void broadcastPaceAdvisory(kmh, label)}
          onCloseRegroup={pointId => void handleCloseRegroup(pointId)}
          onNewBroadcast={() => { setCaptainDashboardVisible(false); setAnnouncementModal(true); }}
          onShareFamilyLink={() => void shareFamilySpectatorLink(24)}
          onRevokeFamilyLinks={() => void revokeFamilySpectatorLink()}
          onRoadsideHelp={() => { setCaptainDashboardVisible(false); void loadBreakdownDirectory(); }}
        />
      )}

      <UpgradePromptModal
        visible={upgradePromptVisible}
        rideId={id}
        featureTitle="Live Family Spectator Link"
        featureDescription="Share a read-only live map link with family and friends (no app install required). Unlock with Pro Tourer or an Expedition Pass."
        onClose={() => setUpgradePromptVisible(false)}
      />

      <TripChatSheet
        visible={chatVisible}
        onClose={() => setChatVisible(false)}
        lines={chat.lines}
        summary={chat.summary}
        isOnline={sync.isOnline}
        onSend={chat.send}
        onRetry={message => void chat.retry(message)}
      />

      <MechanicalSheet
        s={s}
        theme={theme}
        bottomInset={insets.bottom}
        visible={mechanicalModalVisible}
        onClose={() => setMechanicalModalVisible(false)}
        busy={busy}
        onSend={sendMechanicalBreakdownAlert}
        onDirectory={() => { setMechanicalModalVisible(false); void loadBreakdownDirectory(); }}
      />

      <BreakdownDirectorySheet
        s={s}
        theme={theme}
        bottomInset={insets.bottom}
        visible={breakdownDirectoryVisible}
        onClose={() => setBreakdownDirectoryVisible(false)}
        services={breakdownServices}
      />
    </View>
  );
}
