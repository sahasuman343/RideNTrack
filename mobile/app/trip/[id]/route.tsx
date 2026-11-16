import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { useAuth } from '../../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../../src/theme';
import {
  formatRouteDistance,
  formatRouteDuration,
  parseDirectionsRoute,
  routeCoordinates,
  validateRoutePoints,
  insertRouteStop,
  removeRouteStop,
  moveRouteStop,
  WAYPOINT_META,
  EDITABLE_WAYPOINT_TYPES,
  type RoutePoint,
  type RouteWaypointType,
} from '@ridentrack/shared';

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
let Mapbox: any = null;
if (TOKEN) {
  try {
    Mapbox = require('@rnmapbox/maps').default;
    Mapbox?.setAccessToken(TOKEN);
  } catch {
    /* The editor remains usable without the native map preview. */
  }
}

type Place = {
  id: string;
  name: string;
  address: string;
  longitude: number;
  latitude: number;
};

type TripRow = {
  id: string;
  admin_id: string;
  status: string;
  origin: string;
  destination: string;
  origin_coords: [number, number];
  destination_coords: [number, number];
  route_geometry: any;
  estimated_distance_meters: number | null;
  estimated_duration_seconds: number | null;
};

type TripDay = {
  id: string;
  day_number: number;
  title: string | null;
  trip_date: string | null;
};

type SearchModalConfig = {
  visible: boolean;
  mode: 'add' | 'edit';
  targetIndex: number;
  waypointType: RouteWaypointType;
  selectedDayId: string | null;
};

type DayPickerConfig = {
  visible: boolean;
  pointIndex: number | null;
};

export default function RouteEditorScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const camera = useRef<any>(null);

  const [trip, setTrip] = useState<TripRow | null>(null);
  const [days, setDays] = useState<TripDay[]>([]);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<any>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [calculatedSignature, setCalculatedSignature] = useState('');

  // Search modal state
  const [searchModal, setSearchModal] = useState<SearchModalConfig>({
    visible: false,
    mode: 'add',
    targetIndex: 0,
    waypointType: 'stop',
    selectedDayId: null,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [stopNotes, setStopNotes] = useState('');

  // Day picker modal state
  const [dayPicker, setDayPicker] = useState<DayPickerConfig>({
    visible: false,
    pointIndex: null,
  });

  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [routeNote, setRouteNote] = useState('');

  const isAdmin = !!user && trip?.admin_id === user.id;
  const signature = useMemo(
    () => JSON.stringify(points.map(p => [p.latitude, p.longitude, p.waypoint_type])),
    [points],
  );
  const routeIsCurrent = !!routeGeometry && calculatedSignature === signature;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [tripResult, waypointResult, dayResult] = await Promise.all([
        supabase
          .from('rides')
          .select('id,admin_id,status,origin,destination,origin_coords,destination_coords,route_geometry,estimated_distance_meters,estimated_duration_seconds')
          .eq('id', id)
          .single(),
        supabase.from('trip_waypoints').select('*').eq('ride_id', id).order('sequence'),
        supabase.from('trip_days').select('id,day_number,title,trip_date').eq('ride_id', id).order('day_number'),
      ]);
      if (tripResult.error) throw tripResult.error;
      if (waypointResult.error) throw waypointResult.error;
      if (dayResult.error) throw dayResult.error;

      const row = tripResult.data as TripRow;
      setTrip(row);
      setDays((dayResult.data || []) as TripDay[]);

      let loaded: RoutePoint[] = ((waypointResult.data || []) as any[]).map(p => ({
        id: p.id,
        sequence: p.sequence,
        waypoint_type: p.waypoint_type,
        name: p.name,
        address: p.address,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        provider_place_id: p.provider_place_id,
        notes: p.notes,
        is_optional: p.is_optional,
        trip_day_id: p.trip_day_id,
      }));

      if (loaded.length < 2) {
        const origin = Array.isArray(row.origin_coords) ? row.origin_coords : [77.5946, 12.9716];
        const destination = Array.isArray(row.destination_coords) ? row.destination_coords : [78, 13];
        loaded = [
          { id: null, sequence: 0, waypoint_type: 'origin', name: row.origin, address: row.origin, longitude: Number(origin[0]), latitude: Number(origin[1]) },
          { id: null, sequence: 1, waypoint_type: 'destination', name: row.destination, address: row.destination, longitude: Number(destination[0]), latitude: Number(destination[1]) },
        ];
      }
      loaded = loaded.map((p, i) => ({ ...p, sequence: i }));
      setPoints(loaded);
      setRouteGeometry(row.route_geometry || null);
      setDistance(row.estimated_distance_meters);
      setDuration(row.estimated_duration_seconds);
      setCalculatedSignature(row.route_geometry ? JSON.stringify(loaded.map(p => [p.latitude, p.longitude, p.waypoint_type])) : '');
      setRouteNote(row.route_geometry ? 'Route preview loaded. Recalculate if any stops change.' : 'Calculate route to preview road path and distance.');
    } catch (e: any) {
      setError(e?.message || 'Could not load route details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Debounced Place Search for the Place Search Modal
  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchModal.visible || query.length < 2 || !TOKEN) {
      setSuggestions([]);
      setSearchLoading(false);
      setSearchError('');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError('');
      try {
        const params = new URLSearchParams({
          autocomplete: 'true',
          fuzzyMatch: 'true',
          limit: '6',
          country: 'IN',
          language: 'en',
          worldview: 'in',
          types: 'poi,address,place,locality,neighborhood,postcode,region',
          access_token: TOKEN,
        });
        const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(query) + '.json?' + params.toString();
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Place search service is temporarily unavailable.');
        const data = await response.json();
        if (controller.signal.aborted) return;
        setSuggestions(
          (data.features || [])
            .filter((f: any) => Array.isArray(f.center) && f.center.length >= 2)
            .map((f: any) => ({
              id: String(f.id || f.place_name),
              name: f.text || f.place_name,
              address: f.place_name || f.text,
              longitude: Number(f.center[0]),
              latitude: Number(f.center[1]),
            })),
        );
      } catch (e: any) {
        if (!controller.signal.aborted) setSearchError(e?.message || 'Place search failed.');
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, searchModal.visible]);

  // Fit camera bounds when routeGeometry updates
  useEffect(() => {
    const coords = routeGeometry?.geometry?.coordinates;
    if (!Mapbox || !coords || coords.length < 2 || !camera.current) return;
    const valid = coords.filter((p: any) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (valid.length < 2) return;
    const east = Math.max(...valid.map((p: any) => p[0])), west = Math.min(...valid.map((p: any) => p[0]));
    const north = Math.max(...valid.map((p: any) => p[1])), south = Math.min(...valid.map((p: any) => p[1]));
    try {
      camera.current.fitBounds([east, north], [west, south], [35, 35, 35, 35], 500);
    } catch {
      /* Map might not be mounted */
    }
  }, [routeGeometry]);

  // Open search modal to ADD a stop
  function openAddStop(type: RouteWaypointType = 'stop', targetIndex?: number) {
    if (points.length >= 25) {
      Alert.alert('Route point limit', 'Mapbox driving directions support up to 25 points, including origin and destination.');
      return;
    }
    const insertAt = targetIndex !== undefined ? targetIndex : points.length - 1;
    setSearchQuery('');
    setSuggestions([]);
    setSearchError('');
    setStopNotes('');
    setSearchModal({
      visible: true,
      mode: 'add',
      targetIndex: insertAt,
      waypointType: type,
      selectedDayId: null,
    });
  }

  // Open search modal to EDIT an existing point
  function openEditPoint(index: number) {
    const point = points[index];
    if (!point) return;
    setSearchQuery(point.name || '');
    setSuggestions([]);
    setSearchError('');
    setStopNotes(point.notes || '');
    setSearchModal({
      visible: true,
      mode: 'edit',
      targetIndex: index,
      waypointType: point.waypoint_type,
      selectedDayId: point.trip_day_id || null,
    });
  }

  function closeSearchModal() {
    setSearchModal(curr => ({ ...curr, visible: false }));
    setSearchQuery('');
    setSuggestions([]);
    setSearchError('');
    setStopNotes('');
  }

  // Save stop notes and category updates in edit mode without replacing the coordinates
  function saveStopDetailsOnly() {
    const idx = searchModal.targetIndex;
    const currentPoint = points[idx];
    if (!currentPoint) return;
    const isEndpoint = idx === 0 || idx === points.length - 1;
    const updatedType = isEndpoint ? currentPoint.waypoint_type : searchModal.waypointType;
    const newNotes = stopNotes.trim() || null;

    setPoints(curr =>
      curr.map((p, i) =>
        i === idx
          ? {
              ...p,
              waypoint_type: updatedType,
              notes: newNotes,
              trip_day_id: isEndpoint ? null : searchModal.selectedDayId,
            }
          : p,
      ),
    );
    closeSearchModal();
  }

  // Select place from search suggestions
  function handleSelectPlace(place: Place) {
    if (searchModal.mode === 'add') {
      try {
        const nextPoints = insertRouteStop(
          points,
          {
            id: null,
            waypoint_type: searchModal.waypointType,
            name: place.name,
            address: place.address,
            latitude: place.latitude,
            longitude: place.longitude,
            provider_place_id: place.id,
            notes: stopNotes.trim() || null,
            trip_day_id: searchModal.selectedDayId,
          },
          searchModal.targetIndex,
        );
        setPoints(nextPoints);
        setRouteGeometry(null);
        setCalculatedSignature('');
        setRouteNote('Stop added. Recalculate route to refresh road geometry and travel time.');
      } catch (err: any) {
        Alert.alert('Unable to add stop', err?.message || 'Invalid stop coordinates or limit reached.');
        return;
      }
    } else {
      // Edit mode
      const idx = searchModal.targetIndex;
      const currentPoint = points[idx];
      const isEndpoint = idx === 0 || idx === points.length - 1;
      const updatedType = isEndpoint ? currentPoint.waypoint_type : searchModal.waypointType;

      setPoints(curr =>
        curr.map((p, i) =>
          i === idx
            ? {
                ...p,
                name: place.name,
                address: place.address,
                latitude: place.latitude,
                longitude: place.longitude,
                provider_place_id: place.id,
                waypoint_type: updatedType,
                notes: stopNotes.trim() || null,
                trip_day_id: isEndpoint ? null : searchModal.selectedDayId,
              }
            : p,
        ),
      );
      setRouteGeometry(null);
      setCalculatedSignature('');
      setRouteNote(
        isEndpoint
          ? 'Endpoint updated. Recalculate route before saving.'
          : 'Stop updated. Recalculate route to refresh road geometry and travel time.',
      );
    }
    closeSearchModal();
  }

  // Remove stop
  function handleRemoveStop(index: number) {
    if (index === 0 || index === points.length - 1) return;
    const targetName = points[index].name || 'this stop';
    Alert.alert(
      'Remove stop?',
      `Are you sure you want to remove “${targetName}” from the route?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            try {
              const nextPoints = removeRouteStop(points, index);
              setPoints(nextPoints);
              setRouteGeometry(null);
              setCalculatedSignature('');
              setRouteNote('Stop removed. Recalculate route to refresh road geometry.');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not remove stop.');
            }
          },
        },
      ],
    );
  }

  // Reorder stop
  function handleMoveStop(index: number, delta: number) {
    const target = index + delta;
    try {
      const nextPoints = moveRouteStop(points, index, target);
      setPoints(nextPoints);
      setRouteGeometry(null);
      setCalculatedSignature('');
      setRouteNote('Stops reordered. Recalculate route to refresh road geometry.');
    } catch (err: any) {
      Alert.alert('Cannot move stop', err?.message || 'Invalid position.');
    }
  }

  // Quick switch waypoint type
  function handleChangeWaypointType(index: number, newType: RouteWaypointType) {
    if (index === 0 || index === points.length - 1) return;
    setPoints(curr =>
      curr.map((p, i) => (i === index ? { ...p, waypoint_type: newType } : p)),
    );
    setRouteGeometry(null);
    setCalculatedSignature('');
    setRouteNote('Waypoint type updated. Recalculate to refresh.');
  }

  // Open day picker
  function openDayPicker(pointIndex: number) {
    setDayPicker({ visible: true, pointIndex });
  }

  function handleAssignDay(dayId: string | null) {
    if (dayPicker.pointIndex === null) return;
    const idx = dayPicker.pointIndex;
    setPoints(curr =>
      curr.map((p, i) => (i === idx ? { ...p, trip_day_id: dayId } : p)),
    );
    setDayPicker({ visible: false, pointIndex: null });
  }

  // Route calculation via Mapbox Directions
  async function calculateRoute() {
    const validation = validateRoutePoints(points);
    if (validation) {
      Alert.alert('Check your route', validation);
      return;
    }
    if (!TOKEN) {
      Alert.alert('Mapbox token required', 'Add EXPO_PUBLIC_MAPBOX_TOKEN to calculate and preview routes.');
      return;
    }
    setCalculating(true);
    setError('');
    try {
      const coords = routeCoordinates(points).map(pair => pair.join(',')).join(';');
      const url =
        'https://api.mapbox.com/directions/v5/mapbox/driving/' +
        coords +
        '?overview=full&geometries=geojson&steps=false&access_token=' +
        encodeURIComponent(TOKEN);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not calculate this route. Check that road connections exist between stops.');
      const data = await response.json();
      if (data.code && data.code !== 'Ok') throw new Error(data.message || 'No driving route found between these places.');
      const result = parseDirectionsRoute(data);
      const feature = { type: 'Feature', geometry: result.geometry, properties: {} };
      setRouteGeometry(feature);
      setDistance(result.distance);
      setDuration(result.duration);
      setCalculatedSignature(signature);
      setRouteNote('Route calculated with road driving directions. Adjust pace and stops for your group ride.');
    } catch (e: any) {
      setError(e?.message || 'Route calculation failed.');
    } finally {
      setCalculating(false);
    }
  }

  // Save route atomically via Supabase RPC
  async function saveRoute() {
    const validation = validateRoutePoints(points);
    if (validation) {
      Alert.alert('Check your route', validation);
      return;
    }
    if (!routeIsCurrent) {
      Alert.alert('Recalculate route', 'Please calculate the route again after your latest changes before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const origin = points[0];
      const destination = points[points.length - 1];
      const payload = points.map((p, sequence) => ({
        id: p.id || null,
        sequence,
        waypoint_type: p.waypoint_type,
        name: p.name.trim(),
        address: p.address || p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        provider_place_id: p.provider_place_id || null,
        notes: p.notes || null,
        is_optional: !!p.is_optional,
        day_number: days.find(d => d.id === p.trip_day_id)?.day_number ?? p.day_number ?? null,
      }));

      const { error: saveError } = await supabase.rpc('save_trip_route', {
        p_ride_id: id,
        p_trip: {
          origin: origin.address || origin.name,
          destination: destination.address || destination.name,
          origin_coords: [origin.longitude, origin.latitude],
          destination_coords: [destination.longitude, destination.latitude],
          route_geometry: routeGeometry,
          estimated_distance_meters: distance,
          estimated_duration_seconds: duration,
        },
        p_waypoints: payload,
      });
      if (saveError) throw saveError;
      Alert.alert(
        'Route saved',
        'The updated route and estimates have been saved and shared with your group.',
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e: any) {
      setError(e?.message || 'Could not save route changes.');
    } finally {
      setSaving(false);
    }
  }

  const mapPoints = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: points
        .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && p.name.trim())
        .map((p, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.longitude, p.latitude] },
          properties: { label: String(i + 1), kind: p.waypoint_type },
        })),
    }),
    [points],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.muted}>Loading route workshop…</Text>
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Route unavailable</Text>
        <Text style={styles.muted}>{error || 'Trip not found.'}</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Route is read-only</Text>
        <Text style={styles.muted}>Only the trip leader can edit this route.</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>ROUTE WORKSHOP · {trip.status.toUpperCase()}</Text>
        <Text style={styles.title}>Shape the journey.</Text>
        <Text style={styles.muted}>
          Add fuel, food, scenic stops and rest breaks. Reorder or change any waypoint before saving.
        </Text>

        {/* Map Preview Card */}
        <View style={styles.mapCard}>
          {Mapbox && routeGeometry ? (
            <Mapbox.MapView
              style={styles.map}
              styleURL={theme.background === '#14221D' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/outdoors-v12'}
              logoEnabled={false}
              attributionEnabled={true}
            >
              <Mapbox.Camera
                ref={camera}
                defaultSettings={{ centerCoordinate: routeGeometry.geometry.coordinates[0], zoomLevel: 8 }}
              />
              <Mapbox.ShapeSource id="route-preview-line" shape={routeGeometry}>
                <Mapbox.LineLayer
                  id="route-preview-casing"
                  style={{ lineColor: '#FFFFFF', lineWidth: 8, lineCap: 'round', lineJoin: 'round' }}
                />
                <Mapbox.LineLayer
                  id="route-preview"
                  style={{ lineColor: theme.accent, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
                />
              </Mapbox.ShapeSource>
              <Mapbox.ShapeSource id="route-preview-points" shape={mapPoints}>
                <Mapbox.CircleLayer
                  id="route-preview-point-circles"
                  style={{ circleRadius: 7, circleColor: theme.green, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2 }}
                />
              </Mapbox.ShapeSource>
            </Mapbox.MapView>
          ) : (
            <View style={styles.mapFallback}>
              <Text style={styles.mapFallbackTitle}>Route Preview</Text>
              <Text style={styles.mutedCenter}>
                {TOKEN
                  ? 'Calculate the route below to display road geometry, distance, and travel time.'
                  : 'Configure EXPO_PUBLIC_MAPBOX_TOKEN to enable route mapping and search.'}
              </Text>
            </View>
          )}
          <View style={styles.metrics}>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{formatRouteDistance(distance)}</Text>
              <Text style={styles.metricLabel}>DISTANCE</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{formatRouteDuration(duration)}</Text>
              <Text style={styles.metricLabel}>EST. TRAVEL</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{points.length}</Text>
              <Text style={styles.metricLabel}>POINTS</Text>
            </View>
          </View>
          {!!routeNote && <Text style={styles.note}>{routeNote}</Text>}
        </View>

        {/* Route Status Prompt */}
        {!routeIsCurrent ? (
          <View style={styles.statusBannerPending}>
            <Text style={styles.statusBannerIcon}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerTitle}>Route modified</Text>
              <Text style={styles.statusBannerText}>
                Points have changed. Tap “Recalculate route” below to update road geometry and travel estimates.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.statusBannerReady}>
            <Text style={styles.statusBannerIcon}>✓</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerTitleReady}>Route up to date</Text>
              <Text style={styles.statusBannerTextReady}>
                Road geometry is current ({formatRouteDistance(distance)} · {formatRouteDuration(duration)}). Ready to save!
              </Text>
            </View>
          </View>
        )}

        {/* Stops List */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.section}>Route Waypoints ({points.length})</Text>
              <Text style={styles.mutedSmall}>
                Start and Finish frame your ride. Add, reorder, or assign intermediate stops to days.
              </Text>
            </View>
          </View>

          {points.map((point, index) => {
            const isStart = index === 0;
            const isFinish = index === points.length - 1;
            const isIntermediate = !isStart && !isFinish;
            const meta = WAYPOINT_META[point.waypoint_type] || WAYPOINT_META.stop;
            const assignedDay = days.find(d => d.id === point.trip_day_id);

            return (
              <React.Fragment key={point.id || 'point-' + index}>
                {/* Subtle insert button between stops */}
                {index > 0 && (
                  <View style={styles.insertDividerContainer}>
                    <View style={styles.insertDividerLine} />
                    <TouchableOpacity
                      style={styles.insertBetweenButton}
                      onPress={() => openAddStop('stop', index)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.insertBetweenText}>＋ Insert stop here</Text>
                    </TouchableOpacity>
                    <View style={styles.insertDividerLine} />
                  </View>
                )}

                <View style={[styles.pointCard, isStart && styles.startCard, isFinish && styles.finishCard]}>
                  {/* Sequence and Type Badges */}
                  <View style={styles.pointHeader}>
                    <View style={[styles.sequenceBadge, isStart && styles.startBadge, isFinish && styles.finishBadge]}>
                      <Text style={styles.sequenceText}>{index + 1}</Text>
                    </View>
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>
                        {meta.icon} {meta.label.toUpperCase()}
                      </Text>
                    </View>
                    {days.length > 0 && isIntermediate && (
                      <TouchableOpacity
                        style={styles.dayBadge}
                        onPress={() => openDayPicker(index)}
                      >
                        <Text style={styles.dayBadgeText}>
                          {assignedDay ? `📅 Day ${assignedDay.day_number}` : '＋ Assign Day'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Place Info */}
                  <View style={styles.placeInfo}>
                    <Text style={styles.placeName}>{point.name || 'Unnamed waypoint'}</Text>
                    {!!point.address && point.address !== point.name && (
                      <Text style={styles.placeAddress}>{point.address}</Text>
                    )}
                    {!!point.notes && (
                      <View style={styles.pointNotesBox}>
                        <Text style={styles.pointNotesText}>📝 {point.notes}</Text>
                      </View>
                    )}
                  </View>

                  {/* Actions for this point */}
                  <View style={styles.pointActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => openEditPoint(index)}
                    >
                      <Text style={styles.actionButtonText}>✎ Change</Text>
                    </TouchableOpacity>

                    {isIntermediate && (
                      <>
                        {/* Waypoint Type Switcher Pill */}
                        <TouchableOpacity
                          style={styles.typeSwitcherButton}
                          onPress={() => {
                            // Cycle through editable types or open edit modal
                            const currIdx = EDITABLE_WAYPOINT_TYPES.indexOf(point.waypoint_type);
                            const nextType = EDITABLE_WAYPOINT_TYPES[(currIdx + 1) % EDITABLE_WAYPOINT_TYPES.length];
                            handleChangeWaypointType(index, nextType);
                          }}
                        >
                          <Text style={styles.typeSwitcherText}>
                            Type: {meta.short} ↻
                          </Text>
                        </TouchableOpacity>

                        {/* Reorder Buttons */}
                        <View style={styles.reorderGroup}>
                          <TouchableOpacity
                            style={[styles.arrowButton, index === 1 && styles.disabledButton]}
                            disabled={index === 1}
                            onPress={() => handleMoveStop(index, -1)}
                          >
                            <Text style={[styles.arrowButtonText, index === 1 && styles.disabledText]}>▲</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.arrowButton, index === points.length - 2 && styles.disabledButton]}
                            disabled={index === points.length - 2}
                            onPress={() => handleMoveStop(index, 1)}
                          >
                            <Text style={[styles.arrowButtonText, index === points.length - 2 && styles.disabledText]}>▼</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Remove */}
                        <TouchableOpacity
                          style={styles.removeButton}
                          onPress={() => handleRemoveStop(index)}
                        >
                          <Text style={styles.removeButtonText}>✕ Remove</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              </React.Fragment>
            );
          })}

          {/* Quick Add Bar */}
          <Text style={styles.addSectionLabel}>ADD WAYPOINT TO ROUTE</Text>
          <View style={styles.addButtonsRow}>
            <TouchableOpacity style={styles.addPill} onPress={() => openAddStop('stop')}>
              <Text style={styles.addPillText}>🛑 ＋ Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addPill} onPress={() => openAddStop('fuel')}>
              <Text style={styles.addPillText}>⛽ ＋ Fuel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addPill} onPress={() => openAddStop('food')}>
              <Text style={styles.addPillText}>🍽️ ＋ Food</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addPill} onPress={() => openAddStop('rest')}>
              <Text style={styles.addPillText}>☕ ＋ Rest</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addPill} onPress={() => openAddStop('sightseeing')}>
              <Text style={styles.addPillText}>📸 ＋ Scenic</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Buttons: Recalculate and Save */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[styles.calculateButton, !routeIsCurrent && styles.calculateHighlight]}
            disabled={calculating || saving}
            onPress={() => void calculateRoute()}
          >
            {calculating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.calculateButtonText}>
                {routeIsCurrent ? '↻ Recalculate route' : '⚡ Recalculate route now'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveButton, (!routeIsCurrent || saving) && styles.saveDisabled]}
            disabled={saving || !routeIsCurrent}
            onPress={() => void saveRoute()}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>
                {routeIsCurrent ? 'Save shared route' : 'Recalculate route before saving'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}

        <Text style={styles.footer}>
          Mapbox driving directions provide accurate road estimates. Actual motorcycle riding times vary based on group pace, road quality, and breaks.
        </Text>
      </ScrollView>

      {/* =========================================================================
          PLACE SEARCH MODAL (Dedicated sheet, auto-focused, zero dummy point bugs)
          ========================================================================= */}
      <Modal
        visible={searchModal.visible}
        animationType="slide"
        transparent={true}
        onRequestClose={closeSearchModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {searchModal.mode === 'add'
                    ? 'Add Route Stop'
                    : searchModal.targetIndex === 0
                    ? 'Change Start Location'
                    : searchModal.targetIndex === points.length - 1
                    ? 'Change Destination'
                    : `Change Stop #${searchModal.targetIndex}`}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {searchModal.mode === 'add'
                    ? 'Pick a category and search for a town, landmark, or fuel pump.'
                    : 'Search for a replacement location for this waypoint.'}
                </Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={closeSearchModal}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Waypoint Category Selector (Intermediate points only) */}
            {(searchModal.mode === 'add' ||
              (searchModal.targetIndex > 0 && searchModal.targetIndex < points.length - 1)) && (
              <View style={styles.categoryPickerSection}>
                <Text style={styles.categoryLabel}>WAYPOINT CATEGORY</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                  {EDITABLE_WAYPOINT_TYPES.map(type => {
                    const meta = WAYPOINT_META[type];
                    const isSelected = searchModal.waypointType === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={[styles.categoryPill, isSelected && styles.categoryPillSelected]}
                        onPress={() => setSearchModal(curr => ({ ...curr, waypointType: type }))}
                      >
                        <Text style={[styles.categoryPillText, isSelected && styles.categoryPillTextSelected]}>
                          {meta.icon} {meta.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Notes / Road Conditions Input */}
            <View style={styles.notesSection}>
              <Text style={styles.categoryLabel}>NOTES / ROAD CONDITIONS (OPTIONAL)</Text>
              <TextInput
                style={styles.notesInput}
                value={stopNotes}
                onChangeText={setStopNotes}
                placeholder="e.g. Broken tarmac, hairpin bends, fuel pump..."
                placeholderTextColor={theme.subtle}
                multiline
                numberOfLines={2}
              />
            </View>

            {/* Quick save button when editing notes/category without replacing location */}
            {searchModal.mode === 'edit' && (
              <TouchableOpacity
                style={styles.saveDetailsOnlyButton}
                onPress={saveStopDetailsOnly}
              >
                <Text style={styles.saveDetailsOnlyText}>💾 Save notes & category</Text>
              </TouchableOpacity>
            )}

            {/* Search Input Bar */}
            <View style={styles.searchInputContainer}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search town, fuel station, landmark..."
                placeholderTextColor={theme.subtle}
                autoFocus={true}
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchButton}>
                  <Text style={styles.clearSearchText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Suggestions List */}
            <View style={styles.suggestionsContainer}>
              {searchLoading && (
                <View style={styles.searchStatusRow}>
                  <ActivityIndicator color={theme.accent} size="small" />
                  <Text style={styles.searchStatusText}>Searching places…</Text>
                </View>
              )}

              {!!searchError && (
                <View style={styles.searchErrorBox}>
                  <Text style={styles.searchErrorText}>{searchError}</Text>
                </View>
              )}

              {!searchLoading && searchQuery.trim().length >= 2 && suggestions.length === 0 && !searchError && (
                <View style={styles.emptySearchContainer}>
                  <Text style={styles.emptySearchText}>No places found matching “{searchQuery}”.</Text>
                  <Text style={styles.emptySearchSubtext}>Try searching with a city, highway, or landmark name.</Text>
                </View>
              )}

              <ScrollView
                style={styles.suggestionsList}
                keyboardShouldPersistTaps="handled"
              >
                {suggestions.map(place => (
                  <TouchableOpacity
                    key={place.id}
                    style={styles.suggestionItem}
                    onPress={() => handleSelectPlace(place)}
                  >
                    <View style={styles.suggestionIconContainer}>
                      <Text style={styles.suggestionIcon}>
                        {WAYPOINT_META[searchModal.waypointType]?.icon || '📍'}
                      </Text>
                    </View>
                    <View style={styles.suggestionInfo}>
                      <Text style={styles.suggestionTitle}>{place.name}</Text>
                      <Text style={styles.suggestionAddress} numberOfLines={2}>
                        {place.address}
                      </Text>
                    </View>
                    <Text style={styles.suggestionArrow}>＋</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Modal Bottom Cancel Button */}
            <TouchableOpacity style={styles.modalCancelButton} onPress={closeSearchModal}>
              <Text style={styles.modalCancelText}>Cancel without adding</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =========================================================================
          DAY PICKER MODAL (Clean, single-tap day selection; no cyclic clicking!)
          ========================================================================= */}
      <Modal
        visible={dayPicker.visible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setDayPicker({ visible: false, pointIndex: null })}
      >
        <View style={styles.modalOverlayCenter}>
          <View style={styles.dayPickerContent}>
            <Text style={styles.modalTitle}>Assign to Itinerary Day</Text>
            <Text style={styles.modalSubtitle}>
              Select which day of the trip this stop belongs to:
            </Text>

            <TouchableOpacity
              style={styles.dayOptionItem}
              onPress={() => handleAssignDay(null)}
            >
              <Text style={styles.dayOptionTitle}>🔘 Unassigned</Text>
              <Text style={styles.dayOptionSub}>Not tied to a specific dated day</Text>
            </TouchableOpacity>

            {days.map(day => (
              <TouchableOpacity
                key={day.id}
                style={styles.dayOptionItem}
                onPress={() => handleAssignDay(day.id)}
              >
                <Text style={styles.dayOptionTitle}>
                  📅 Day {day.day_number}{day.title ? ` · ${day.title}` : ''}
                </Text>
                {!!day.trip_date && (
                  <Text style={styles.dayOptionSub}>{day.trip_date}</Text>
                )}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setDayPicker({ visible: false, pointIndex: null })}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 18, paddingBottom: 48 },
    center: {
      flex: 1,
      backgroundColor: c.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 12,
    },
    eyebrow: { color: c.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
    title: { color: c.text, fontSize: 28, fontWeight: '900', marginTop: 6 },
    muted: { color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
    mutedCenter: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
    mutedSmall: { color: c.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },

    // Map Card
    mapCard: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 16,
      overflow: 'hidden',
      marginTop: 16,
    },
    map: { height: 230, width: '100%' },
    mapFallback: {
      height: 160,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    mapFallbackTitle: { color: c.text, fontSize: 16, fontWeight: '800' },
    metrics: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
    },
    metricItem: { alignItems: 'center' },
    metricValue: { color: c.text, fontSize: 17, fontWeight: '900' },
    metricLabel: { color: c.muted, fontSize: 9, fontWeight: '800', marginTop: 2 },
    note: {
      color: c.accent,
      fontSize: 11,
      lineHeight: 16,
      paddingHorizontal: 14,
      paddingBottom: 10,
      fontWeight: '600',
    },

    // Status Banners
    statusBannerPending: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.accentSoft,
      borderColor: c.accent,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginTop: 14,
      gap: 10,
    },
    statusBannerReady: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.greenSoft,
      borderColor: c.green,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginTop: 14,
      gap: 10,
    },
    statusBannerIcon: { fontSize: 18 },
    statusBannerTitle: { color: c.accent, fontSize: 13, fontWeight: '800' },
    statusBannerText: { color: c.text, fontSize: 11, lineHeight: 16, marginTop: 2 },
    statusBannerTitleReady: { color: c.green, fontSize: 13, fontWeight: '800' },
    statusBannerTextReady: { color: c.text, fontSize: 11, lineHeight: 16, marginTop: 2 },

    // Card & Section
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
      marginTop: 16,
    },
    sectionHeader: { marginBottom: 12 },
    section: { color: c.text, fontSize: 18, fontWeight: '800' },

    // Point Cards
    pointCard: {
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginVertical: 4,
    },
    startCard: { borderColor: c.green, borderWidth: 1.5 },
    finishCard: { borderColor: c.accent, borderWidth: 1.5 },
    pointHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    sequenceBadge: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    startBadge: { backgroundColor: c.greenSoft },
    finishBadge: { backgroundColor: c.accentSoft },
    sequenceText: { color: c.text, fontSize: 11, fontWeight: '900' },
    typeBadge: {
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    typeBadgeText: { color: c.text, fontSize: 10, fontWeight: '800' },
    dayBadge: {
      marginLeft: 'auto',
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.border,
    },
    dayBadgeText: { color: c.accent, fontSize: 10, fontWeight: '700' },

    placeInfo: { marginVertical: 4 },
    placeName: { color: c.text, fontSize: 15, fontWeight: '800' },
    placeAddress: { color: c.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
    pointNotesBox: {
      backgroundColor: c.surfaceRaised,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 5,
      marginTop: 6,
      borderLeftWidth: 3,
      borderLeftColor: c.accent,
    },
    pointNotesText: {
      color: c.text,
      fontSize: 11,
      lineHeight: 15,
    },

    pointActions: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    actionButton: {
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
    },
    actionButtonText: { color: c.accent, fontSize: 11, fontWeight: '800' },
    typeSwitcherButton: {
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    typeSwitcherText: { color: c.muted, fontSize: 10, fontWeight: '700' },
    reorderGroup: {
      flexDirection: 'row',
      gap: 4,
    },
    arrowButton: {
      backgroundColor: c.surfaceRaised,
      width: 28,
      height: 28,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },
    arrowButtonText: { color: c.text, fontSize: 12, fontWeight: '800' },
    disabledButton: { opacity: 0.25 },
    disabledText: { color: c.subtle },
    removeButton: {
      marginLeft: 'auto',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    removeButtonText: { color: c.danger, fontSize: 11, fontWeight: '800' },

    // Insert Divider between stops
    insertDividerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 4,
      paddingHorizontal: 8,
    },
    insertDividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: c.border,
    },
    insertBetweenButton: {
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      marginHorizontal: 8,
    },
    insertBetweenText: {
      color: c.accent,
      fontSize: 10,
      fontWeight: '800',
    },

    // Quick Add Bar
    addSectionLabel: {
      color: c.muted,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.1,
      marginTop: 16,
      marginBottom: 8,
    },
    addButtonsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    addPill: {
      backgroundColor: c.greenSoft,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.green,
    },
    addPillText: { color: c.green, fontSize: 12, fontWeight: '800' },

    // Action Buttons
    actionsContainer: { marginTop: 16, gap: 10 },
    calculateButton: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.accent,
      borderWidth: 1.5,
      borderRadius: 12,
      padding: 15,
      alignItems: 'center',
    },
    calculateHighlight: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    calculateButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
    saveButton: {
      backgroundColor: c.green,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
    },
    saveDisabled: { opacity: 0.45 },
    saveButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
    secondaryButton: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
      marginTop: 12,
    },
    secondaryButtonText: { color: c.text, fontWeight: '800' },
    errorBox: {
      backgroundColor: c.accentSoft,
      borderRadius: 10,
      padding: 12,
      marginTop: 12,
    },
    errorText: { color: c.danger, fontSize: 12, fontWeight: '700' },
    footer: {
      color: c.subtle,
      fontSize: 10,
      lineHeight: 16,
      textAlign: 'center',
      marginTop: 18,
    },

    // Search Modal Styles
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      maxHeight: '85%',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    modalTitle: { color: c.text, fontSize: 19, fontWeight: '900' },
    modalSubtitle: { color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
    modalCloseButton: {
      padding: 6,
      borderRadius: 16,
      backgroundColor: c.surfaceRaised,
    },
    modalCloseText: { color: c.text, fontSize: 14, fontWeight: '800', width: 18, textAlign: 'center' },

    // Category Selector in Modal
    categoryPickerSection: { marginBottom: 12 },
    categoryLabel: { color: c.subtle, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
    categoryRow: { flexDirection: 'row', gap: 6 },
    categoryPill: {
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    categoryPillSelected: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    categoryPillText: { color: c.text, fontSize: 11, fontWeight: '700' },
    categoryPillTextSelected: { color: '#FFFFFF', fontWeight: '800' },

    // Notes & Details in Modal
    notesSection: { marginBottom: 12 },
    notesInput: {
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: c.text,
      fontSize: 13,
      minHeight: 48,
      textAlignVertical: 'top',
    },
    saveDetailsOnlyButton: {
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.accent,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
      marginBottom: 12,
    },
    saveDetailsOnlyText: {
      color: c.accent,
      fontSize: 12,
      fontWeight: '800',
    },

    // Search Input in Modal
    searchInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 12,
      paddingHorizontal: 12,
      marginBottom: 12,
    },
    searchIcon: { fontSize: 14, marginRight: 8 },
    searchInput: {
      flex: 1,
      paddingVertical: 12,
      color: c.text,
      fontSize: 15,
      fontWeight: '600',
    },
    clearSearchButton: { padding: 6 },
    clearSearchText: { color: c.muted, fontSize: 13, fontWeight: '800' },

    // Suggestions List in Modal
    suggestionsContainer: { minHeight: 180, maxHeight: 280 },
    suggestionsList: { flex: 1 },
    suggestionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: 10,
    },
    suggestionIconContainer: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    suggestionIcon: { fontSize: 16 },
    suggestionInfo: { flex: 1 },
    suggestionTitle: { color: c.text, fontSize: 14, fontWeight: '700' },
    suggestionAddress: { color: c.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
    suggestionArrow: { color: c.accent, fontSize: 16, fontWeight: '900' },

    searchStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 20,
    },
    searchStatusText: { color: c.muted, fontSize: 12, fontWeight: '600' },
    searchErrorBox: {
      backgroundColor: c.accentSoft,
      padding: 10,
      borderRadius: 8,
      marginVertical: 10,
    },
    searchErrorText: { color: c.danger, fontSize: 12 },
    emptySearchContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 24,
    },
    emptySearchText: { color: c.text, fontSize: 13, fontWeight: '700' },
    emptySearchSubtext: { color: c.muted, fontSize: 11, marginTop: 4 },

    modalCancelButton: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: 13,
      alignItems: 'center',
      marginTop: 12,
    },
    modalCancelText: { color: c.muted, fontSize: 13, fontWeight: '800' },

    // Day Picker Modal
    modalOverlayCenter: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    dayPickerContent: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: c.surface,
      borderRadius: 20,
      padding: 20,
    },
    dayOptionItem: {
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      marginVertical: 4,
    },
    dayOptionTitle: { color: c.text, fontSize: 14, fontWeight: '800' },
    dayOptionSub: { color: c.muted, fontSize: 11, marginTop: 2 },
  });
