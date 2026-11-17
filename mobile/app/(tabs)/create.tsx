import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { canCreateMoreTrips, canAddMoreWaypoints, PLAN_LIMITS, PAYMENT_CONFIG } from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import * as Location from 'expo-location';
import { useRideTheme, RidePalette } from '../../src/theme';
import CalendarPickerModal, { formatDateNice, formatYMD } from '../../src/components/CalendarPickerModal';

type Place = { id: string; name: string; address: string; longitude: number; latitude: number };
type WaypointKind = 'stop' | 'fuel' | 'food' | 'rest' | 'sightseeing' | 'repair';
const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

function LocationSearch({
  label,
  placeholder,
  value,
  onChange,
  showCurrentLocation = false,
}: {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  showCurrentLocation?: boolean;
}) {
  const [query, setQuery] = useState(value?.name || '');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchOrigin, setSearchOrigin] = useState<[number, number] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [locationError, setLocationError] = useState('');
  const requestId = React.useRef(0);
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    if (value) setQuery(value.name);
  }, [value?.id]);

  useEffect(() => {
    let cancelled = false;
    Location.getLastKnownPositionAsync({ maxAge: 600000, requiredAccuracy: 5000 })
      .then((position) => {
        if (!cancelled && position) setSearchOrigin([position.coords.longitude, position.coords.latitude]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (value && trimmed === value.name) {
      setSuggestions([]);
      setSearchError('');
      setLoading(false);
      return;
    }
    if (trimmed.length < 2 || !TOKEN) {
      setSuggestions([]);
      setSearchError('');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const currentRequest = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setSearchError('');
      try {
        const params = new URLSearchParams({
          autocomplete: 'true',
          fuzzyMatch: 'true',
          limit: '8',
          country: 'IN',
          language: 'en',
          worldview: 'in',
          types: 'poi,address,place,locality,neighborhood,postcode,region',
          access_token: TOKEN,
        });
        if (searchOrigin) params.set('proximity', searchOrigin.join(','));
        const url =
          'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
          encodeURIComponent(trimmed) +
          '.json?' +
          params.toString();
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Search is temporarily unavailable. Please try again.');
        const json = await response.json();
        if (controller.signal.aborted || currentRequest !== requestId.current) return;
        const seen = new Set<string>();
        const results: Place[] = (json.features || []).reduce((items: Place[], item: any) => {
          if (!Array.isArray(item.center) || item.center.length < 2) return items;
          const id = String(item.id || item.place_name);
          if (seen.has(id)) return items;
          seen.add(id);
          items.push({
            id,
            name: item.text || item.place_name || 'Unnamed place',
            address: item.place_name || item.text || 'Address unavailable',
            longitude: Number(item.center[0]),
            latitude: Number(item.center[1]),
          });
          return items;
        }, []);
        setSuggestions(results);
        if (results.length === 0) setSearchError('No matching places. Try a nearby landmark, locality or PIN code.');
      } catch (error: any) {
        if (!controller.signal.aborted && currentRequest === requestId.current) {
          setSuggestions([]);
          setSearchError(error?.message || 'Could not search locations.');
        }
      } finally {
        if (!controller.signal.aborted && currentRequest === requestId.current) setLoading(false);
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value?.id, searchOrigin?.[0], searchOrigin?.[1]]);

  async function useCurrentLocation() {
    setLocating(true);
    setLocationError('');
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError('Allow location access to use your current position. You can still search manually.');
        return;
      }

      let position = await Location.getLastKnownPositionAsync({
        maxAge: 60000,
        requiredAccuracy: 500,
      });
      if (!position || Date.now() - position.timestamp > 60000) {
        position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      }

      const { latitude, longitude } = position.coords;
      let addressParts: string[] = [];
      try {
        const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
        const address = addresses[0];
        if (address) {
          addressParts = [
            address.name,
            address.street,
            address.district,
            address.city || address.subregion,
            address.region,
            address.postalCode,
          ].filter((part): part is string => Boolean(part));
        }
      } catch {
        // Coordinates are still valid; reverse geocoding is best-effort.
      }
      const readableAddress = [...new Set(addressParts)].join(', ');
      const place: Place = {
        id: 'device-location:' + latitude.toFixed(6) + ',' + longitude.toFixed(6),
        name: readableAddress ? readableAddress.split(',')[0] : 'Current location',
        address: readableAddress || 'Current location (' + latitude.toFixed(5) + ', ' + longitude.toFixed(5) + ')',
        latitude,
        longitude,
      };
      setSearchOrigin([longitude, latitude]);
      onChange(place);
      setQuery(place.name);
      setSuggestions([]);
      setSearchError('');
    } catch (error: any) {
      setLocationError(error?.message || 'Could not get your current location. Check GPS and try again.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          onChange(null);
          setLocationError('');
        }}
        placeholder={placeholder}
        placeholderTextColor="#77809a"
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="search"
      />
      {showCurrentLocation ? (
        <TouchableOpacity
          style={styles.currentLocationButton}
          onPress={useCurrentLocation}
          disabled={locating}
          accessibilityRole="button"
          accessibilityLabel="Use current location as trip origin"
        >
          {locating ? <ActivityIndicator color={theme.accent} size="small" /> : <Text style={styles.currentLocationIcon}>◎</Text>}
          <Text style={styles.currentLocationText}>{locating ? 'Getting current location…' : 'Use current location'}</Text>
        </TouchableOpacity>
      ) : null}
      {loading ? <ActivityIndicator color={theme.accent} style={{ alignSelf: 'flex-start', marginTop: 8 }} /> : null}
      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((place) => (
            <TouchableOpacity
              key={place.id}
              style={styles.suggestion}
              onPress={() => {
                onChange(place);
                setQuery(place.name);
                setSuggestions([]);
                setSearchError('');
              }}
            >
              <Text style={styles.suggestionTitle}>{place.name}</Text>
              <Text style={styles.suggestionAddress}>{place.address}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {value ? <Text style={styles.selected}>✓ {value.address}</Text> : null}
      {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
      {searchError ? <Text style={styles.help}>{searchError}</Text> : null}
      {!TOKEN ? <Text style={styles.help}>Add EXPO_PUBLIC_MAPBOX_TOKEN to enable searchable places.</Text> : null}
    </View>
  );
}

export default function CreateRideScreen() {
  // Core Essentials
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<'trip' | 'stay'>('trip');

  // Route Preview
  const [previewRoute, setPreviewRoute] = useState<{ distance: number; duration: number } | null>(null);

  // Optional Customizations
  const [showCustomizations, setShowCustomizations] = useState(false);
  const [tripType, setTripType] = useState<'solo' | 'group' | 'weekend' | 'touring' | 'expedition'>('group');
  const [description, setDescription] = useState('');
  const [meetup, setMeetup] = useState<Place | null>(null);
  const [stops, setStops] = useState<Array<{ key: string; place: Place | null; kind: WaypointKind }>>([]);

  // Overnight stay
  const [stay, setStay] = useState<Place | null>(null);
  const [stayType, setStayType] = useState<'hotel' | 'homestay' | 'hostel' | 'camping' | 'guesthouse'>('hotel');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [stayPrice, setStayPrice] = useState('');

  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Route preview fetcher
  useEffect(() => {
    if (!TOKEN || !origin || !destination) {
      setPreviewRoute(null);
      return;
    }
    const controller = new AbortController();
    const coords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?overview=false&access_token=${TOKEN}`,
      { signal: controller.signal }
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.routes?.[0]) {
          setPreviewRoute({
            distance: Math.round(data.routes[0].distance),
            duration: Math.round(data.routes[0].duration),
          });
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [origin?.id, destination?.id]);

  const days = useMemo(() => {
    if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return [];
    }
    const start = new Date(startDate + 'T12:00:00Z');
    const end = new Date(endDate + 'T12:00:00Z');
    if (Number.isNaN(start.getTime()) || end < start) return [];
    const result: string[] = [];
    for (let d = new Date(start); d <= end && result.length < 31; d.setUTCDate(d.getUTCDate() + 1)) {
      result.push(d.toISOString().slice(0, 10));
    }
    return result;
  }, [startDate, endDate]);

  function setPresetDates(start: Date, end: Date) {
    setStartDate(formatYMD(start));
    setEndDate(formatYMD(end));
  }

  function handlePresetToday() {
    const now = new Date();
    setPresetDates(now, now);
  }

  function handlePresetTomorrow() {
    const tom = new Date();
    tom.setDate(tom.getDate() + 1);
    setPresetDates(tom, tom);
  }

  function handlePresetThisWeekend() {
    const now = new Date();
    const day = now.getDay();
    const sat = new Date(now);
    if (day !== 6 && day !== 0) {
      sat.setDate(now.getDate() + (6 - day));
    }
    const sun = new Date(sat);
    if (day !== 0) {
      sun.setDate(sat.getDate() + 1);
    }
    setPresetDates(sat, sun);
  }

  function handlePresetNextWeekend() {
    const now = new Date();
    const day = now.getDay();
    const daysUntilNextSat = (6 - day + 7) % 7 || 7;
    const sat = new Date(now);
    sat.setDate(now.getDate() + daysUntilNextSat);
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    setPresetDates(sat, sun);
  }

  function handleSelectDates(start: string, end: string) {
    if (calendarTarget === 'trip') {
      setStartDate(start);
      setEndDate(end);
      if (stay && !checkIn) {
        setCheckIn(start);
        setCheckOut(end);
      }
    } else {
      setCheckIn(start);
      setCheckOut(end);
    }
  }

  function addStop(kind: WaypointKind = 'stop') {
    if (!canAddMoreWaypoints(stops.length, 'free')) {
      Alert.alert(
        '⭐️ Pro Tourer Stop Limit',
        `Free tier allows up to ${PLAN_LIMITS.free.maxWaypointsPerTrip} stops per trip. Upgrade to Pro Tourer for up to ${PLAN_LIMITS.pro_tourer.maxWaypointsPerTrip} stops per expedition.`,
        [
          { text: 'Keep Current', style: 'cancel' },
          {
            text: 'Learn More',
            onPress: () => Alert.alert('Pro Tourer Upgrade', 'Upgrade to Pro Tourer for ₹199/month for unlimited multi-day routes.'),
          },
        ]
      );
      return;
    }
    if (stops.length + 2 + (meetup ? 1 : 0) >= 25) {
      Alert.alert('Route point limit', 'Mapbox driving directions support up to 25 points, including origin and destination.');
      return;
    }
    setStops((current) => [...current, { key: String(Date.now()) + Math.random(), place: null, kind }]);
  }

  function updateStop(key: string, place: Place | null) {
    setStops((current) => current.map((stop) => (stop.key === key ? { ...stop, place } : stop)));
  }

  async function handleCreate() {
    if (!name.trim() || !origin || !destination) {
      Alert.alert('Missing trip details', 'Please add a trip name, a starting point (origin) and a final destination.');
      return;
    }
    if (!user) return;
    if (startDate && endDate && days.length === 0) {
      Alert.alert('Check trip dates', 'Please ensure the end date is on or after the start date.');
      return;
    }
    if (stops.some((s) => !s.place)) {
      Alert.alert('Incomplete stop', 'Please select a location for every added stop or remove the empty stop.');
      return;
    }
    setLoading(true);
    try {
      // Check free tier limits
      const { count, error: countError } = await supabase
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', user.id)
        .neq('status', 'completed');
      if (!countError && typeof count === 'number' && !canCreateMoreTrips(count, 'free')) {
        Alert.alert(
          '⭐️ RideNTrack Pro Tourer Limit',
          `Free tier includes up to ${PLAN_LIMITS.free.maxActiveTrips} active trips. Upgrade to Pro Tourer (₹${PAYMENT_CONFIG.monthlyPlanPriceInr}/month) for unlimited expeditions, topographical contours, and weather radar.`,
          [
            { text: 'Manage Trips', onPress: () => router.push('/(tabs)') },
            {
              text: 'Upgrade to Pro',
              onPress: () => Alert.alert('Payment Gateway', 'Razorpay checkout will launch in production build. Test mode: Plan benefits unlocked!'),
            },
          ]
        );
        setLoading(false);
        return;
      }

      const ordered = [
        { place: origin, type: 'origin' },
        ...(meetup ? [{ place: meetup, type: 'meetup' }] : []),
        ...stops.map((s) => ({ place: s.place!, type: s.kind })),
        { place: destination, type: 'destination' },
      ];

      let routeGeometry: any = null;
      let distance: number | null = null;
      let duration: number | null = null;

      if (TOKEN && ordered.length >= 2) {
        try {
          const coords = ordered.map((p) => p.place.longitude + ',' + p.place.latitude).join(';');
          const response = await fetch(
            'https://api.mapbox.com/directions/v5/mapbox/driving/' +
              coords +
              '?overview=full&geometries=geojson&steps=false&access_token=' +
              TOKEN
          );
          if (response.ok) {
            const data = await response.json();
            if (data.routes?.[0]) {
              routeGeometry = { type: 'Feature', geometry: data.routes[0].geometry, properties: {} };
              distance = Math.round(data.routes[0].distance);
              duration = Math.round(data.routes[0].duration);
            }
          }
        } catch {
          routeGeometry = null;
          distance = null;
          duration = null;
        }
      }

      const waypointRows = ordered.map((item, index) => ({
        sequence: index,
        waypoint_type: item.type,
        name: item.place.name,
        address: item.place.address,
        latitude: item.place.latitude,
        longitude: item.place.longitude,
        provider_place_id: item.place.id,
      }));

      const dayRows = days.map((date, index) => ({
        day_number: index + 1,
        trip_date: date,
        title: 'Day ' + (index + 1),
      }));

      const stayPayload = stay
        ? {
            name: stay.name,
            stay_type: stayType,
            address: stay.address,
            latitude: stay.latitude,
            longitude: stay.longitude,
            provider_place_id: stay.id,
            check_in: checkIn || startDate || null,
            check_out: checkOut || endDate || null,
            price_amount: stayPrice ? Number(stayPrice) : null,
            price_currency: 'INR',
            day_number: 1,
          }
        : null;

      const { data: rideId, error } = await supabase.rpc('create_trip_plan', {
        p_trip: {
          name: name.trim(),
          description: description.trim() || null,
          trip_type: tripType,
          visibility: 'invite_only',
          start_date: startDate || null,
          end_date: endDate || null,
          origin: origin.address,
          destination: destination.address,
          origin_coords: [origin.longitude, origin.latitude],
          destination_coords: [destination.longitude, destination.latitude],
          route_geometry: routeGeometry,
          estimated_distance_meters: distance,
          estimated_duration_seconds: duration,
        },
        p_waypoints: waypointRows,
        p_days: dayRows,
        p_stay: stayPayload,
      });

      if (error) throw error;
      if (!rideId) throw new Error('Trip creation returned no trip ID.');

      Alert.alert('Trip created', 'Your trip plan is ready. You can invite riders, divide into stages, and customize routes.', [
        { text: 'Open trip', onPress: () => router.push('/trip/' + rideId) },
      ]);
    } catch (error: any) {
      Alert.alert('Could not create trip', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>TRIP PLANNER  /  NEW EXPEDITION</Text>
      <Text style={styles.title}>Plan the miles.</Text>
      <Text style={styles.subtitle}>Enter the basics to map your trip in seconds. Customize stops, stages, and notes anytime.</Text>

      {/* Card 1: Core Essentials */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.section}>Quick Trip Setup</Text>
          <View style={styles.badgeEssential}>
            <Text style={styles.badgeEssentialText}>ESSENTIALS</Text>
          </View>
        </View>
        <Text style={styles.helper}>Name your trip, select starting point, destination, and dates to get started immediately.</Text>

        {/* Trip Name */}
        <View style={styles.field}>
          <Text style={styles.label}>Trip Name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Western Ghats Escapade"
            placeholderTextColor="#77809a"
          />
        </View>

        {/* Origin & Destination */}
        <LocationSearch
          label="Starting Point (Origin) *"
          placeholder="Search starting point"
          value={origin}
          onChange={setOrigin}
          showCurrentLocation
        />
        <LocationSearch
          label="Final Destination *"
          placeholder="Search final destination"
          value={destination}
          onChange={setDestination}
        />

        {/* Calendar Dates Section */}
        <View style={styles.field}>
          <View style={styles.dateLabelRow}>
            <Text style={styles.label}>Touring Dates</Text>
            {startDate ? (
              <TouchableOpacity onPress={() => { setStartDate(''); setEndDate(''); }}>
                <Text style={styles.clearDateText}>Clear dates</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.datePickerCard, Boolean(startDate) && styles.datePickerCardActive]}
            onPress={() => {
              setCalendarTarget('trip');
              setShowCalendar(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Select trip dates in calendar"
          >
            <Text style={styles.calendarIcon}>📅</Text>
            <View style={styles.datePickerTextWrapper}>
              <Text style={styles.datePickerTitle}>
                {startDate
                  ? `${formatDateNice(startDate)}${endDate && endDate !== startDate ? `  →  ${formatDateNice(endDate)}` : ''}`
                  : 'Tap to select ride dates (Calendar)'}
              </Text>
              <Text style={styles.datePickerSubtitle}>
                {days.length > 0 ? `${days.length} Day(s) planned` : 'One-day ride or multi-day tour'}
              </Text>
            </View>
            <Text style={styles.datePickerArrow}>›</Text>
          </TouchableOpacity>

          {/* Quick Presets */}
          <View style={styles.presetsRow}>
            <TouchableOpacity style={styles.presetPill} onPress={handlePresetToday}>
              <Text style={styles.presetPillText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetPill} onPress={handlePresetTomorrow}>
              <Text style={styles.presetPillText}>Tomorrow</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetPill} onPress={handlePresetThisWeekend}>
              <Text style={styles.presetPillText}>This Weekend</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetPill} onPress={handlePresetNextWeekend}>
              <Text style={styles.presetPillText}>Next Weekend</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Route Preview Badge if available */}
        {previewRoute ? (
          <View style={styles.routePreviewPill}>
            <Text style={styles.routePreviewText}>
              🏍️ Estimated leg: {(previewRoute.distance / 1000).toFixed(0)} km · ~{Math.round(previewRoute.duration / 3600)} hrs driving
            </Text>
          </View>
        ) : null}

        {/* Primary Create Button */}
        <TouchableOpacity
          style={[styles.primary, loading && { opacity: 0.65 }]}
          onPress={handleCreate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryText}>Create trip plan  →</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.helperCentered}>
          Create with the basics now. You can invite friends, add intermediate stops, and fine-tune stages next.
        </Text>
      </View>

      {/* Card 2: Customizations (Stops, Stays & Notes) - Optional & Expandable */}
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.customizationHeader}
          onPress={() => setShowCustomizations(!showCustomizations)}
          accessibilityRole="button"
          accessibilityLabel="Toggle optional trip customizations"
        >
          <View style={styles.customizationHeaderLeft}>
            <Text style={styles.section}>
              {showCustomizations ? '▾ Customizations & Stops' : '▸ Customize Trip (Stops, Stays & Notes)'}
            </Text>
            <Text style={styles.helper}>
              {showCustomizations
                ? 'Optional: Configure stops, stays, meetup points, or trip notes'
                : 'Tap to add intermediate stops, overnight stays, meetup points, or trip description'}
            </Text>
          </View>
          <View style={styles.toggleBadge}>
            <Text style={styles.toggleBadgeText}>{showCustomizations ? 'Hide' : 'Expand ＋'}</Text>
          </View>
        </TouchableOpacity>

        {showCustomizations && (
          <View style={styles.customizationBody}>
            {/* Trip Type */}
            <View style={styles.field}>
              <Text style={styles.label}>Trip Category</Text>
              <View style={styles.chips}>
                {(['group', 'weekend', 'touring', 'solo', 'expedition'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setTripType(type)}
                    style={[styles.chip, tripType === type && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, tripType === type && styles.chipTextActive]}>
                      {type[0].toUpperCase() + type.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Intermediate Stops */}
            <View style={styles.field}>
              <Text style={styles.label}>Intermediate Route Stops</Text>
              <Text style={styles.helper}>Add waypoints along the journey (fuel stations, restaurants, scenic viewpoints, rest breaks, repairs).</Text>
              {stops.map((stop, index) => (
                <View key={stop.key} style={styles.stopBlock}>
                  <View style={styles.stopHeader}>
                    <Text style={styles.label}>
                      {stop.kind.toUpperCase()} STOP {index + 1}
                    </Text>
                    <TouchableOpacity onPress={() => setStops((current) => current.filter((s) => s.key !== stop.key))}>
                      <Text style={styles.remove}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                  <LocationSearch
                    label="Location"
                    placeholder="Search a place to stop"
                    value={stop.place}
                    onChange={(place) => updateStop(stop.key, place)}
                  />
                </View>
              ))}
              <View style={styles.chips}>
                <TouchableOpacity style={styles.addButton} onPress={() => addStop('stop')}>
                  <Text style={styles.addText}>🛑 ＋ Stop</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addButton} onPress={() => addStop('fuel')}>
                  <Text style={styles.addText}>⛽ ＋ Fuel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addButton} onPress={() => addStop('food')}>
                  <Text style={styles.addText}>🍽️ ＋ Food</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addButton} onPress={() => addStop('rest')}>
                  <Text style={styles.addText}>☕ ＋ Rest</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addButton} onPress={() => addStop('sightseeing')}>
                  <Text style={styles.addText}>📸 ＋ Scenic</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addButton} onPress={() => addStop('repair')}>
                  <Text style={styles.addText}>🔧 ＋ Repair</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Meetup Point */}
            <LocationSearch
              label="Group Meetup Point (Optional)"
              placeholder="Where riders gather before departure"
              value={meetup}
              onChange={setMeetup}
            />

            {/* Overnight Stay */}
            <View style={styles.field}>
              <Text style={styles.label}>Overnight Stay (Optional)</Text>
              <LocationSearch
                label="Hotel / homestay / campsite"
                placeholder="Search accommodation"
                value={stay}
                onChange={setStay}
              />
              <View style={styles.chips}>
                {(['hotel', 'homestay', 'hostel', 'camping', 'guesthouse'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setStayType(type)}
                    style={[styles.chip, stayType === type && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, stayType === type && styles.chipTextActive]}>{type}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.stayDateButton}
                onPress={() => {
                  setCalendarTarget('stay');
                  setShowCalendar(true);
                }}
              >
                <Text style={styles.stayDateText}>
                  {checkIn
                    ? `Stay: ${formatDateNice(checkIn)} → ${formatDateNice(checkOut || checkIn)} 📅`
                    : 'Select Stay Dates in Calendar 📅'}
                </Text>
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                value={stayPrice}
                onChangeText={setStayPrice}
                keyboardType="decimal-pad"
                placeholder="Approx. price (INR, optional)"
                placeholderTextColor="#77809a"
              />
            </View>

            {/* Trip Description */}
            <View style={styles.field}>
              <Text style={styles.label}>Rider Notes / Description (Optional)</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                multiline
                value={description}
                onChangeText={setDescription}
                placeholder="Notes about packing, gear, road observations, or itinerary notes"
                placeholderTextColor="#77809a"
              />
            </View>

            {/* Bottom Create Button */}
            <TouchableOpacity
              style={[styles.primary, loading && { opacity: 0.65 }]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>Create trip with customizations  →</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Calendar Modal */}
      <CalendarPickerModal
        visible={showCalendar}
        onClose={() => setShowCalendar(false)}
        startDate={calendarTarget === 'trip' ? startDate : checkIn}
        endDate={calendarTarget === 'trip' ? endDate : checkOut}
        onSelectRange={handleSelectDates}
        title={calendarTarget === 'trip' ? 'Select Trip Dates' : 'Select Stay Dates'}
      />

      <Text style={styles.footer}>
        Route time is a map-provider estimate for driving, not a motorcycle-specific ETA. You can divide into stages and adjust day-by-day in the trip workspace.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 18, paddingBottom: 44 },
    eyebrow: { color: c.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 8 },
    title: { color: c.text, fontSize: 34, fontWeight: '900', letterSpacing: -1, marginTop: 6 },
    subtitle: { color: c.muted, fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 18 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 17,
      marginBottom: 14,
      gap: 14,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    section: { color: c.text, fontSize: 18, fontWeight: '800' },
    badgeEssential: {
      backgroundColor: c.accentSoft,
      borderColor: c.accent,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeEssentialText: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
    field: { gap: 7 },
    label: { color: c.text, fontSize: 13, fontWeight: '700' },
    dateLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    clearDateText: { color: c.danger, fontSize: 11, fontWeight: '700' },
    datePickerCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.input,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 13,
      gap: 10,
    },
    datePickerCardActive: {
      borderColor: c.accent,
      backgroundColor: c.accentSoft,
    },
    calendarIcon: { fontSize: 20 },
    datePickerTextWrapper: { flex: 1 },
    datePickerTitle: { color: c.text, fontSize: 13, fontWeight: '800' },
    datePickerSubtitle: { color: c.muted, fontSize: 11, marginTop: 2 },
    datePickerArrow: { color: c.accent, fontSize: 18, fontWeight: '900' },
    presetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    presetPill: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    presetPillText: { color: c.text, fontSize: 11, fontWeight: '700' },
    routePreviewPill: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    routePreviewText: { color: c.green, fontSize: 12, fontWeight: '700' },
    input: {
      backgroundColor: c.input,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 7,
      paddingHorizontal: 13,
      paddingVertical: 12,
      color: c.text,
      fontSize: 14,
    },
    multiline: { minHeight: 76, textAlignVertical: 'top' },
    helper: { color: c.muted, fontSize: 12, lineHeight: 18 },
    helperCentered: { color: c.subtle, fontSize: 11, lineHeight: 16, textAlign: 'center' },
    selected: { color: c.green, fontSize: 11, marginTop: 5 },
    currentLocationButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderWidth: 1,
      borderColor: c.accent,
      backgroundColor: c.accentSoft,
      borderRadius: 7,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginTop: 2,
    },
    currentLocationIcon: { color: c.accent, fontSize: 16, fontWeight: '800' },
    currentLocationText: { color: c.accent, fontSize: 12, fontWeight: '700' },
    error: { color: c.danger, fontSize: 11, lineHeight: 16, marginTop: 4 },
    help: { color: c.accent, fontSize: 11, marginTop: 5 },
    suggestions: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      overflow: 'hidden',
      marginTop: 2,
    },
    suggestion: { padding: 11, borderBottomWidth: 1, borderBottomColor: c.border },
    suggestionTitle: { color: c.text, fontSize: 13, fontWeight: '700' },
    suggestionAddress: { color: '#aab6ca', fontSize: 11, marginTop: 3 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    chip: { borderRadius: 20, borderWidth: 1, borderColor: c.border, paddingHorizontal: 11, paddingVertical: 8 },
    chipActive: { backgroundColor: c.accentSoft, borderColor: c.accent },
    chipText: { color: c.muted, fontSize: 11, textTransform: 'capitalize' },
    chipTextActive: { color: c.accent, fontWeight: '800' },
    customizationHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    customizationHeaderLeft: { flex: 1, gap: 2 },
    toggleBadge: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginLeft: 8,
    },
    toggleBadgeText: { color: c.accent, fontSize: 11, fontWeight: '800' },
    customizationBody: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 14, gap: 14 },
    stopBlock: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, gap: 8 },
    stopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    remove: { color: c.danger, fontSize: 12, fontWeight: '700' },
    addButton: {
      borderWidth: 1,
      borderColor: c.border,
      borderStyle: 'dashed',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    addText: { color: c.accent, fontSize: 12, fontWeight: '700' },
    stayDateButton: {
      backgroundColor: c.input,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 7,
      padding: 11,
      marginTop: 4,
    },
    stayDateText: { color: c.text, fontSize: 12, fontWeight: '700' },
    primary: { backgroundColor: c.accent, borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 3 },
    primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    footer: { color: c.subtle, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 12 },
  });
