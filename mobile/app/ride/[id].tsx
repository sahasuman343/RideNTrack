import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, ActivityIndicator, Alert as Dialog, Share, Linking, Dimensions, Platform, Image, ScrollView, TextInput } from 'react-native';
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
  getRiderLiveStatus,
  type RiderLiveStatus,
  calculatePackFormation,
  type PackRiderProgress,
  calculateLiveRideStats,
  type LiveRideStats,
  type MechanicalIssueType,
  MECHANICAL_ISSUE_LABELS,
  type AlertAcknowledgement,
  formatEmergencySms,
  formatMechanicalBreakdownMessage,
  NATIONAL_EMERGENCY_HELPLINES,
  SEEDED_BREAKDOWN_DIRECTORY,
  type VerifiedBreakdownService,
} from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRide } from '../../src/hooks/useRide';
import { useOfflineSync } from '../../src/hooks/useOfflineSync';
import { useRideTheme, RidePalette } from '../../src/theme';
import { enqueueAlert, newQueueId } from '../../src/lib/offlineQueue';
import { enableBackgroundLocationUpdates, startBackgroundLocationUpdates, stopBackgroundLocationUpdates } from '../../src/services/backgroundLocation';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
let Mapbox: typeof import('@rnmapbox/maps').default | null = null;
if (MAPBOX_TOKEN) {
  try { Mapbox = require('@rnmapbox/maps').default; Mapbox?.setAccessToken(MAPBOX_TOKEN); }
  catch { /* Native maps are unavailable in Expo Go; the rider panel still works. */ }
}



export default function LiveRideScreen() {
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
  const { ride, participants, alerts, connection, error, publish, refresh, setRide } = useRide(id, userId || '');
  const sync = useOfflineSync();
  const camera = useRef<React.ComponentRef<typeof Camera>>(null);
  const [position, setPosition] = useState<LocationUpdate | null>(null);
  const [tracking, setTracking] = useState<'waiting' | 'background' | 'foreground' | 'paused' | 'error'>('waiting');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(true);
  const [gpsRetry, setGpsRetry] = useState(0);
  const [backgroundPermissionGranted, setBackgroundPermissionGranted] = useState(false);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(200);
  const { height: windowHeight, width: windowWidth } = Dimensions.get('window');
  const active = ride?.status === 'active';
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
  const lastCameraPosition = useRef<{ lat: number; lng: number } | null>(null);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [route, setRoute] = useState<Ride['route_geometry']>();
  const [trailCoordinates, setTrailCoordinates] = useState<[number, number][]>([]);
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
  const [breakdownServices, setBreakdownServices] = useState<VerifiedBreakdownService[]>(SEEDED_BREAKDOWN_DIRECTORY);
  const [acknowledgedAlertIds, setAcknowledgedAlertIds] = useState<string[]>([]);
  const [acknowledgementMap, setAcknowledgementMap] = useState<Record<string, { count: number; riders: string[] }>>({});
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  const lastSafetyAlertAt = useRef<Record<string, number>>({});
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
  const points = useMemo(() => position && active ? [...participants.filter(p => p.user_id !== userId), position] : participants, [participants, position, active, userId]);
  const packFormation = useMemo(() => {
    const routeCoords = route?.geometry?.coordinates;
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) return [];
    return calculatePackFormation(points, routeCoords, ride?.rider_behind_threshold_meters || 1000);
  }, [points, route?.geometry?.coordinates, ride?.rider_behind_threshold_meters]);
  // Keep map input tied to actual GPS samples. Per-frame JS marker animation
  // repeatedly rebuilds GeoJSON and is costly on entry-level Android devices.
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
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()),15000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!active || !position || !userId || isStale(position.timestamp, now) || !ride) return;
    const publishSafetyAlert = async (key: string, type: AlertType, lat: number, lng: number, message: string) => {
      const last = lastSafetyAlertAt.current[key] || 0;
      if (now - last < 5 * 60 * 1000) return;
      lastSafetyAlertAt.current[key] = now;
      try {
        await enqueueAlert({ id: await newQueueId(), ride_id: id, user_id: userId, type, lat, lng, message, created_at: new Date(now).toISOString() });
        void sync.flushQueue();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Could not publish a group safety alert.');
      }
    };
    const routeCoordinates = route?.geometry?.coordinates;
    if (Array.isArray(routeCoordinates) && routeCoordinates.length >= 2) {
      const deviation = distanceToRouteMeters(position, routeCoordinates);
      const limit = ride.route_deviation_threshold_meters || 500;
      setRouteDeviation(deviation);
      if (deviation > limit) void publishSafetyAlert('route-deviation', 'route_deviation', position.lat, position.lng,
        'Rider is approximately ' + Math.round(deviation) + ' m from the planned route (threshold ' + limit + ' m).');
    } else {
      setRouteDeviation(null);
    }
    const leader = (admin ? position : participants.find(point => point.user_id === ride.admin_id && !isStale(point.timestamp, now)));
    if (admin && leader && Number.isFinite(leader.lat) && Number.isFinite(leader.lng)) {
      for (const rider of participants) {
        if (rider.user_id === ride.admin_id || isStale(rider.timestamp, now)) continue;
        const gap = distanceMeters(leader, rider);
        const limit = ride.rider_behind_threshold_meters || 1000;
        if (gap > limit) void publishSafetyAlert('rider-behind-' + rider.user_id, 'rider_behind', rider.lat, rider.lng,
          rider.display_name + ' is approximately ' + Math.round(gap) + ' m from the leader (threshold ' + limit + ' m).');
      }
    } else if (!admin && leader && Number.isFinite(leader.lat) && Number.isFinite(leader.lng)) {
      const gap = distanceMeters(leader, position);
      const limit = ride.rider_behind_threshold_meters || 1000;
      if (gap > limit) void publishSafetyAlert('rider-behind-self', 'rider_behind', position.lat, position.lng,
        'You are approximately ' + Math.round(gap) + ' m from the leader (threshold ' + limit + ' m).');
    }
  }, [active,position,participants,route,ride?.id,ride?.admin_id,ride?.route_deviation_threshold_meters,ride?.rider_behind_threshold_meters,admin,userId,id,now,sync.flushQueue]);

  useEffect(() => {
    if (!active || !sharing || !userId) {
      setTracking('paused');
      void stopBackgroundLocationUpdates().catch(e => setGpsError(e.message));
      return;
    }
    let cancelled = false;
    setTracking('waiting'); setGpsError(null);
    void startBackgroundLocationUpdates({
      rideId: id,
      userId,
      displayName: nameRef.current,
      publish,
      batterySaver,
      onLocationUpdate: p => { if (!cancelled) setPosition(p); },
      onError: e => { if (!cancelled) setGpsError(e); },
      onGpsRecovered: () => {
        if (!cancelled) {
          setGpsRecoveryStatus('recovered');
          setTimeout(() => setGpsRecoveryStatus('normal'), 6000);
        }
      },
    }).then(result => { if (!cancelled) setTracking(result.isBackgroundEnabled ? 'background' : 'foreground'); })
      .catch(e => { if (!cancelled) { setTracking('error'); setGpsError(e.message); } });
    return () => { cancelled = true; void stopBackgroundLocationUpdates().catch(() => {}); };
  }, [id,userId,active,sharing,publish,gpsRetry,batterySaver]);
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
  }, [mapReady,follow,position,cameraPadding]);
  useEffect(() => {
    let cancelled = false;
    setUpcomingWaypoints([]);
    setTargetWaypointIndex(0);
    void supabase.from('trip_waypoints')
      .select('name,latitude,longitude,provider_place_id,sequence')
      .eq('ride_id', id)
      .neq('waypoint_type', 'origin')
      .order('sequence', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && Array.isArray(data)) setUpcomingWaypoints(data);
      });
    void supabase.rpc('get_regroup_points', { p_ride_id: id })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && Array.isArray(data)) setRegroupPoints(data as any);
      });
    return () => { cancelled = true; };
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
    if (!id || !userId) return;
    let cancelled = false;
    supabase
      .from('location_updates')
      .select('lat,lng')
      .eq('ride_id', id)
      .eq('user_id', userId)
      .order('timestamp', { ascending: true })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data)) return;
        const historical: [number, number][] = data
          .filter(d => typeof d.lng === 'number' && typeof d.lat === 'number' && Number.isFinite(d.lng) && Number.isFinite(d.lat))
          .map(d => [Number(d.lng), Number(d.lat)]);
        if (historical.length > 0) {
          setTrailCoordinates(curr => {
            if (curr.length === 0) return historical;
            return [...historical, ...curr];
          });
        }
      });
    return () => { cancelled = true; };
  }, [id, userId]);

  useEffect(() => {
    if (!position || typeof position.lng !== 'number' || typeof position.lat !== 'number' || !Number.isFinite(position.lng) || !Number.isFinite(position.lat)) return;
    setTrailCoordinates(prev => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last[0] - position.lng) < 0.00005 && Math.abs(last[1] - position.lat) < 0.00005) {
        return prev;
      }
      return [...prev, [position.lng, position.lat]];
    });
  }, [position?.lng, position?.lat]);

  const actualTrailGeoJson = useMemo(() => {
    if (trailCoordinates.length < 2) return null;
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: trailCoordinates,
      },
      properties: {},
    };
  }, [trailCoordinates]);

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

  const distanceCoveredMeters = useMemo(() => {
    if (trailCoordinates.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < trailCoordinates.length; i++) {
      const prev = trailCoordinates[i - 1];
      const curr = trailCoordinates[i];
      sum += distanceMeters(
        { lat: prev[1], lng: prev[0] },
        { lat: curr[1], lng: curr[0] },
      );
    }
    return Math.round(sum);
  }, [trailCoordinates]);

  const distanceToNextStopMeters = useMemo(() => {
    if (!position || !nextWaypoint) return null;
    return Math.round(distanceMeters(position, { lat: nextWaypoint.latitude, lng: nextWaypoint.longitude }));
  }, [position?.lat, position?.lng, nextWaypoint?.latitude, nextWaypoint?.longitude]);

  const currentSpeedKmh = position?.speed ? Math.round(position.speed * 3.6) : 0;

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
      await Linking.openURL(buildGoogleMapsNavigationUrl({
        latitude: nextWaypoint.latitude,
        longitude: nextWaypoint.longitude,
        placeId: nextWaypoint.provider_place_id,
      }));
    } catch (e: any) {
      Dialog.alert('Could not open navigation', e?.message || 'Please check that a maps app is available and try again.');
    }
  }

  useEffect(() => {
    if (ride?.route_geometry) { setRoute(ride.route_geometry); return; }
    if (!ride || !Array.isArray(ride.origin_coords) || !Array.isArray(ride.destination_coords) || !MAPBOX_TOKEN) return;
    const controller = new AbortController();
    const load = async () => {
      const response = await fetch('https://api.mapbox.com/directions/v5/mapbox/driving/' + ride.origin_coords.join(',') + ';' + ride.destination_coords.join(',') + '?geometries=geojson&overview=simplified&access_token=' + MAPBOX_TOKEN, { signal: controller.signal });
      if (!response.ok) throw new Error('Route unavailable. Rider positions still work.');
      const data = await response.json();
      if (!data.routes?.[0]) throw new Error('No driving route found.');
      const geo: NonNullable<Ride['route_geometry']> = { type: 'Feature', geometry: data.routes[0].geometry, properties: {} };
      if (controller.signal.aborted) return;
      setRoute(geo);
      if (admin) {
        const { error } = await supabase.from('rides').update({ route_geometry: geo }).eq('id',id);
        if (error) throw error;
      }
    };
    void load().catch(e => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, [ride?.id,ride?.route_geometry,admin,id]);
  function fitGroup() {
    setFollow(false);
    const coords = points.length ? points.map(p => [p.lng,p.lat]) : (ride && Array.isArray(ride.origin_coords) && Array.isArray(ride.destination_coords)) ? [ride.origin_coords,ride.destination_coords] : [];
    const validCoords = coords.filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!validCoords.length) return;
    try {
      if (validCoords.every(p => p[0] === validCoords[0][0] && p[1] === validCoords[0][1])) {
        camera.current?.setCamera({ centerCoordinate: validCoords[0],zoomLevel: 14,padding: cameraPadding,animationMode: 'easeTo',animationDuration: 800 });
        return;
      }
      camera.current?.fitBounds([Math.max(...validCoords.map(p => p[0])),Math.max(...validCoords.map(p => p[1]))],
        [Math.min(...validCoords.map(p => p[0])),Math.min(...validCoords.map(p => p[1]))], [cameraPadding.paddingTop,45,cameraPadding.paddingBottom,45],800);
    } catch {
      /* Ignore camera bounds error */
    }
  }
  async function enableBackgroundGps() {
    if (!userId) return;
    setGpsError(null);
    setMessage(null);
    let startupFailed = false;
    try {
      const result = await enableBackgroundLocationUpdates({
        rideId: id,
        userId,
        displayName: name,
        publish,
        onLocationUpdate: setPosition,
        onError: error => { startupFailed = true; setGpsError(error); },
      });
      if (result.permissionGranted) setBackgroundPermissionGranted(true);
      if (result.isBackgroundEnabled) {
        setTracking('background');
        setBackgroundPermissionGranted(true);
        setMessage(null);
      } else if (result.permissionGranted && !startupFailed) {
        setMessage('Background permission granted. Tap Start background GPS again to activate it.');
      }
    } catch (e) {
      // Permission APIs can reject on OEM Android builds. Never let a rejected
      // native-module promise escape a button callback as an unhandled error.
      setGpsError(e instanceof Error ? e.message : 'Android could not enable background GPS.');
      setTracking('foreground');
    }
  }
  async function changeStatus(status: 'active' | 'completed') {
    setBusy(true); setMessage(null);
    try {
      const { data,error } = await supabase.from('rides').update({ status }).eq('id',id).select().single();
      if (error) throw error;
      setRide(data as Ride);
      if (status === 'completed') { await stopBackgroundLocationUpdates(); await sync.flushQueue(); }
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not update ride.'); }
    finally { setBusy(false); }
  }
  async function sendAlert(type: AlertType, customMessage?: string): Promise<boolean> {
    if (!position || !userId || isStale(position.timestamp)) {
      setMessage('Wait for a fresh GPS fix before sending an alert.');
      return false;
    }
    setBusy(true);
    try {
      await enqueueAlert({ id: await newQueueId(), ride_id: id, user_id: userId, type, message: customMessage, lat: position.lat, lng: position.lng, created_at: new Date().toISOString() });
      setModal(false);
      await sync.flushQueue();
      await refresh();
      return true;
    } catch(e) {
      setMessage(e instanceof Error ? e.message : 'Could not save alert.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function broadcastAnnouncement(msg: string): Promise<boolean> {
    if (!msg || !msg.trim()) return false;
    const ok = await sendAlert('announcement', msg.trim());
    if (ok) {
      setAnnouncementModal(false);
      setCustomAnnouncement('');
      setMessage(`📢 Broadcast sent: "${msg.trim()}"`);
      return true;
    }
    return false;
  }

  async function confirmArrival(regroupPointId: string) {
    setBusy(true);
    try {
      const { error: confirmError } = await supabase.rpc('confirm_regroup_arrival', { p_regroup_point_id: regroupPointId });
      if (confirmError) throw confirmError;
      setRegroupPoints(prev => prev.map(p => p.id === regroupPointId ? { ...p, my_arrived: true } : p));
      setArrivingRegroupPoint(null);
      setMessage('✅ Confirmed arrival at regroup point!');
    } catch (e: any) {
      setMessage(e?.message || 'Could not confirm arrival.');
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeAnnouncement(alertId: string) {
    if (!alertId) return;
    setAcknowledgedAlertIds(prev => prev.includes(alertId) ? prev : [...prev, alertId]);
    try {
      await supabase.rpc('acknowledge_alert', { p_alert_id: alertId });
      setMessage('👍 Acknowledged announcement');
    } catch {
      // Offline fallback: keep local state
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
      setRegroupPoints(prev => prev.map(p => p.id === pointId ? { ...p, status: 'closed', closed_at: new Date().toISOString() } : p));
      if (arrivingRegroupPoint?.id === pointId) {
        setArrivingRegroupPoint(null);
      }
      await broadcastAnnouncement('🏁 Regroup point completed. Pack is resuming ride!');
    } catch (e: any) {
      setMessage(e?.message || 'Could not close regroup point.');
    } finally {
      setBusy(false);
    }
  }

  async function broadcastPaceAdvisory(paceKmh: number, label: string) {
    await broadcastAnnouncement(`⚡ Pace Advisory: Target ${paceKmh} km/h (${label})`);
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
    setMechanicalModalVisible(false);
    setMechanicalDetails('');
    await sendAlert('mechanical', msg);
    setMessage(`🔧 Mechanical alert sent: ${MECHANICAL_ISSUE_LABELS[selectedMechanicalIssue].label}`);
    Dialog.alert(
      'Mechanical Assistance',
      'Alert broadcast to your pack with your live GPS location. Would you like to view roadside assistance & breakdown helplines?',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'View Directory', onPress: () => void loadBreakdownDirectory() },
      ]
    );
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
    Dialog.alert(
      '🚨 Escalate Emergency (112)',
      'Direct dial National Emergency Helpline 112 immediately?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call 112', style: 'destructive', onPress: () => void Linking.openURL('tel:112') },
      ]
    );
  }

  useEffect(() => {
    if (captainDashboardVisible) {
      const announcements = alerts.filter(a => a.type === 'announcement');
      for (const a of announcements) {
        void fetchAcknowledgements(a.id);
      }
      void supabase.rpc('get_regroup_points', { p_ride_id: id })
        .then(({ data, error }) => {
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
    await sendAlert('emergency');
    setMessage('🚨 Emergency alert broadcast to group with your live coordinates.');
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
      setMessage('🚨 Emergency SOS initiated.');
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
  const status = !sync.isOnline ? 'Offline · saved on device' : connection !== 'live' ? 'Reconnecting…' :
    !active ? ride?.status === 'completed' ? 'Ride completed' : 'Ready to ride' :
    tracking === 'background' ? 'Live · background GPS' : tracking === 'foreground' ? 'Live · keep app open' :
    tracking === 'waiting' ? 'Getting GPS fix…' : tracking === 'error' ? 'GPS unavailable' : 'Location sharing paused';
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };
  if (!ride) return (
    <View style={s.loading}>
      <Image source={require('../../assets/RnT_logo.png')} style={{ width: 64, height: 64, borderRadius: 16 }} resizeMode="contain" />
      <Text style={s.brand}>RIDEN TRACK</Text>
      {error ? <Text style={s.text}>{error}</Text> : <ActivityIndicator color="#d66029" />}
      <TouchableOpacity onPress={() => void refresh()}><Text style={s.link}>Retry connection</Text></TouchableOpacity>
      <TouchableOpacity onPress={handleBack}><Text style={s.link}>Back to rides</Text></TouchableOpacity>
    </View>
  );
  return <View style={s.screen}>
    {Mapbox && MAPBOX_TOKEN ? <Mapbox.MapView style={StyleSheet.absoluteFill} styleURL={theme ? (theme.text === "#F2F0E8" ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/outdoors-v12") : "mapbox://styles/mapbox/outdoors-v12"}
      onDidFinishLoadingMap={() => { setMapReady(true); setMapError(false); }} onMapLoadingError={() => setMapError(true)}
      onCameraChanged={state => { if (state?.gestures?.isGestureActive) setFollow(false); }}
      logoPosition={{ bottom: Math.min(sheetHeight + 8, 120), left: 10 }} attributionPosition={{ bottom: Math.min(sheetHeight + 8, 120), right: 10 }} compassEnabled>
      <Mapbox.Camera ref={camera} defaultSettings={{ centerCoordinate: (Array.isArray(ride.origin_coords) && ride.origin_coords.length === 2 && Number.isFinite(ride.origin_coords[0]) && Number.isFinite(ride.origin_coords[1])) ? ride.origin_coords : [77.5946, 12.9716], zoomLevel: 11 }} />
      {route && route.geometry && Array.isArray(route.geometry.coordinates) && route.geometry.coordinates.length >= 2 && (
        <Mapbox.ShapeSource id="route" shape={route}><Mapbox.LineLayer id="route-edge" style={{ lineColor: '#fff',lineWidth: 8,lineCap: 'round',lineJoin: 'round' }} /><Mapbox.LineLayer id="route-line" style={{ lineColor: '#de7136',lineWidth: 4,lineCap: 'round',lineJoin: 'round' }} /></Mapbox.ShapeSource>
      )}
      {actualTrailGeoJson && (
        <Mapbox.ShapeSource id="actual-trail" shape={actualTrailGeoJson}>
          <Mapbox.LineLayer
            id="actual-trail-edge"
            style={{
              lineColor: '#0284c7',
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
      <Mapbox.ShapeSource id="endpoints" shape={{
        type: 'FeatureCollection',
        features: [ride.origin_coords, ride.destination_coords]
          .filter((c): c is [number, number] => Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && Number.isFinite(c[0]) && Number.isFinite(c[1]))
          .map((coordinates, i) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates },
            properties: { label: i === 0 ? 'A' : 'B' },
          })),
      }}>
        <Mapbox.CircleLayer id="endpoint-dot" style={{ circleColor: '#213e44', circleRadius: 13, circleStrokeWidth: 3, circleStrokeColor: theme.surface }} />
        <Mapbox.SymbolLayer id="endpoint-label" style={{ textField: ['coalesce', ['to-string', ['get', 'label']], ''], textSize: 12, textColor: '#fff' }} />
      </Mapbox.ShapeSource>
      <Mapbox.ShapeSource id="riders" shape={features}>
        <Mapbox.CircleLayer id="rider-halo" style={{ circleRadius: 18, circleColor: theme.accent, circleOpacity: 0.18 }} />
        <Mapbox.CircleLayer id="rider-dot" style={{
          circleRadius: 8,
          circleColor: [
            'case',
            ['==', ['get', 'mine'], true], theme.accent,
            ['==', ['get', 'status'], 'disconnected'], theme.subtle,
            ['==', ['get', 'status'], 'stopped'], '#EAB308',
            theme.green,
          ],
          circleStrokeWidth: 3,
          circleStrokeColor: '#fff',
        }} />
        <Mapbox.SymbolLayer id="rider-label" style={{
          textField: ['coalesce', ['to-string', ['get', 'name']], 'Rider'],
          textOffset: [0, 1.8],
          textSize: 12,
          textColor: theme.text,
          textHaloColor: theme.surface,
          textHaloWidth: 2,
        }} />
      </Mapbox.ShapeSource>
    </Mapbox.MapView> : <View style={s.fallback}><Text style={s.heading}>Your ride, together.</Text><Text style={s.muted}>The native map needs a development build and a Mapbox token. Your rider list and foreground GPS remain available.</Text></View>}
    <View style={[s.top, { top: insets.top + 10 }]}>
      <TouchableOpacity accessibilityLabel="Back to rides" style={s.square} onPress={handleBack}>
        <Text style={s.backIcon}>‹</Text>
      </TouchableOpacity>
      <View style={s.title}>
        <Text numberOfLines={1} style={s.heading}>{ride.name}</Text>
        <Text numberOfLines={1} style={s.muted}>{ride.origin} → {ride.destination}</Text>
      </View>
      <TouchableOpacity accessibilityLabel="Emergency SOS" style={s.sosTopButton} onPress={triggerSosWorkflow}>
        <Text style={s.sosTopButtonText}>SOS</Text>
      </TouchableOpacity>
      {admin && (
        <TouchableOpacity accessibilityLabel="Captain Dashboard" style={[s.square, { borderColor: theme.accent }]} onPress={() => setCaptainDashboardVisible(true)}>
          <Text style={[s.topBarIcon, { color: theme.accent }]}>👑</Text>
        </TouchableOpacity>
      )}
      {(admin || ride?.status === 'completed') && (
        <TouchableOpacity accessibilityLabel="Trip details" style={s.square} onPress={() => router.push('/trip/' + id)}>
          <Text style={s.topBarIcon}>✎</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity accessibilityLabel="Live Ride Statistics" style={s.square} onPress={() => setStatsModalVisible(true)}>
        <Text style={s.topBarIcon}>📊</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Share ride code" style={s.square} onPress={() => void Share.share({ message: 'Join ' + ride.name + ' on RideNTrack. Code: ' + ride.ride_code }).catch(() => setMessage('Could not open sharing.'))}>
        <Text style={s.topBarIcon}>↗</Text>
      </TouchableOpacity>
    </View>

    {active && (
      <TouchableOpacity activeOpacity={0.85} onPress={() => setStatsModalVisible(true)} style={[s.hudContainer, { top: insets.top + 74 }]}>
        <View style={s.hudItem}>
          <Text style={s.hudValue}>{currentSpeedKmh}</Text>
          <Text style={s.hudLabel}>KM/H</Text>
        </View>
        <View style={s.hudDivider} />
        <View style={s.hudItem}>
          <Text style={s.hudValue}>
            {distanceCoveredMeters >= 1000
              ? (distanceCoveredMeters / 1000).toFixed(1) + ' km'
              : distanceCoveredMeters + ' m'}
          </Text>
          <Text style={s.hudLabel}>TRAIL</Text>
        </View>
        <View style={s.hudDivider} />
        <View style={s.hudItem}>
          <Text style={s.hudValue}>
            {distanceToNextStopMeters != null
              ? (distanceToNextStopMeters >= 1000
                  ? (distanceToNextStopMeters / 1000).toFixed(1) + ' km'
                  : distanceToNextStopMeters + ' m')
              : '—'}
          </Text>
          <Text style={s.hudLabel}>NEXT STOP</Text>
        </View>
        <View style={s.hudDivider} />
        <View style={s.hudItem}>
          <Text style={[s.hudValue, { color: theme.accent }]}>📊</Text>
          <Text style={s.hudLabel}>STATS</Text>
        </View>
      </TouchableOpacity>
    )}

    {gpsRecoveryStatus === 'recovered' && (
      <View style={[s.arrivalToast, { backgroundColor: '#22c55e', top: insets.top + (active ? 186 : 124) }]}>
        <Text style={s.arrivalToastText}>
          🛰️ GPS signal restored! Tracking resumed smoothly.
        </Text>
      </View>
    )}

    <View style={[s.controls, { top: insets.top + (active ? 134 : 74) }]}>
      <TouchableOpacity accessibilityLabel="Follow my location" style={[s.control, follow && s.selected]} disabled={!position} onPress={() => { lastCameraPosition.current = null; setFollow(true); }}>
        <Text style={[s.controlText, follow && s.selectedText]}>◎ Me</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.control} onPress={fitGroup}>
        <Text style={s.controlText}>⊞ Group</Text>
      </TouchableOpacity>
    </View>

    {arrivingRegroupPoint && (
      <View style={[s.regroupBanner, { top: insets.top + (active ? 186 : 124) }]}>
        <Text numberOfLines={1} style={s.regroupBannerText}>📍 Near Regroup: {arrivingRegroupPoint.name}</Text>
        <TouchableOpacity style={s.confirmRegroupButton} disabled={busy} onPress={() => void confirmArrival(arrivingRegroupPoint.id)}>
          <Text style={s.confirmRegroupText}>Confirm arrival</Text>
        </TouchableOpacity>
      </View>
    )}

    {routeDeviation != null && routeDeviation > (ride?.route_deviation_threshold_meters || 500) && (
      <View style={[s.deviationWarning, { top: insets.top + (active ? 186 : 124) }]}>
        <Text style={s.deviationWarningText}>
          ⚠️ Route Deviation: ~{Math.round(routeDeviation)} m from planned route
        </Text>
      </View>
    )}

    {lastArrivedWaypoint && (
      <View style={[s.arrivalToast, { top: insets.top + (active ? 186 : 124) }]}>
        <Text style={s.arrivalToastText}>
          🏁 Arrived at {lastArrivedWaypoint}! Next stop loaded.
        </Text>
      </View>
    )}

    {(message || gpsError || error || mapError) && <View style={[s.warning,{ top: insets.top + (active ? 228 : 140) }]}><Text style={s.warningText}>{message || gpsError || error || 'Map tiles could not load. GPS data is still saved locally.'}</Text><TouchableOpacity onPress={() => { setMessage(null); setGpsRetry(v => v + 1); void refresh(); }}><Text style={s.link}>Retry</Text></TouchableOpacity>{tracking === 'error' && <TouchableOpacity onPress={() => void Linking.openSettings()}><Text style={s.link}>Open settings</Text></TouchableOpacity>}</View>}
    <View onLayout={event => setSheetHeight(event.nativeEvent.layout.height)} style={[s.sheet, { paddingBottom: Math.max(insets.bottom + 12, 28) }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse rider panel' : 'Expand rider panel'}
        onPress={() => setExpanded(v => !v)}
        style={s.sheetHeader}
      >
        <View style={s.handle} />
        <View style={s.row}>
          <View style={s.sheetTitleGroup}>
            <View style={s.statusBadge}>
              <View style={[s.liveDot, { backgroundColor: sync.isOnline && active ? '#22C55E' : theme.muted }]} />
              <Text style={s.eyebrow}>{status}</Text>
            </View>
            <Text style={s.heading}>
              {points.length} {points.length === 1 ? 'rider' : 'riders'} on map
            </Text>
          </View>
          <View style={s.headerRight}>
            <View style={s.codeBadge}>
              <Text style={s.codeLabel}>CODE</Text>
              <Text style={s.code}>{ride.ride_code}</Text>
            </View>
            <View style={[s.expandButton, expanded && s.expandButtonActive]}>
              <Text style={[s.expandButtonIcon, expanded && s.expandButtonIconActive]}>
                {expanded ? '▼' : '▲'}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
      {newest && (
        <View style={[s.alertBanner, newest.type === 'announcement' && s.announcementBanner]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={[s.warningText, newest.type === 'announcement' && s.announcementBannerText]}>
                {(ALERT_LABELS[newest.type] || 'Alert')} · {newest.display_name || 'Rider'}
                {newest.message ? `: "${newest.message}"` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setDismissed(ids => [...ids, newest.id])}>
              <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '700', padding: 4 }}>✕</Text>
            </TouchableOpacity>
          </View>
          {newest.type === 'announcement' && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {acknowledgedAlertIds.includes(newest.id) ? (
                <View style={s.acknowledgedBadge}>
                  <Text style={s.acknowledgedText}>✓ Acknowledged</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.acknowledgeButton}
                  onPress={() => void acknowledgeAnnouncement(newest.id)}
                >
                  <Text style={s.acknowledgeButtonText}>👍 Acknowledge</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {newest.type === 'emergency' && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TouchableOpacity
                style={[s.acknowledgeButton, { backgroundColor: theme.danger }]}
                onPress={() => void escalateEmergency(newest.id)}
              >
                <Text style={s.acknowledgeButtonText}>🚨 Escalate / Call 112</Text>
              </TouchableOpacity>
              {newest.lat && newest.lng && (
                <TouchableOpacity
                  style={[s.acknowledgeButton, { backgroundColor: theme.accent }]}
                  onPress={() => void Linking.openURL(`https://maps.google.com/?q=${newest.lat},${newest.lng}`)}
                >
                  <Text style={s.acknowledgeButtonText}>📍 Open Location</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
      {packFormation.length > 1 && (
        <View style={s.formationContainer}>
          <View style={s.formationHeader}>
            <Text style={s.formationTitle}>FORMATION & SPACING</Text>
            {packFormation.some(p => p.isSeparated) && (
              <Text style={s.separationBadge}>⚠️ Gap Alert</Text>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.formationStrip}>
            {packFormation.map(rider => (
              <View key={rider.userId} style={s.formationItem}>
                <View style={[s.formationBadge, rider.isLeader ? s.leaderBadge : rider.isTail ? s.tailBadge : s.memberBadge]}>
                  <Text style={s.formationBadgeText}>
                    {rider.isLeader ? '👑 LEAD' : rider.isTail ? '🧹 SWEEP' : `#${rider.order}`}
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
      {(pending > 0 || sync.syncError) && <TouchableOpacity disabled={sync.isSyncing} onPress={() => void sync.flushQueue()} style={s.sync}><Text style={s.muted}>{sync.isSyncing ? 'Uploading saved updates…' : pending + ' updates saved · tap to sync'}</Text>{sync.syncError && <Text style={s.warningText}>{sync.syncError}</Text>}</TouchableOpacity>}
      {expanded && <FlatList
        data={points}
        style={s.riders}
        keyExtractor={item => item.user_id}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews
        ListEmptyComponent={<Text style={s.muted}>Rider positions appear after GPS starts. Last known positions remain visible during signal loss.</Text>}
        renderItem={({ item: p }) => {
          const riderStatus = getRiderLiveStatus(p, ride.status, now);
          const isDisconnected = riderStatus.status === 'disconnected';
          return (
            <TouchableOpacity style={s.rider} onPress={() => {
              setFollow(false);
              if (typeof p.lng === 'number' && typeof p.lat === 'number' && Number.isFinite(p.lng) && Number.isFinite(p.lat)) {
                try { camera.current?.setCamera({ centerCoordinate: [p.lng, p.lat], zoomLevel: 15, padding: cameraPadding, animationDuration: 700 }); } catch { /* ignore */ }
              }
            }}>
              <View style={[
                s.avatar,
                riderStatus.status === 'riding' ? s.avatarRiding :
                riderStatus.status === 'stopped' ? s.avatarStopped :
                riderStatus.status === 'completed' ? s.avatarCompleted : s.stale
              ]}>
                <Text style={s.buttonText}>{(p.display_name?.[0] || 'R').toUpperCase()}</Text>
              </View>
              <View style={s.grow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.text}>{p.display_name}{p.user_id === userId ? ' · you' : ''}</Text>
                  <View style={[
                    s.statusPill,
                    riderStatus.status === 'riding' ? s.statusPillRiding :
                    riderStatus.status === 'stopped' ? s.statusPillStopped :
                    riderStatus.status === 'completed' ? s.statusPillCompleted : s.statusPillDisconnected
                  ]}>
                    <Text style={[
                      s.statusPillText,
                      riderStatus.status === 'riding' ? s.statusPillTextRiding :
                      riderStatus.status === 'stopped' ? s.statusPillTextStopped :
                      riderStatus.status === 'completed' ? s.statusPillTextCompleted : s.statusPillTextDisconnected
                    ]}>
                      {riderStatus.label}
                    </Text>
                  </View>
                </View>
                <Text style={s.muted}>
                  {isDisconnected
                    ? (riderStatus.lastSeenText || 'Last known position')
                    : riderStatus.status === 'completed'
                    ? 'Ride completed'
                    : 'Live location'}
                </Text>
              </View>
              <Text style={s.text}>
                {riderStatus.status === 'riding'
                  ? Math.round((p.speed || 0) * 3.6) + ' km/h'
                  : riderStatus.status === 'stopped'
                  ? '0 km/h'
                  : '—'}
              </Text>
            </TouchableOpacity>
          );
        }}
      />}
      {active && nextWaypoint && <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
        <TouchableOpacity style={[s.navButton, { flex: 1, marginBottom: 0 }]} onPress={() => void navigateToNextWaypoint()}>
          <Text style={s.navButtonText}>Navigate to {nextWaypoint.name} ↗</Text>
        </TouchableOpacity>
        {upcomingWaypoints.length > 1 && <TouchableOpacity
          style={[s.control, { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }]}
          onPress={() => setTargetWaypointIndex(curr => (curr + 1) % upcomingWaypoints.length)}
          accessibilityLabel="Switch to next stop on route"
        >
          <Text style={s.text}>{targetWaypointIndex + 1}/{upcomingWaypoints.length} ⏭</Text>
        </TouchableOpacity>}
      </View>}
      {active ? (
        <View style={s.activeActionsContainer}>
          <View style={s.actionsRow}>
            <TouchableOpacity
              style={s.actionButton}
              onPress={() => setSharing(v => !v)}
              accessibilityRole="button"
              accessibilityLabel={sharing ? 'Pause GPS tracking' : 'Resume GPS tracking'}
            >
              <Text style={s.actionButtonText} numberOfLines={1}>
                {sharing ? '⏸ Pause GPS' : '▶ Resume GPS'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.alertButton, (!position || isStale(position.timestamp, now)) && s.disabled]}
              disabled={busy || !position || isStale(position.timestamp, now)}
              onPress={() => setModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Broadcast alert to group"
            >
              <Text style={s.alertButtonText} numberOfLines={1}>🚨 Alert</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.actionButton}
              disabled={!position}
              onPress={() => void shareLiveLocation()}
              accessibilityRole="button"
              accessibilityLabel="Share live location with contact"
            >
              <Text style={s.actionButtonText} numberOfLines={1}>📤 Share</Text>
            </TouchableOpacity>
          </View>

          {((tracking !== 'background' && sharing) || (admin && active)) && (
            <View style={s.subActionsRow}>
              {tracking !== 'background' && sharing && (
                <TouchableOpacity
                  style={[s.subActionButton, (admin && active) ? { flex: 1 } : { width: '100%' }]}
                  onPress={() => void enableBackgroundGps()}
                  accessibilityRole="button"
                  accessibilityLabel="Enable background GPS tracking"
                >
                  <Text style={s.subActionText} numberOfLines={1}>
                    📡 {backgroundPermissionGranted ? 'Start background GPS' : 'Enable background GPS'}
                  </Text>
                </TouchableOpacity>
              )}

              {admin && active && (
                <TouchableOpacity
                  accessibilityLabel="End ride for everyone"
                  style={[s.endRideButton, (tracking !== 'background' && sharing) ? { flex: 1 } : { width: '100%' }]}
                  disabled={busy}
                  onPress={() => Dialog.alert('End this ride?', 'Sharing stops when each device receives the update.', [
                    { text: 'Keep riding', style: 'cancel' },
                    { text: 'End ride', style: 'destructive', onPress: () => void changeStatus('completed') },
                  ])}
                >
                  <Text style={s.endRideText}>🏁 End Ride</Text>
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
    </View>
    <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
      <View style={s.overlay}>
        <View style={[s.modal,{ paddingBottom: Math.max(insets.bottom,24) }]}>
          <Text style={s.heading}>Let your group know</Text>
          <Text style={s.muted}>Your location is attached. Offline alerts are delivered after reconnecting.</Text>
          {admin && (
            <TouchableOpacity
              style={[s.alertOption, { backgroundColor: theme.accentSoft, borderColor: theme.accent, borderWidth: 1 }]}
              disabled={busy}
              onPress={() => { setModal(false); setAnnouncementModal(true); }}
            >
              <Text style={[s.text, { color: theme.accent }]}>📢 Captain Announcement...</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.alertOption, { backgroundColor: theme.surfaceRaised, borderColor: '#F59E0B', borderWidth: 1 }]}
            disabled={busy}
            onPress={() => { setModal(false); setMechanicalModalVisible(true); }}
          >
            <Text style={[s.text, { color: '#D97706' }]}>🔧 Mechanical Breakdown...</Text>
          </TouchableOpacity>
          {(Object.keys(ALERT_LABELS) as AlertType[]).filter(t => t !== 'announcement' && t !== 'mechanical').map(type => (
            <TouchableOpacity key={type} style={[s.alertOption,type === 'emergency' && s.emergency]} disabled={busy} onPress={() => type === 'emergency' ? triggerSosWorkflow() : void sendAlert(type)}>
              <Text style={s.text}>{ALERT_LABELS[type]}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[s.alertOption, { borderColor: theme.border, borderWidth: 1 }]}
            onPress={() => { setModal(false); void loadBreakdownDirectory(); }}
          >
            <Text style={s.text}>🛠️ Breakdown Assistance Directory (1033 / RSA)</Text>
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
          <Text style={[s.heading, { color: theme.accent }]}>📢 Captain Announcement</Text>
          <Text style={s.muted}>Broadcast a quick directive or sticky status alert to all riders' heads-up display.</Text>
          <View style={{ gap: 8, marginVertical: 4 }}>
            {[
              '⛽ Fuel stop at next pump (~5km)',
              '☕ Chai & stretch break ahead',
              '🌧️ Wet roads / rain ahead — reduce speed',
              '⚠️ Road hazard / debris observed',
              '📢 Regroup at next junction',
              '🛑 Pull over safely now',
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
        <View style={[s.modal,{ paddingBottom: Math.max(insets.bottom,24) }]}>
          <Text style={[s.heading, { color: theme.danger }]}>🚨 Motorcycle Emergency SOS</Text>
          <Text style={s.muted}>Broadcast an instant emergency alert with your live GPS location to your group, and reach your emergency contact.</Text>
          <TouchableOpacity style={s.sosEmergencyOption} disabled={busy} onPress={() => void broadcastSosToGroup()}>
            <Text style={s.sosEmergencyText}>🚨 Broadcast to Group Now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.alertOption} disabled={busy} onPress={() => void sendEmergencySms()}>
            <Text style={s.text}>💬 SMS GPS to Contact ({profile?.emergency_contact || 'None set'})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.alertOption} disabled={busy} onPress={() => void dialEmergencyContact()}>
            <Text style={s.text}>📞 Call Emergency Contact ({profile?.emergency_contact || '112'})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1 }]} onPress={() => { setSosModal(false); void loadBreakdownDirectory(); }}>
            <Text style={[s.text, { color: theme.accent }]}>🛠️ Highway Assistance & RSA Directory (1033 / 112)</Text>
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
              <Text style={s.heading}>📊 Live Ride Telemetry & Statistics</Text>
              <TouchableOpacity onPress={() => setStatsModalVisible(false)}>
                <Text style={{ color: theme.muted, fontSize: 18, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.muted, { marginBottom: 14 }]}>Real-time speed, pace, moving time, and pack spread statistics.</Text>

            {/* Time Stats */}
            <View style={s.statsCard}>
              <Text style={s.statsCardHeader}>⏱️ TIME & DURATION</Text>
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
              <Text style={s.statsCardHeader}>⚡ SPEED & DISTANCE</Text>
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
              <Text style={s.statsCardHeader}>🏍️ PACK FORMATION & TELEMETRY</Text>
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
                <Text style={[s.statsCardHeader, { marginBottom: 2 }]}>🔋 TOURING BATTERY SAVER</Text>
                <Text style={s.muted}>Adapts GPS interval (15s/25m) for all-day tours to conserve phone battery.</Text>
              </View>
              <TouchableOpacity
                style={[s.control, batterySaver && s.selected]}
                onPress={() => setBatterySaver(v => !v)}
              >
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
              <Text style={[s.heading, { color: theme.accent }]}>👑 Captain Command Dashboard</Text>
              <TouchableOpacity onPress={() => setCaptainDashboardVisible(false)}>
                <Text style={{ color: theme.muted, fontSize: 18, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.muted, { marginBottom: 14 }]}>Lead controls, pack spacing overview, speed advisories, and regroup coordination.</Text>

            {/* Pack Overview Card */}
            <View style={s.statsCard}>
              <Text style={s.statsCardHeader}>🏍️ PACK STATUS & SPREAD</Text>
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
              <Text style={s.statsCardHeader}>⚡ BROADCAST PACE ADVISORY</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                <TouchableOpacity style={s.paceButton} onPress={() => void broadcastPaceAdvisory(40, 'Curves / Ghats')}>
                  <Text style={s.paceButtonText}>🏔️ 40 km/h (Ghats)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.paceButton} onPress={() => void broadcastPaceAdvisory(60, 'Cruising')}>
                  <Text style={s.paceButtonText}>🏍️ 60 km/h (Cruising)</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity style={s.paceButton} onPress={() => void broadcastPaceAdvisory(80, 'Highway')}>
                  <Text style={s.paceButtonText}>🛣️ 80 km/h (Highway)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.paceButton} onPress={() => void broadcastPaceAdvisory(30, 'Wet Road / Rain')}>
                  <Text style={s.paceButtonText}>🌧️ 30 km/h (Rain)</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Active Regroup Points Coordination */}
            <View style={s.statsCard}>
              <Text style={s.statsCardHeader}>📍 REGROUP POINTS COORDINATION</Text>
              {regroupPoints.length === 0 ? (
                <Text style={s.muted}>No regroup points set for this ride. Add them in Trip Workspace.</Text>
              ) : (
                regroupPoints.map(point => {
                  const isClosed = point.status === 'closed';
                  return (
                    <View key={point.id} style={s.regroupActionItem}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={s.text}>#{point.sequence} {point.name}</Text>
                        <Text style={s.muted}>
                          {isClosed ? 'Closed & completed' : `${point.total_arrived || 0}/${participants.length} arrived`}
                        </Text>
                      </View>
                      {isClosed ? (
                        <View style={s.acknowledgedBadge}>
                          <Text style={s.acknowledgedText}>Closed</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={s.regroupCloseBtn}
                          disabled={busy}
                          onPress={() => void handleCloseRegroup(point.id)}
                        >
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
                <Text style={s.statsCardHeader}>📢 ANNOUNCEMENT ACKNOWLEDGEMENTS</Text>
                <TouchableOpacity
                  style={{ backgroundColor: theme.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}
                  onPress={() => { setCaptainDashboardVisible(false); setAnnouncementModal(true); }}
                >
                  <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '800' }}>+ New Broadcast</Text>
                </TouchableOpacity>
              </View>
              {alerts.filter(a => a.type === 'announcement').length === 0 ? (
                <Text style={s.muted}>No announcements broadcast yet.</Text>
              ) : (
                alerts.filter(a => a.type === 'announcement').slice(0, 5).map(alertItem => {
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
                      {ack && ack.riders.length > 0 && (
                        <Text style={[s.muted, { fontSize: 10, marginTop: 2 }]}>
                          ✓ {ack.riders.join(', ')}
                        </Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>

            {/* Quick Link to Breakdown Directory */}
            <TouchableOpacity
              style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1, marginBottom: 12 }]}
              onPress={() => { setCaptainDashboardVisible(false); void loadBreakdownDirectory(); }}
            >
              <Text style={[s.text, { color: theme.accent, textAlign: 'center' }]}>
                🛠️ Open Roadside Breakdown Directory
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.secondary} onPress={() => setCaptainDashboardVisible(false)}>
              <Text style={s.text}>Close Dashboard</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>

    {/* Mechanical Breakdown Modal */}
    <Modal visible={mechanicalModalVisible} transparent animationType="slide" onRequestClose={() => setMechanicalModalVisible(false)}>
      <View style={s.overlay}>
        <View style={[s.modal, { maxHeight: '85%', paddingBottom: Math.max(insets.bottom, 24) }]}>
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[s.heading, { color: '#D97706' }]}>🔧 Mechanical Breakdown Alert</Text>
              <TouchableOpacity onPress={() => setMechanicalModalVisible(false)}>
                <Text style={{ color: theme.muted, fontSize: 18, fontWeight: '700' }}>✕</Text>
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
                  <Text style={[s.issueChipText, selectedMechanicalIssue === issue && s.issueChipTextSelected]}>
                    {MECHANICAL_ISSUE_LABELS[issue].icon} {MECHANICAL_ISSUE_LABELS[issue].label}
                  </Text>
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

            <TouchableOpacity
              style={[s.primary, { backgroundColor: '#D97706', marginBottom: 10 }]}
              disabled={busy}
              onPress={() => void sendMechanicalBreakdownAlert()}
            >
              <Text style={[s.buttonText, { color: '#FFFFFF' }]}>Broadcast Breakdown Alert</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.alertOption, { borderColor: theme.border, borderWidth: 1, marginBottom: 10 }]}
              onPress={() => { setMechanicalModalVisible(false); void loadBreakdownDirectory(); }}
            >
              <Text style={[s.text, { textAlign: 'center' }]}>🛠️ View Roadside Assistance Numbers</Text>
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
              <Text style={[s.heading, { color: theme.accent }]}>🛠️ Roadside Breakdown Directory</Text>
              <TouchableOpacity onPress={() => setBreakdownDirectoryVisible(false)}>
                <Text style={{ color: theme.muted, fontSize: 18, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.muted, { marginBottom: 14 }]}>24x7 verified highway helplines, motorcycle roadside recovery, and emergency towing.</Text>

            {/* National Helplines */}
            <Text style={s.statsCardHeader}>🚨 24X7 NATIONAL HELPLINES</Text>
            {NATIONAL_EMERGENCY_HELPLINES.map((helpline, idx) => (
              <View key={idx} style={s.directoryCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={s.directoryName}>{helpline.icon} {helpline.name}</Text>
                    <Text style={s.directoryCoverage}>{helpline.purpose}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.callButton}
                    onPress={() => void Linking.openURL('tel:' + helpline.number)}
                  >
                    <Text style={s.callButtonText}>📞 {helpline.number}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {/* Verified Breakdown Services */}
            <Text style={[s.statsCardHeader, { marginTop: 10 }]}>🏍️ MOTORCYCLE RSA & TOWING SERVICES</Text>
            {breakdownServices.map((service, idx) => (
              <View key={service.id || idx} style={s.directoryCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={s.directoryName}>{service.name}</Text>
                    <Text style={s.directoryCoverage}>📍 {service.region} · {service.category}</Text>
                    {(service.notes || service.description) && (
                      <Text style={s.directoryPhone}>{service.notes || service.description}</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={s.callButton}
                    onPress={() => void Linking.openURL('tel:' + service.phone)}
                  >
                    <Text style={s.callButtonText}>📞 Call</Text>
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
  </View>;
}
const makeStyles = (c: RidePalette) => StyleSheet.create({
  announcementBanner:{backgroundColor:'#FFF7ED',borderColor:'#F97316',borderWidth:1},
  announcementBannerText:{color:'#C2410C',fontWeight:'800'},
  formationContainer:{marginBottom:12,backgroundColor:c.surfaceRaised,borderRadius:12,padding:10,borderWidth:1,borderColor:c.border},
  formationHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8},
  formationTitle:{color:c.muted,fontSize:10,fontWeight:'800',letterSpacing:0.5},
  separationBadge:{color:c.danger,fontSize:10,fontWeight:'800'},
  formationStrip:{flexDirection:'row',gap:8,alignItems:'center'},
  formationItem:{alignItems:'center',minWidth:68,backgroundColor:c.surface,borderRadius:8,padding:6,borderWidth:1,borderColor:c.border},
  formationBadge:{paddingHorizontal:6,paddingVertical:2,borderRadius:4,marginBottom:4},
  leaderBadge:{backgroundColor:c.accentSoft},
  tailBadge:{backgroundColor:'#FEF3C7'},
  memberBadge:{backgroundColor:c.surfaceRaised},
  formationBadgeText:{color:c.text,fontSize:9,fontWeight:'800'},
  formationName:{color:c.text,fontSize:11,fontWeight:'700',maxWidth:70},
  formationGap:{color:c.muted,fontSize:10,fontWeight:'600',marginTop:2},
  separatedGap:{color:c.danger,fontWeight:'800'},
  presetOption:{padding:12,borderRadius:8,backgroundColor:c.surfaceRaised,borderWidth:1,borderColor:c.border},
  presetText:{color:c.text,fontSize:13,fontWeight:'600'},
  announcementInput:{flex:1,backgroundColor:c.surfaceRaised,borderRadius:10,borderWidth:1,borderColor:c.border,paddingHorizontal:12,paddingVertical:10,color:c.text,fontSize:13},
  sendAnnouncementBtn:{backgroundColor:c.accent,paddingHorizontal:16,justifyContent:'center',borderRadius:10},
  sendAnnouncementText:{color:'#FFFFFF',fontSize:13,fontWeight:'800'},
  screen:{flex:1,backgroundColor:c.background},loading:{flex:1,alignItems:'center',justifyContent:'center',gap:24,padding:28,backgroundColor:c.background},brand:{color:c.accent,fontSize:16,fontWeight:'800',letterSpacing:4},
  text:{color:c.text,fontSize:14,fontWeight:'600'},muted:{color:c.muted,fontSize:12,lineHeight:18},heading:{color:c.text,fontSize:18,fontWeight:'800',letterSpacing:-0.3},
  top:{position:'absolute',left:14,right:14,flexDirection:'row',gap:8,alignItems:'center'},
  title:{flex:1,paddingHorizontal:14,paddingVertical:10,borderRadius:14,backgroundColor:c.surface,borderWidth:1,borderColor:c.border,elevation:3,shadowColor:'#000',shadowOpacity:0.08,shadowRadius:4,shadowOffset:{width:0,height:2}},
  square:{width:44,height:48,borderRadius:14,backgroundColor:c.surface,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:c.border,elevation:3,shadowColor:'#000',shadowOpacity:0.08,shadowRadius:4,shadowOffset:{width:0,height:2}},
  backIcon:{color:c.text,fontSize:24,fontWeight:'700',lineHeight:26,marginTop:-2},
  topBarIcon:{color:c.text,fontSize:16,fontWeight:'700'},
  sosTopButton:{width:46,height:48,borderRadius:14,backgroundColor:c.danger,alignItems:'center',justifyContent:'center',elevation:3,shadowColor:c.danger,shadowOpacity:0.3,shadowRadius:4,shadowOffset:{width:0,height:2}},
  sosTopButtonText:{color:'#fff',fontSize:13,fontWeight:'900',letterSpacing:0.5},
  controls:{position:'absolute',right:14,flexDirection:'row',gap:8},
  control:{backgroundColor:c.surface,paddingHorizontal:14,minHeight:40,justifyContent:'center',alignItems:'center',borderRadius:20,borderWidth:1,borderColor:c.border,elevation:3,shadowColor:'#000',shadowOpacity:0.08,shadowRadius:4,shadowOffset:{width:0,height:2}},
  selected:{borderColor:c.accent,backgroundColor:c.accentSoft},
  controlText:{color:c.text,fontSize:13,fontWeight:'700'},
  selectedText:{color:c.accent,fontWeight:'800'},
  sheet:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:c.surface,borderTopLeftRadius:28,borderTopRightRadius:28,paddingHorizontal:20,shadowColor:c.text,shadowOpacity:0.12,shadowRadius:15,elevation:8,borderWidth:1,borderColor:c.border},
  sheetHeader:{paddingTop:10,paddingBottom:16},
  handle:{width:44,height:4,backgroundColor:c.border,borderRadius:2,alignSelf:'center',marginBottom:12},
  row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},
  sheetTitleGroup:{flex:1},
  statusBadge:{flexDirection:'row',alignItems:'center',gap:6,marginBottom:4},
  liveDot:{width:7,height:7,borderRadius:3.5},
  eyebrow:{color:'#16A34A',fontSize:11,fontWeight:'700',letterSpacing:0.3},
  headerRight:{flexDirection:'row',alignItems:'center',gap:8},
  codeBadge:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:c.surfaceRaised,paddingHorizontal:10,paddingVertical:6,borderRadius:10,borderWidth:1,borderColor:c.border},
  codeLabel:{color:c.muted,fontSize:9,fontWeight:'800',letterSpacing:0.5},
  code:{color:c.text,fontSize:11,fontWeight:'900',letterSpacing:1},
  expandButton:{width:32,height:32,borderRadius:16,backgroundColor:c.surfaceRaised,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:c.border},
  expandButtonActive:{backgroundColor:c.accentSoft,borderColor:c.accent},
  expandButtonIcon:{color:c.muted,fontSize:10,fontWeight:'800'},
  expandButtonIconActive:{color:c.accent},
  riders:{maxHeight:185,marginBottom:12},
  rider:{flexDirection:'row',gap:10,alignItems:'center',paddingVertical:10,borderBottomWidth:1,borderColor:c.border},
  avatar:{width:36,height:36,borderRadius:18,backgroundColor:c.green,alignItems:'center',justifyContent:'center'},
  avatarRiding:{backgroundColor:c.green},
  avatarStopped:{backgroundColor:'#EAB308'},
  avatarCompleted:{backgroundColor:c.accent},
  stale:{backgroundColor:c.subtle},
  grow:{flex:1},
  statusPill:{paddingHorizontal:6,paddingVertical:2,borderRadius:6},
  statusPillText:{fontSize:10,fontWeight:'700'},
  statusPillRiding:{backgroundColor:c.greenSoft},
  statusPillTextRiding:{color:c.green,fontSize:10,fontWeight:'700'},
  statusPillStopped:{backgroundColor:'#FEF9C3'},
  statusPillTextStopped:{color:'#854D0E',fontSize:10,fontWeight:'700'},
  statusPillDisconnected:{backgroundColor:c.surfaceRaised},
  statusPillTextDisconnected:{color:c.muted,fontSize:10,fontWeight:'700'},
  statusPillCompleted:{backgroundColor:c.accentSoft},
  statusPillTextCompleted:{color:c.accent,fontSize:10,fontWeight:'700'},
  navButton:{backgroundColor:c.accent,borderRadius:14,minHeight:48,paddingHorizontal:16,alignItems:'center',justifyContent:'center',marginBottom:10,elevation:3,shadowColor:c.accent,shadowOpacity:0.25,shadowRadius:5,shadowOffset:{width:0,height:2}},
  navButtonText:{color:'#FFFFFF',fontSize:14,fontWeight:'800',letterSpacing:0.2},
  actions:{flexDirection:'row',gap:8,alignItems:'center'},
  activeActionsContainer:{gap:8,width:'100%'},
  actionsRow:{flexDirection:'row',gap:8,alignItems:'center',width:'100%'},
  actionButton:{flex:1,backgroundColor:c.surfaceRaised,borderRadius:12,minHeight:46,paddingHorizontal:6,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:c.border},
  actionButtonText:{color:c.text,fontSize:13,fontWeight:'700'},
  alertButton:{flex:1,backgroundColor:c.accent,borderRadius:12,minHeight:46,paddingHorizontal:6,alignItems:'center',justifyContent:'center'},
  alertButtonText:{color:'#FFFFFF',fontSize:13,fontWeight:'800'},
  subActionsRow:{flexDirection:'row',gap:8,alignItems:'center',width:'100%',marginTop:2},
  subActionButton:{backgroundColor:c.surfaceRaised,borderRadius:12,minHeight:44,paddingHorizontal:12,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:c.border},
  subActionText:{color:c.accent,fontSize:12,fontWeight:'700'},
  endRideButton:{backgroundColor:'rgba(239, 68, 68, 0.1)',borderColor:'rgba(239, 68, 68, 0.3)',borderWidth:1,borderRadius:12,minHeight:44,paddingHorizontal:12,alignItems:'center',justifyContent:'center'},
  endRideText:{color:c.danger,fontSize:12,fontWeight:'800'},
  primary:{flex:1,backgroundColor:c.accent,borderRadius:15,minHeight:48,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},
  secondary:{backgroundColor:c.surfaceRaised,borderRadius:15,minHeight:48,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},
  buttonText:{color:c.text,fontSize:14,fontWeight:'700'},
  disabled:{opacity:0.5},
  endButton:{minWidth:44,minHeight:48,alignItems:'center',justifyContent:'center'},
  endText:{color:c.danger,fontSize:13},
  warning:{position:'absolute',left:16,right:16,backgroundColor:c.accentSoft,borderRadius:15,padding:12,gap:4},warningText:{color:c.text,fontSize:12,lineHeight:18},link:{color:c.accent,fontWeight:'700',paddingVertical:8},sync:{paddingBottom:12},alertBanner:{padding:12,borderRadius:12,backgroundColor:c.accentSoft,marginBottom:10},overlay:{flex:1,justifyContent:'flex-end',backgroundColor:c.shadow + '88'},modal:{borderTopLeftRadius:28,borderTopRightRadius:28,padding:24,backgroundColor:c.surface,gap:12},alertOption:{padding:20,borderRadius:9,backgroundColor:c.surfaceRaised},emergency:{backgroundColor:c.accentSoft},fallback:{padding:36,paddingTop:225,gap:14},
  hudContainer:{position:'absolute',left:14,right:14,backgroundColor:c.surface,borderRadius:14,borderWidth:1,borderColor:c.border,paddingVertical:10,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-around',elevation:4,shadowColor:'#000',shadowOpacity:0.08,shadowRadius:6,shadowOffset:{width:0,height:2}},
  hudItem:{alignItems:'center'},
  hudValue:{color:c.text,fontSize:16,fontWeight:'900'},
  hudLabel:{color:c.muted,fontSize:8,fontWeight:'800',letterSpacing:0.8,marginTop:2},
  hudDivider:{width:1,height:24,backgroundColor:c.border},
  deviationWarning:{position:'absolute',left:14,right:14,backgroundColor:c.accentSoft,borderColor:c.accent,borderWidth:1,borderRadius:10,padding:10,alignItems:'center'},
  deviationWarningText:{color:c.danger,fontSize:12,fontWeight:'800'},
  arrivalToast:{position:'absolute',left:14,right:14,backgroundColor:c.greenSoft,borderColor:c.green,borderWidth:1,borderRadius:10,padding:10,alignItems:'center'},
  arrivalToastText:{color:c.green,fontSize:12,fontWeight:'800'},
  regroupBanner:{position:'absolute',left:14,right:14,backgroundColor:c.surface,borderColor:c.accent,borderWidth:1,borderRadius:12,padding:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',elevation:4},
  regroupBannerText:{color:c.text,fontSize:13,fontWeight:'700',flex:1},
  confirmRegroupButton:{backgroundColor:c.accent,paddingHorizontal:12,paddingVertical:8,borderRadius:8},
  confirmRegroupText:{color:c.text,fontSize:12,fontWeight:'800'},
  sosEmergencyOption:{padding:16,borderRadius:10,backgroundColor:c.danger,alignItems:'center'},
  sosEmergencyText:{color:'#fff',fontSize:15,fontWeight:'800'},
  statsCard:{backgroundColor:c.surfaceRaised,borderRadius:12,padding:12,marginBottom:10,borderWidth:1,borderColor:c.border},
  statsCardHeader:{color:c.muted,fontSize:10,fontWeight:'800',letterSpacing:0.5,marginBottom:8},
  statsGrid:{flexDirection:'row',justifyContent:'space-around'},
  statsGridItem:{alignItems:'center',flex:1},
  statsValue:{color:c.text,fontSize:16,fontWeight:'800'},
  statsLabel:{color:c.muted,fontSize:9,fontWeight:'700',letterSpacing:0.3,marginTop:2},
  acknowledgeButton: { backgroundColor: c.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  acknowledgeButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  acknowledgedBadge: { backgroundColor: c.greenSoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  acknowledgedText: { color: c.green, fontSize: 12, fontWeight: '800' },
  regroupActionItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.surface, padding: 10, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: c.border },
  regroupCloseBtn: { backgroundColor: c.green, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  regroupCloseBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  paceButton: { flex: 1, backgroundColor: c.surfaceRaised, padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: c.border },
  paceButtonText: { color: c.text, fontSize: 11, fontWeight: '700' },
  issueChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border, marginBottom: 6 },
  issueChipSelected: { backgroundColor: c.accentSoft, borderColor: c.accent },
  issueChipText: { color: c.text, fontSize: 12, fontWeight: '600' },
  issueChipTextSelected: { color: c.accent, fontWeight: '800' },
  directoryCard: { backgroundColor: c.surfaceRaised, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: c.border },
  directoryName: { color: c.text, fontSize: 14, fontWeight: '800' },
  directoryCoverage: { color: c.accent, fontSize: 11, fontWeight: '700', marginTop: 2 },
  directoryPhone: { color: c.muted, fontSize: 12, marginTop: 2 },
  callButton: { backgroundColor: c.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  callButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
