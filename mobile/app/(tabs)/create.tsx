import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  canCreateMoreTrips, PLAN_LIMITS, PAYMENT_CONFIG,
  fetchDrivingRoute, routeCoordinates,
} from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import * as Location from 'expo-location';
import { useRideTheme, RidePalette } from '../../src/theme';
import CalendarPickerModal, { formatDateNice, formatYMD } from '../../src/components/CalendarPickerModal';

type Place = { id: string; name: string; address: string; longitude: number; latitude: number };
type WaypointKind = 'stop' | 'fuel' | 'food' | 'rest' | 'sightseeing' | 'repair';
const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
const DRAFT_STORAGE_KEY = '@ridentrack_trip_draft';

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
  const requestId = useRef(0);
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
  // Stepper state: 1: Basics, 2: Route, 3: Stops, 4: Lodging, 5: Invite, 6: Review
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [draftSavedTime, setDraftSavedTime] = useState<string>('Draft Saved');

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

  // Calibration Toggles
  const [preferTwisties, setPreferTwisties] = useState(true);
  const [avoidTolls, setAvoidTolls] = useState(true);

  // Overnight stay
  const [stay, setStay] = useState<Place | null>(null);
  const [stayType, setStayType] = useState<'hotel' | 'homestay' | 'hostel' | 'camping' | 'guesthouse'>('hotel');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [stayPrice, setStayPrice] = useState('');

  const [loading, setLoading] = useState(false);
  const { user, profile } = useAuth();
  const tier = profile?.subscription_tier ?? 'free';
  const routePointLimit = PLAN_LIMITS[tier].maxWaypointsPerTrip;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autosavePromiseRef = useRef<Promise<any> | null>(null);
  const isDraftClearedRef = useRef(false);
  const isCreatingRef = useRef(false);

  // Load autosaved draft scoped to active user on mount / account switch
  useEffect(() => {
    if (!user?.id) {
      // Clear form when logged out
      setName('');
      setOrigin(null);
      setDestination(null);
      setStartDate('');
      setEndDate('');
      setStops([]);
      setStay(null);
      return;
    }

    let cancelled = false;
    const scopedKey = `${DRAFT_STORAGE_KEY}_${user.id}`;
    AsyncStorage.getItem(scopedKey)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const draft = JSON.parse(raw);
          if (draft.name) setName(draft.name);
          if (draft.origin) setOrigin(draft.origin);
          if (draft.destination) setDestination(draft.destination);
          if (draft.startDate) setStartDate(draft.startDate);
          if (draft.endDate) setEndDate(draft.endDate);
          if (draft.tripType) setTripType(draft.tripType);
          if (draft.description) setDescription(draft.description);
          if (draft.meetup) setMeetup(draft.meetup);
          if (Array.isArray(draft.stops)) setStops(draft.stops);
          if (draft.stay) setStay(draft.stay);
          if (draft.stayType) setStayType(draft.stayType);
          if (draft.checkIn) setCheckIn(draft.checkIn);
          if (draft.checkOut) setCheckOut(draft.checkOut);
          if (draft.stayPrice) setStayPrice(draft.stayPrice);
        } catch {
          /* Ignore corrupt draft */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Autosave draft to scoped AsyncStorage (debounced)
  useEffect(() => {
    if (!user?.id || isDraftClearedRef.current) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    const scopedKey = `${DRAFT_STORAGE_KEY}_${user.id}`;
    autosaveTimerRef.current = setTimeout(() => {
      const draftData = {
        name,
        origin,
        destination,
        startDate,
        endDate,
        tripType,
        description,
        meetup,
        stops,
        stay,
        stayType,
        checkIn,
        checkOut,
        stayPrice,
        savedAt: Date.now(),
      };
      autosavePromiseRef.current = AsyncStorage.setItem(scopedKey, JSON.stringify(draftData))
        .then(() => setDraftSavedTime('Draft Saved'))
        .catch(() => {});
    }, 1000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [user?.id, name, origin, destination, startDate, endDate, tripType, description, meetup, stops, stay, stayType, checkIn, checkOut, stayPrice]);

  // Route preview fetcher (includes origin, meetup, intermediate stops, and destination)
  useEffect(() => {
    setPreviewRoute(null);
    if (!TOKEN || !origin || !destination) {
      return;
    }
    const controller = new AbortController();
    const orderedPreviewPoints = [
      origin,
      ...(meetup ? [meetup] : []),
      ...stops.filter((s) => s.place).map((s) => s.place!),
      destination,
    ];
    fetchDrivingRoute(routeCoordinates(orderedPreviewPoints), {
      token: TOKEN, preview: true, avoidTolls, signal: controller.signal,
    })
      .then((totals) => {
        if (!controller.signal.aborted) setPreviewRoute(totals);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [origin, destination, meetup, stops, avoidTolls]);

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

  const pointCount = 2 + stops.length + (meetup ? 1 : 0);

  function addStop(kind: WaypointKind = 'stop') {
    if (pointCount >= routePointLimit) {
      Alert.alert('Route point limit', `Your ${tier === 'free' ? 'Free' : 'Pro Tourer'} plan supports up to ${routePointLimit} route points, including origin and destination.`);
      return;
    }
    setStops((current) => [...current, { key: String(Date.now()) + Math.random(), place: null, kind }]);
  }

  function updateStop(key: string, place: Place | null) {
    setStops((current) => current.map((stop) => (stop.key === key ? { ...stop, place } : stop)));
  }

  async function handleCreate() {
    if (isCreatingRef.current) return;
    if (!name.trim() || !origin || !destination) {
      Alert.alert('Missing trip details', 'Please add a trip name, a starting point (origin) and a final destination.');
      return;
    }
    if (!user) return;
    if (pointCount > routePointLimit) {
      Alert.alert('Route point limit', `Your ${tier === 'free' ? 'Free' : 'Pro Tourer'} plan supports up to ${routePointLimit} route points, including origin and destination.`);
      return;
    }
    if (startDate && endDate && days.length === 0) {
      Alert.alert('Check trip dates', 'Please ensure the end date is on or after the start date.');
      return;
    }
    if (stops.some((s) => !s.place)) {
      Alert.alert('Incomplete stop', 'Please select a location for every added stop or remove the empty stop.');
      return;
    }
    isCreatingRef.current = true;
    setLoading(true);
    try {
      // Check free tier limits
      const { count, error: countError } = await supabase
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', user.id)
        .in('status', ['planned', 'active']);
      if (!countError && typeof count === 'number' && !canCreateMoreTrips(count, tier)) {
        Alert.alert(
          tier === 'free' ? '⭐️ RideNTrack Free Plan Limit' : 'RideNTrack Plan Limit',
          tier === 'free'
            ? `The Free plan includes up to ${PLAN_LIMITS.free.maxActiveTrips} active trips. Upgrade to Pro Tourer (₹${PAYMENT_CONFIG.monthlyPlanPriceInr}/month) for more trips and route points.`
            : `Your Pro Tourer plan has reached its ${PLAN_LIMITS.pro_tourer.maxActiveTrips}-trip active limit. Complete or archive an existing trip first.`,
          [
            { text: 'Manage Trips', onPress: () => router.push('/(tabs)') },
            ...(tier === 'free' ? [{
              text: 'Upgrade to Pro',
              onPress: () => Alert.alert('Upgrade unavailable', 'Payments are not configured in this build. Your plan limits are enforced on the server.'),
            }] : []),
          ]
        );
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
          const result = await fetchDrivingRoute(routeCoordinates(ordered.map(p => p.place)), { token: TOKEN, avoidTolls });
          routeGeometry = { type: 'Feature', geometry: result.geometry, properties: {} };
          distance = result.distance;
          duration = result.duration;
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

      // Stop autosave scheduling and wait for in-flight write before clearing draft
      isDraftClearedRef.current = true;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (autosavePromiseRef.current) {
        await autosavePromiseRef.current.catch(() => {});
      }
      const scopedKey = `${DRAFT_STORAGE_KEY}_${user.id}`;
      await AsyncStorage.removeItem(scopedKey).catch(() => {});
      await AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => {});

      Alert.alert('Trip created', 'Your trip plan is ready. You can invite riders, divide into stages, and customize routes.', [
        { text: 'Open trip', onPress: () => router.push('/trip/' + rideId) },
      ]);
    } catch (error: any) {
      isDraftClearedRef.current = false;
      Alert.alert('Could not create trip', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
      isCreatingRef.current = false;
    }
  }

  const stepsList = [
    { num: 1, label: 'Basics' },
    { num: 2, label: 'Route' },
    { num: 3, label: 'Stops' },
    { num: 4, label: 'Lodging' },
    { num: 5, label: 'Invite' },
    { num: 6, label: 'Review' },
  ];

  const isStepCompleted = (stepNum: number) => {
    switch (stepNum) {
      case 1:
        return !!name.trim();
      case 2:
        return !!origin && !!destination;
      case 3:
        return currentStep > 3 && (stops.length === 0 || stops.every((s) => !!s.place));
      case 4:
        return currentStep > 4;
      case 5:
        return currentStep > 5;
      case 6:
        return !!name.trim() && !!origin && !!destination;
      default:
        return false;
    }
  };

  const isCurrentStepEmpty = (step: number) => {
    switch (step) {
      case 3:
        return stops.length === 0 && !meetup;
      case 4:
        return !stay;
      case 5:
        return !description.trim();
      default:
        return false;
    }
  };

  function handleNextStep() {
    if (currentStep === 1) {
      if (!name.trim()) {
        Alert.alert('Trip name required', 'Please enter a name for your expedition to continue.');
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!origin || !destination) {
        Alert.alert('Route required', 'Please select both a starting point (origin) and final destination.');
        return;
      }
      setCurrentStep(3);
    } else if (currentStep === 3) {
      if (stops.some((s) => !s.place)) {
        Alert.alert('Incomplete stop', 'Please select a location for every added stop or remove the empty stop.');
        return;
      }
      setCurrentStep(4);
    } else if (currentStep === 4) {
      setCurrentStep(5);
    } else if (currentStep === 5) {
      setCurrentStep(6);
    }
  }

  function handleSkipStep() {
    if (currentStep >= 3 && currentStep <= 5) {
      setCurrentStep(currentStep + 1);
    }
  }

  function handleTapStep(targetStep: number) {
    if (targetStep === currentStep) return;
    if (targetStep > 1 && !name.trim()) {
      Alert.alert('Trip name required', 'Please enter a trip name before moving to other steps.');
      return;
    }
    if (targetStep > 2 && (!origin || !destination)) {
      Alert.alert('Route required', 'Please select both your starting point and destination first.');
      return;
    }
    setCurrentStep(targetStep);
  }

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const safeHeaderTop = Math.max(topInset, Platform.OS === 'android' ? 48 : 44) + 18;

  return (
    <View style={styles.screenWrapper}>
      {/* Top Header Bar matching trip_planner_route_waypoints.html */}
      <View style={[styles.stepperHeader, { paddingTop: safeHeaderTop }]}>
        <View style={styles.topHeaderNavRow}>
          <View style={styles.topHeaderLeft}>
            <TouchableOpacity
              style={styles.cancelRoundBtn}
              onPress={() => router.back()}
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelIcon}>✕</Text>
            </TouchableOpacity>
            <View style={styles.draftStatusRow}>
              <Text style={styles.cloudDoneIcon}>☁️</Text>
              <Text style={styles.draftStatusText}>{draftSavedTime}</Text>
            </View>
          </View>

          <Text style={styles.expeditionHeaderTitle}>Plan Expedition</Text>

          <View style={styles.riderAvatarMini}>
            <Text style={styles.riderAvatarText}>
              {profile?.display_name ? profile.display_name.charAt(0).toUpperCase() : 'R'}
            </Text>
          </View>
        </View>

        {/* Stepper Progress Bar (Step 1 to 6) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stepperScrollTrack}
        >
          {stepsList.map((step, idx) => {
            const isCompleted = isStepCompleted(step.num);
            const isCurrent = step.num === currentStep;
            return (
              <React.Fragment key={step.num}>
                <TouchableOpacity
                  style={styles.stepChip}
                  onPress={() => handleTapStep(step.num)}
                >
                  <View
                    style={[
                      styles.stepCircle,
                      isCompleted && styles.stepCircleCompleted,
                      isCurrent && styles.stepCircleCurrent,
                    ]}
                  >
                    <Text
                      style={[
                        styles.stepCircleText,
                        isCompleted && styles.stepCircleTextCompleted,
                        isCurrent && styles.stepCircleTextCurrent,
                      ]}
                    >
                      {isCompleted ? '✓' : step.num}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      isCompleted && styles.stepLabelCompleted,
                      isCurrent && styles.stepLabelCurrent,
                    ]}
                  >
                    {step.label}
                  </Text>
                </TouchableOpacity>
                {idx < stepsList.length - 1 && (
                  <View
                    style={[
                      styles.stepDivider,
                      isCompleted && styles.stepDividerCompleted,
                    ]}
                  />
                )}
              </React.Fragment>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 90, 110) }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Step Kicker Sub-header */}
        <View style={styles.stepInfoRow}>
          <View style={styles.stepKickerBadge}>
            <View style={styles.stepKickerDot} />
            <Text style={styles.stepKickerText}>
              Step {currentStep} of 6: {stepsList[currentStep - 1]?.label || 'Basics'} {currentStep >= 3 && currentStep <= 5 ? '(Optional)' : ''}
            </Text>
          </View>
          <View style={styles.telemetryLiveBadge}>
            <Text style={styles.telemetryLiveText}>
              {currentStep <= 2 ? 'Required' : currentStep === 6 ? 'Final Review' : isCurrentStepEmpty(currentStep) ? 'Skippable' : 'Configured'}
            </Text>
          </View>
        </View>

        {/* STEP 1: BASICS */}
        {currentStep === 1 && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.section}>Quick Trip Setup</Text>
              <View style={styles.badgeEssential}>
                <Text style={styles.badgeEssentialText}>STEP 1: ESSENTIALS</Text>
              </View>
            </View>
            <Text style={styles.stepDescription}>
              Give your journey a name, pick your touring dates, and choose your riding style.
            </Text>

            {/* Trip Name */}
            <View style={styles.field}>
              <Text style={styles.label}>Trip Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Spiti Valley High Passes"
                placeholderTextColor="#77809a"
              />
            </View>

            {/* Ride Dates / Calendar Picker */}
            <View style={styles.field}>
              <View style={styles.dateLabelRow}>
                <Text style={styles.label}>Ride Dates</Text>
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

            {/* Trip Category */}
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
          </View>
        )}

        {/* STEP 2: ROUTE */}
        {currentStep === 2 && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.section}>Route & Navigation</Text>
              <View style={styles.badgeEssential}>
                <Text style={styles.badgeEssentialText}>STEP 2: ROUTE</Text>
              </View>
            </View>
            <Text style={styles.stepDescription}>
              Select where your expedition starts and your destination summit or town.
            </Text>

            {/* Origin */}
            <LocationSearch
              label="Starting Point (Origin)"
              placeholder="Search starting location or town"
              value={origin}
              onChange={setOrigin}
              showCurrentLocation
            />

            {/* Destination */}
            <LocationSearch
              label="Final Destination"
              placeholder="Search destination or summit"
              value={destination}
              onChange={setDestination}
            />

            {/* Route Preview Badge if available */}
            {previewRoute ? (
              <View style={styles.routePreviewPill}>
                <Text style={styles.routePreviewText}>
                  🏍️ Estimated leg: {(previewRoute.distance / 1000).toFixed(0)} km · ~{Math.round(previewRoute.duration / 3600)} hrs driving
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* STEP 3: STOPS (OPTIONAL) */}
        {currentStep === 3 && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.section}>Customize Trip: Stops</Text>
              <View style={styles.badgeOptional}>
                <Text style={styles.badgeOptionalText}>STEP 3: OPTIONAL</Text>
              </View>
            </View>
            <Text style={styles.stepDescription}>
              Add waypoints along the journey (fuel stations, food, rest stops, repairs) or an optional meetup location.
            </Text>

            {/* Intermediate Stops */}
            <View style={styles.field}>
              <Text style={styles.label}>Intermediate Route Stops ({stops.length})</Text>
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
              onChange={place => {
                if (place && !meetup && pointCount >= routePointLimit) {
                  Alert.alert('Route point limit', `Your ${tier === 'free' ? 'Free' : 'Pro Tourer'} plan supports up to ${routePointLimit} route points, including origin and destination.`);
                } else {
                  setMeetup(place);
                }
              }}
            />
          </View>
        )}

        {/* STEP 4: LODGING (OPTIONAL) */}
        {currentStep === 4 && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.section}>Overnight Accommodation</Text>
              <View style={styles.badgeOptional}>
                <Text style={styles.badgeOptionalText}>STEP 4: OPTIONAL</Text>
              </View>
            </View>
            <Text style={styles.stepDescription}>
              Planning a multi-day expedition? Record your hotel, homestay, or campsite. You can skip this for day rides.
            </Text>

            {/* Overnight Stay */}
            <View style={styles.field}>
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
          </View>
        )}

        {/* STEP 5: NOTES & INVITE (OPTIONAL) */}
        {currentStep === 5 && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.section}>Rider Notes & Calibration</Text>
              <View style={styles.badgeOptional}>
                <Text style={styles.badgeOptionalText}>STEP 5: OPTIONAL</Text>
              </View>
            </View>
            <Text style={styles.stepDescription}>
              Add gear advisories and route observations for your riding pack, and configure pass routing.
            </Text>

            {/* Trip Description */}
            <View style={styles.field}>
              <Text style={styles.label}>Rider Notes / Briefing (Optional)</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                multiline
                value={description}
                onChangeText={setDescription}
                placeholder="Notes about packing, gear, road observations, or itinerary notes"
                placeholderTextColor="#77809a"
              />
            </View>

            {/* Pass Routing Calibration Toggles */}
            <View style={styles.calibrationCard}>
              <Text style={styles.calibrationHeader}>PASS ROUTING CALIBRATION</Text>
              <View style={styles.calibrationRow}>
                <View style={styles.calibrationLabelCol}>
                  <Text style={styles.calibrationTitle}>Prefer Technical Twisties & Passes</Text>
                  <Text style={styles.calibrationSub}>Technical twisties routing (Provider unsupported - standard driving active)</Text>
                </View>
                <Switch
                  value={preferTwisties}
                  disabled={true}
                  onValueChange={setPreferTwisties}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.calibrationDivider} />
              <View style={styles.calibrationRow}>
                <View style={styles.calibrationLabelCol}>
                  <Text style={styles.calibrationTitle}>Avoid Commercial Tollways</Text>
                  <Text style={styles.calibrationSub}>Prioritize high mountain bypass lines</Text>
                </View>
                <Switch
                  value={avoidTolls}
                  onValueChange={setAvoidTolls}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.calibrationDivider} />
              <View style={styles.offlineCacheRow}>
                <View style={styles.offlineCacheLeft}>
                  <Text style={styles.offlineCacheIcon}>💾</Text>
                  <View>
                    <Text style={styles.offlineCacheTitle}>Offline Vector & Radar Pack</Text>
                    <Text style={styles.offlineCacheSub}>Available for download (340 MB)</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={() => Alert.alert('Offline Pack', 'Offline vector pack download is not supported in this build. Dynamic online routing will be used.')}
                >
                  <Text style={styles.syncBtnText}>SYNC</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* STEP 6: REVIEW & LAUNCH */}
        {currentStep === 6 && (
          <View style={{ gap: 14 }}>
            {/* Telemetry HUD Summary Grid */}
            <View style={styles.telemetrySummaryGrid}>
              <View style={styles.telemetrySummaryCard}>
                <Text style={styles.telemetrySummaryLabel}>TOTAL DISTANCE</Text>
                <View style={styles.telemetryValueRow}>
                  <Text style={styles.telemetryValueNum}>
                    {previewRoute ? Math.round(previewRoute.distance / 1000) : '—'}
                  </Text>
                  <Text style={styles.telemetryValueUnit}>{previewRoute ? 'KM' : ''}</Text>
                </View>
                <View style={styles.saddleTimeRow}>
                  <Text style={styles.saddleTimeText}>
                    ⏱️ {previewRoute ? `${Math.round(previewRoute.duration / 3600)}h Est. Saddle` : '— Est. Saddle'}
                  </Text>
                </View>
              </View>

              <View style={styles.telemetrySummaryCard}>
                <View style={styles.apexTopRow}>
                  <Text style={styles.telemetrySummaryLabel}>MAX APEX</Text>
                  <View style={styles.reconBadge}>
                    <Text style={styles.reconBadgeText}>Advisory</Text>
                  </View>
                </View>
                <View style={styles.telemetryValueRow}>
                  <Text style={styles.telemetryValueNum}>4,590</Text>
                  <Text style={styles.telemetryValueUnitMuted}>M</Text>
                </View>
                <View style={styles.saddleTimeRow}>
                  <Text style={styles.apexPassText} numberOfLines={1}>
                    🏔️ Sample Topography
                  </Text>
                </View>
              </View>
            </View>

            {/* Ascent Profile Chart Card */}
            <View style={styles.ascentProfileCard}>
              <View style={styles.ascentHeader}>
                <View style={styles.ascentTitleRow}>
                  <Text style={styles.ascentChartIcon}>📈</Text>
                  <Text style={styles.ascentTitleText}>Ascent Profile</Text>
                </View>
                <View style={styles.ascentNetClimbBadge}>
                  <Text style={styles.ascentNetClimbText}>+2,314m Net Climb (Est.)</Text>
                </View>
              </View>
              {/* Topographic Sparkline Visual */}
              <View style={styles.sparklineBox}>
                <View style={styles.sparklinePeakPill}>
                  <Text style={styles.sparklinePeakText}>🏔️ 4,590m Pass</Text>
                </View>
                <View style={styles.sparklineGuides}>
                  <View style={styles.sparklineGuideLine} />
                  <View style={styles.sparklineGuideLine} />
                </View>
                <View style={styles.sparklineCurveTrack}>
                  <View style={styles.sparklineRidge} />
                </View>
                <View style={styles.sparklineFooters}>
                  <Text style={styles.sparklineElevationLabel}>{origin ? origin.name : 'Origin'}</Text>
                  <Text style={styles.sparklineElevationLabel}>{destination ? destination.name : 'Destination'}</Text>
                </View>
              </View>
              <View style={styles.cautionNotice}>
                <Text style={styles.cautionIcon}>⚠️</Text>
                <Text style={styles.cautionText}>
                  <Text style={{ fontWeight: '800', color: theme.text }}>Advisory:</Text> High-altitude mountain passes feature steep gradients and variable road surfaces.
                </Text>
              </View>
            </View>

            {/* Expedition Summary Card */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.section}>Expedition Overview</Text>
                <View style={styles.badgeEssential}>
                  <Text style={styles.badgeEssentialText}>{tripType.toUpperCase()}</Text>
                </View>
              </View>

              <Text style={styles.reviewTripTitle}>{name}</Text>

              <View style={styles.reviewRouteRow}>
                <Text style={styles.reviewRoutePoint}>📍 Origin: {origin?.name || origin?.address || 'Origin'}</Text>
                <Text style={styles.reviewRouteArrow}>↓</Text>
                {meetup ? (
                  <>
                    <Text style={styles.reviewWaypoint}>🚩 Meetup: {meetup.name || meetup.address}</Text>
                    <Text style={styles.reviewRouteArrow}>↓</Text>
                  </>
                ) : null}
                {stops.filter(s => s.place).map((s, idx) => (
                  <React.Fragment key={s.key}>
                    <Text style={styles.reviewWaypoint}>
                      {s.kind === 'fuel' ? '⛽' : s.kind === 'food' ? '🍽️' : s.kind === 'repair' ? '🔧' : '🛑'} Stop {idx + 1}: {s.place!.name}
                    </Text>
                    <Text style={styles.reviewRouteArrow}>↓</Text>
                  </React.Fragment>
                ))}
                <Text style={styles.reviewRoutePoint}>🏁 Destination: {destination?.name || destination?.address || 'Destination'}</Text>
              </View>

              <View style={styles.reviewMetaGrid}>
                <View style={styles.reviewMetaItem}>
                  <Text style={styles.reviewMetaLabel}>DATES</Text>
                  <Text style={styles.reviewMetaValue}>
                    {startDate ? formatDateNice(startDate) : 'Not scheduled'}
                    {endDate && endDate !== startDate ? ` → ${formatDateNice(endDate)}` : ''}
                  </Text>
                </View>
                <View style={styles.reviewMetaItem}>
                  <Text style={styles.reviewMetaLabel}>STAY</Text>
                  <Text style={styles.reviewMetaValue}>{stay ? stay.name : 'No overnight stay'}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

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

      {/* Sticky Bottom Stepper Footer */}
      <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom + 10, 16) }]}>
        {/* Option 1: Back Button */}
        <TouchableOpacity
          style={styles.footerBackBtn}
          onPress={() => {
            if (currentStep > 1) {
              setCurrentStep(currentStep - 1);
            } else {
              router.back();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Back step"
        >
          <Text style={styles.footerBackText}>← Back</Text>
        </TouchableOpacity>

        {/* Option 2: Step-Specific Action (Skip vs Next vs Create) */}
        {currentStep === 6 ? (
          <TouchableOpacity
            style={[styles.footerContinueBtn, loading && { opacity: 0.6 }]}
            disabled={loading}
            onPress={() => void handleCreate()}
            accessibilityRole="button"
            accessibilityLabel="Create trip plan"
          >
            {loading ? (
              <ActivityIndicator color="#000000" />
            ) : (
              <>
                <Text style={styles.footerContinueText}>Create trip plan</Text>
                <Text style={styles.footerContinueArrow}>→</Text>
              </>
            )}
          </TouchableOpacity>
        ) : currentStep === 1 ? (
          <TouchableOpacity
            style={styles.footerContinueBtn}
            onPress={handleNextStep}
            accessibilityRole="button"
            accessibilityLabel="Continue to Route"
          >
            <Text style={styles.footerContinueText}>Next</Text>
            <Text style={styles.footerContinueArrow}>→</Text>
          </TouchableOpacity>
        ) : currentStep === 2 ? (
          <TouchableOpacity
            style={styles.footerContinueBtn}
            onPress={handleNextStep}
            accessibilityRole="button"
            accessibilityLabel="Continue to Stops"
          >
            <Text style={styles.footerContinueText}>Next</Text>
            <Text style={styles.footerContinueArrow}>→</Text>
          </TouchableOpacity>
        ) : isCurrentStepEmpty(currentStep) ? (
          <TouchableOpacity
            style={styles.footerSkipBtn}
            onPress={handleSkipStep}
            accessibilityRole="button"
            accessibilityLabel={`Skip ${stepsList[currentStep - 1]?.label}`}
          >
            <Text style={styles.footerSkipText}>Skip</Text>
            <Text style={styles.footerSkipArrow}>→</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.footerContinueBtn}
            onPress={handleNextStep}
            accessibilityRole="button"
            accessibilityLabel={`Continue to ${stepsList[currentStep]?.label || 'Next'}`}
          >
            <Text style={styles.footerContinueText}>Next</Text>
            <Text style={styles.footerContinueArrow}>→</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    screenWrapper: {
      flex: 1,
      backgroundColor: c.background,
    },
    stepperHeader: {
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      zIndex: 10,
    },
    topHeaderNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    topHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    cancelRoundBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelIcon: {
      color: c.text,
      fontSize: 16,
      fontWeight: '700',
    },
    draftStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    cloudDoneIcon: {
      fontSize: 14,
    },
    draftStatusText: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    expeditionHeaderTitle: {
      color: c.text,
      fontSize: 14,
      fontWeight: '800',
      letterSpacing: 0.5,
      textAlign: 'center',
      flex: 1,
    },
    riderAvatarMini: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    riderAvatarText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '800',
    },
    stepperScrollTrack: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    stepChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    stepCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepCircleCompleted: {
      backgroundColor: c.green,
    },
    stepCircleCurrent: {
      backgroundColor: c.accent,
    },
    stepCircleText: {
      fontSize: 11,
      fontWeight: '800',
      color: c.textMuted,
    },
    stepCircleTextCompleted: {
      color: '#FFFFFF',
    },
    stepCircleTextCurrent: {
      color: '#000000',
    },
    stepLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    stepLabelCompleted: {
      color: c.green,
    },
    stepLabelCurrent: {
      color: c.accent,
      fontWeight: '800',
    },
    stepDivider: {
      width: 14,
      height: 2,
      borderRadius: 1,
      backgroundColor: c.border,
    },
    stepDividerCompleted: {
      backgroundColor: c.green,
    },
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      padding: 16,
      gap: 14,
    },
    stepInfoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    stepKickerBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    stepKickerDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.accent,
    },
    stepKickerText: {
      fontSize: 11,
      fontWeight: '800',
      color: c.accent,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    telemetryLiveBadge: {
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 12,
    },
    telemetryLiveText: {
      color: c.textMuted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    telemetrySummaryGrid: {
      flexDirection: 'row',
      gap: 10,
    },
    telemetrySummaryCard: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      padding: 12,
      justifyContent: 'space-between',
    },
    telemetrySummaryLabel: {
      fontSize: 10,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 0.8,
    },
    telemetryValueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 4,
      marginTop: 2,
    },
    telemetryValueNum: {
      fontSize: 30,
      fontWeight: '900',
      color: c.text,
      letterSpacing: -1,
    },
    telemetryValueUnit: {
      fontSize: 12,
      fontWeight: '800',
      color: c.accent,
    },
    telemetryValueUnitMuted: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textMuted,
    },
    saddleTimeRow: {
      marginTop: 4,
    },
    saddleTimeText: {
      fontSize: 11,
      color: c.green,
      fontWeight: '600',
    },
    apexTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    reconBadge: {
      backgroundColor: 'rgba(255, 122, 26, 0.15)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    reconBadgeText: {
      color: c.accent,
      fontSize: 9,
      fontWeight: '800',
    },
    apexPassText: {
      fontSize: 11,
      color: c.textMuted,
      fontWeight: '600',
    },
    ascentProfileCard: {
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      gap: 10,
    },
    ascentHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    ascentTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    ascentChartIcon: {
      fontSize: 16,
    },
    ascentTitleText: {
      fontSize: 14,
      fontWeight: '800',
      color: c.text,
    },
    ascentNetClimbBadge: {
      backgroundColor: 'rgba(255, 122, 26, 0.15)',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    ascentNetClimbText: {
      fontSize: 10,
      fontWeight: '800',
      color: c.accent,
    },
    sparklineBox: {
      height: 70,
      backgroundColor: c.surfaceRaised,
      borderRadius: 10,
      position: 'relative',
      overflow: 'hidden',
      justifyContent: 'flex-end',
      padding: 8,
    },
    sparklinePeakPill: {
      position: 'absolute',
      top: 6,
      right: 12,
      backgroundColor: 'rgba(255, 122, 26, 0.2)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    sparklinePeakText: {
      fontSize: 9,
      fontWeight: '800',
      color: c.accent,
    },
    sparklineGuides: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 15,
      bottom: 15,
      justifyContent: 'space-between',
    },
    sparklineGuideLine: {
      height: 1,
      backgroundColor: c.border,
      opacity: 0.5,
    },
    sparklineCurveTrack: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 20,
      height: 20,
    },
    sparklineRidge: {
      height: 3,
      backgroundColor: c.accent,
      borderRadius: 2,
    },
    sparklineFooters: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    sparklineElevationLabel: {
      fontSize: 10,
      color: c.textMuted,
      fontWeight: '600',
    },
    cautionNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceRaised,
      padding: 10,
      borderRadius: 8,
      gap: 8,
    },
    cautionIcon: {
      fontSize: 14,
    },
    cautionText: {
      fontSize: 11,
      color: c.textMuted,
      lineHeight: 16,
      flex: 1,
    },
    calibrationCard: {
      backgroundColor: c.surfaceRaised,
      borderRadius: 14,
      padding: 14,
      gap: 10,
    },
    calibrationHeader: {
      fontSize: 10,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1,
    },
    calibrationRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    calibrationLabelCol: {
      flex: 1,
      paddingRight: 10,
    },
    calibrationTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
    },
    calibrationSub: {
      fontSize: 11,
      color: c.textMuted,
      marginTop: 2,
    },
    calibrationDivider: {
      height: 1,
      backgroundColor: c.border,
    },
    offlineCacheRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 4,
    },
    offlineCacheLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    offlineCacheIcon: {
      fontSize: 18,
    },
    offlineCacheTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: c.text,
    },
    offlineCacheSub: {
      fontSize: 10,
      color: c.green,
      marginTop: 2,
    },
    syncBtn: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    syncBtnText: {
      fontSize: 10,
      fontWeight: '800',
      color: c.accent,
      letterSpacing: 0.8,
    },
    stickyFooter: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingHorizontal: 16,
      paddingTop: 12,
      flexDirection: 'row',
      gap: 10,
    },
    footerBackBtn: {
      height: 52,
      minWidth: 90,
      backgroundColor: c.surfaceRaised,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    footerBackText: {
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
    },
    footerContinueBtn: {
      flex: 1,
      height: 52,
      backgroundColor: c.accent,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      shadowColor: c.accent,
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 3,
    },
    footerContinueText: {
      fontSize: 14,
      fontWeight: '900',
      color: '#000000',
      letterSpacing: 0.5,
    },
    footerContinueArrow: {
      fontSize: 16,
      fontWeight: '800',
      color: '#000000',
    },
    footerSkipBtn: {
      flex: 1,
      height: 52,
      backgroundColor: c.surfaceRaised,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    footerSkipText: {
      fontSize: 14,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 0.3,
    },
    footerSkipArrow: {
      fontSize: 16,
      fontWeight: '800',
      color: c.textMuted,
    },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
      gap: 14,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    section: { color: c.text, fontSize: 17, fontWeight: '800' },
    badgeEssential: {
      backgroundColor: 'rgba(255, 122, 26, 0.15)',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeEssentialText: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
    badgeOptional: {
      backgroundColor: c.surfaceRaised,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: c.border,
    },
    badgeOptionalText: { color: c.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
    stepDescription: {
      fontSize: 13,
      color: c.textMuted,
      lineHeight: 19,
    },
    reviewTripTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.3,
    },
    reviewRouteRow: {
      gap: 6,
      paddingVertical: 10,
    },
    reviewRoutePoint: {
      fontSize: 14,
      fontWeight: '700',
      color: c.text,
    },
    reviewRouteArrow: {
      fontSize: 13,
      color: c.accent,
      paddingLeft: 8,
    },
    reviewWaypoint: {
      fontSize: 13,
      color: c.textMuted,
      paddingLeft: 8,
    },
    reviewMetaGrid: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    reviewMetaItem: {
      flex: 1,
      gap: 3,
    },
    reviewMetaLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.8,
    },
    reviewMetaValue: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
    },
    field: { gap: 6 },
    label: { color: c.text, fontSize: 13, fontWeight: '700' },
    dateLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    clearDateText: { color: c.danger, fontSize: 11, fontWeight: '700' },
    datePickerCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 13,
      gap: 10,
    },
    datePickerCardActive: {
      borderColor: c.accent,
      backgroundColor: 'rgba(255, 122, 26, 0.1)',
    },
    calendarIcon: { fontSize: 20 },
    datePickerTextWrapper: { flex: 1 },
    datePickerTitle: { color: c.text, fontSize: 13, fontWeight: '800' },
    datePickerSubtitle: { color: c.textMuted, fontSize: 11, marginTop: 2 },
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
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    routePreviewText: { color: c.green, fontSize: 12, fontWeight: '700' },
    input: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 13,
      paddingVertical: 12,
      color: c.text,
      fontSize: 14,
    },
    multiline: { minHeight: 76, textAlignVertical: 'top' },
    helper: { color: c.textMuted, fontSize: 12, lineHeight: 18 },
    helperCentered: { color: c.textMuted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
    selected: { color: c.green, fontSize: 11, marginTop: 5 },
    currentLocationButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderWidth: 1,
      borderColor: c.accent,
      backgroundColor: 'rgba(255, 122, 26, 0.1)',
      borderRadius: 10,
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
    chipActive: { backgroundColor: 'rgba(255, 122, 26, 0.15)', borderColor: c.accent },
    chipText: { color: c.textMuted, fontSize: 11, textTransform: 'capitalize' },
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
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 11,
      marginTop: 4,
    },
    stayDateText: { color: c.text, fontSize: 12, fontWeight: '700' },
    primary: {
      backgroundColor: c.accent,
      borderRadius: 14,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 3,
      shadowColor: c.accent,
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 3,
    },
    primaryText: { color: '#000000', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
    footer: { color: c.textMuted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 12 },
  });
