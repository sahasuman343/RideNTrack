import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import * as Location from 'expo-location';

type Place = { id: string; name: string; address: string; longitude: number; latitude: number };
type WaypointKind = 'fuel' | 'stop';
const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

function LocationSearch({ label, placeholder, value, onChange, kind = 'place', showCurrentLocation = false }: {
  label: string; placeholder: string; value: Place | null; onChange: (place: Place | null) => void;
  kind?: string; showCurrentLocation?: boolean;
}) {
  const [query, setQuery] = useState(value?.name || '');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchOrigin, setSearchOrigin] = useState<[number, number] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [locationError, setLocationError] = useState('');
  const requestId = React.useRef(0);

  useEffect(() => { if (value) setQuery(value.name); }, [value?.id]);

  useEffect(() => {
    let cancelled = false;
    Location.getLastKnownPositionAsync({ maxAge: 600000, requiredAccuracy: 5000 }).then(position => {
      if (!cancelled && position) setSearchOrigin([position.coords.longitude, position.coords.latitude]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
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
        const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
          encodeURIComponent(trimmed) + '.json?' + params.toString();
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

    return () => { clearTimeout(timer); controller.abort(); };
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
        address: readableAddress || ('Current location (' + latitude.toFixed(5) + ', ' + longitude.toFixed(5) + ')'),
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
        onChangeText={text => {
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
          {locating ? <ActivityIndicator color="#ffad70" size="small" /> : <Text style={styles.currentLocationIcon}>◎</Text>}
          <Text style={styles.currentLocationText}>{locating ? 'Getting current location…' : 'Use current location'}</Text>
        </TouchableOpacity>
      ) : null}
      {loading ? <ActivityIndicator color="#FF8A32" style={{ alignSelf: 'flex-start', marginTop: 8 }} /> : null}
      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map(place => (
            <TouchableOpacity key={place.id} style={styles.suggestion} onPress={() => {
              onChange(place);
              setQuery(place.name);
              setSuggestions([]);
              setSearchError('');
            }}>
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
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tripType, setTripType] = useState<'solo' | 'group' | 'weekend' | 'touring' | 'expedition'>('group');
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [meetup, setMeetup] = useState<Place | null>(null);
  const [stops, setStops] = useState<Array<{ key: string; place: Place | null; kind: WaypointKind }>>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stay, setStay] = useState<Place | null>(null);
  const [stayType, setStayType] = useState<'hotel' | 'homestay' | 'hostel' | 'camping' | 'guesthouse'>('hotel');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [stayPrice, setStayPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  const days = useMemo(() => {
    if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];
    const start = new Date(startDate + 'T12:00:00Z'), end = new Date(endDate + 'T12:00:00Z');
    if (Number.isNaN(start.getTime()) || end < start) return [];
    const result: string[] = [];
    for (let d = new Date(start); d <= end && result.length < 31; d.setUTCDate(d.getUTCDate() + 1)) result.push(d.toISOString().slice(0, 10));
    return result;
  }, [startDate, endDate]);

  function addStop(kind: WaypointKind = 'stop') {
    setStops(current => [...current, { key: String(Date.now()) + Math.random(), place: null, kind }]);
  }
  function updateStop(key: string, place: Place | null) {
    setStops(current => current.map(stop => stop.key === key ? { ...stop, place } : stop));
  }

  async function handleCreate() {
    if (!name.trim() || !origin || !destination) {
      Alert.alert('Missing trip details', 'Add a trip name, a selected origin and a selected destination.');
      return;
    }
    if (!user) return;
    if (startDate && endDate && days.length === 0) {
      Alert.alert('Check trip dates', 'Use YYYY-MM-DD dates and ensure the end date is on or after the start date.');
      return;
    }
    if (stops.some(s => !s.place)) {
      Alert.alert('Incomplete stop', 'Select a location for every added stop or remove the empty stop.');
      return;
    }
    setLoading(true);
    try {
      const ordered = [
        { place: origin, type: 'origin' },
        ...(meetup ? [{ place: meetup, type: 'meetup' }] : []),
        ...stops.map(s => ({ place: s.place!, type: s.kind })),
        { place: destination, type: 'destination' },
      ];
      let routeGeometry: any = null, distance: number | null = null, duration: number | null = null;
      if (TOKEN && ordered.length >= 2) {
        try {
          const coords = ordered.map(p => p.place.longitude + ',' + p.place.latitude).join(';');
          const response = await fetch('https://api.mapbox.com/directions/v5/mapbox/driving/' + coords +
            '?overview=full&geometries=geojson&steps=false&access_token=' + TOKEN);
          if (response.ok) {
            const data = await response.json();
            if (data.routes?.[0]) {
              routeGeometry = { type: 'Feature', geometry: data.routes[0].geometry, properties: {} };
              distance = Math.round(data.routes[0].distance);
              duration = Math.round(data.routes[0].duration);
            }
          }
        } catch {
          routeGeometry = null; distance = null; duration = null;
        }
      }
      const waypointRows = ordered.map((item, index) => ({
        sequence: index, waypoint_type: item.type,
        name: item.place.name, address: item.place.address,
        latitude: item.place.latitude, longitude: item.place.longitude,
        provider_place_id: item.place.id,
      }));
      const dayRows = days.map((date, index) => ({
        day_number: index + 1, trip_date: date, title: 'Day ' + (index + 1),
      }));
      const stayPayload = stay ? {
        name: stay.name, stay_type: stayType, address: stay.address,
        latitude: stay.latitude, longitude: stay.longitude,
        provider_place_id: stay.id, check_in: checkIn || startDate || null,
        check_out: checkOut || endDate || null,
        price_amount: stayPrice ? Number(stayPrice) : null,
        price_currency: 'INR', day_number: 1,
      } : null;

      const { data: rideId, error } = await supabase.rpc('create_trip_plan', {
        p_trip: {
          name: name.trim(), description: description.trim() || null,
          trip_type: tripType, visibility: 'invite_only',
          start_date: startDate || null, end_date: endDate || null,
          origin: origin.address, destination: destination.address,
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

      Alert.alert('Trip created', 'Your trip plan is ready. You can invite riders and start organizing the journey.', [
        { text: 'Open trip', onPress: () => router.push('/trip/' + rideId) },
      ]);
    } catch (error: any) {
      Alert.alert('Could not create trip', error?.message || 'Please try again.');
    } finally { setLoading(false); }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>PLAN YOUR NEXT ADVENTURE</Text>
      <Text style={styles.title}>Create a trip</Text>
      <Text style={styles.subtitle}>Build the journey first. Add your riders and start tracking when it is time to ride.</Text>

      <View style={styles.card}>
        <Text style={styles.section}>Trip details</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Trip name *</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Western Ghats escape" placeholderTextColor="#77809a" />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Trip type</Text>
          <View style={styles.chips}>
            {(['solo','group','weekend','touring','expedition'] as const).map(type => (
              <TouchableOpacity key={type} onPress={() => setTripType(type)} style={[styles.chip, tripType === type && styles.chipActive]}>
                <Text style={[styles.chipText, tripType === type && styles.chipTextActive]}>{type[0].toUpperCase() + type.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, styles.multiline]} multiline value={description} onChangeText={setDescription} placeholder="What is this trip about?" placeholderTextColor="#77809a" />
        </View>
        <View style={styles.row}>
          <View style={styles.half}><Text style={styles.label}>Start date</Text><TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor="#77809a" /></View>
          <View style={styles.half}><Text style={styles.label}>End date</Text><TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor="#77809a" /></View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Route & places</Text>
        <Text style={styles.helper}>Search for real places and select a suggestion. A typed string alone is not saved as a location.</Text>
        <LocationSearch label="Origin *" placeholder="Search starting point" value={origin} onChange={setOrigin} showCurrentLocation />
        <LocationSearch label="Destination *" placeholder="Search final destination" value={destination} onChange={setDestination} />
        <LocationSearch label="Group meetup point" placeholder="Optional: where riders meet" value={meetup} onChange={setMeetup} />
        {stops.map((stop, index) => (
          <View key={stop.key} style={styles.stopBlock}>
            <View style={styles.stopHeader}>
              <Text style={styles.label}>{stop.kind === 'fuel' ? 'Fuel stop' : 'Waypoint'} {index + 1}</Text>
              <TouchableOpacity onPress={() => setStops(current => current.filter(s => s.key !== stop.key))}><Text style={styles.remove}>Remove</Text></TouchableOpacity>
            </View>
            <LocationSearch label="Location" placeholder="Search a place to stop" value={stop.place} onChange={place => updateStop(stop.key, place)} />
          </View>
        ))}
        <View style={styles.chips}>
          <TouchableOpacity style={styles.addButton} onPress={() => addStop('stop')}><Text style={styles.addText}>＋ Add stop</Text></TouchableOpacity>
          <TouchableOpacity style={styles.addButton} onPress={() => addStop('fuel')}><Text style={styles.addText}>＋ Fuel stop</Text></TouchableOpacity>
        </View>
        {days.length > 0 ? <Text style={styles.helper}>{days.length} itinerary day(s) will be created automatically.</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Overnight stay</Text>
        <Text style={styles.helper}>Add the first night's accommodation now. You can manage additional stays in the trip workspace.</Text>
        <LocationSearch label="Hotel / homestay / campsite" placeholder="Search accommodation" value={stay} onChange={setStay} />
        <View style={styles.chips}>
          {(['hotel','homestay','hostel','camping','guesthouse'] as const).map(type => (
            <TouchableOpacity key={type} onPress={() => setStayType(type)} style={[styles.chip, stayType === type && styles.chipActive]}>
              <Text style={[styles.chipText, stayType === type && styles.chipTextActive]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.row}>
          <View style={styles.half}><Text style={styles.label}>Check-in</Text><TextInput style={styles.input} value={checkIn} onChangeText={setCheckIn} placeholder="YYYY-MM-DD" placeholderTextColor="#77809a" /></View>
          <View style={styles.half}><Text style={styles.label}>Check-out</Text><TextInput style={styles.input} value={checkOut} onChangeText={setCheckOut} placeholder="YYYY-MM-DD" placeholderTextColor="#77809a" /></View>
        </View>
        <View style={styles.field}><Text style={styles.label}>Price (INR)</Text><TextInput style={styles.input} value={stayPrice} onChangeText={setStayPrice} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor="#77809a" /></View>
      </View>

      <TouchableOpacity style={[styles.primary, loading && { opacity: 0.65 }]} onPress={handleCreate} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Create trip plan  →</Text>}
      </TouchableOpacity>
      <Text style={styles.footer}>Route time is a map-provider estimate for driving, not a motorcycle-specific ETA. We'll refine touring estimates and day planning in the next iteration.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101827' },
  content: { padding: 18, paddingBottom: 44 },
  eyebrow: { color: '#FF8A32', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 8 },
  title: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 6 },
  subtitle: { color: '#aab4c8', fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 18 },
  card: { backgroundColor: '#192438', borderColor: '#293951', borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14, gap: 14 },
  section: { color: '#fff', fontSize: 18, fontWeight: '800' },
  field: { gap: 7 },
  label: { color: '#d7deeb', fontSize: 13, fontWeight: '700' },
  input: { backgroundColor: '#101a2b', borderColor: '#35445c', borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: '#fff', fontSize: 14 },
  multiline: { minHeight: 76, textAlignVertical: 'top' },
  helper: { color: '#98a6bd', fontSize: 12, lineHeight: 18 },
  selected: { color: '#75d7a2', fontSize: 11, marginTop: 5 },
  currentLocationButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#8b5937', backgroundColor: '#30271f', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, marginTop: 2 },
  currentLocationIcon: { color: '#ffad70', fontSize: 16, fontWeight: '800' },
  currentLocationText: { color: '#ffad70', fontSize: 12, fontWeight: '700' },
  error: { color: '#ff9b9b', fontSize: 11, lineHeight: 16, marginTop: 4 },
  help: { color: '#ffbd80', fontSize: 11, marginTop: 5 },
  suggestions: { backgroundColor: '#23324a', borderColor: '#455570', borderWidth: 1, borderRadius: 10, overflow: 'hidden', marginTop: 2 },
  suggestion: { padding: 11, borderBottomWidth: 1, borderBottomColor: '#394962' },
  suggestionTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  suggestionAddress: { color: '#aab6ca', fontSize: 11, marginTop: 3 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, gap: 7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: 20, borderWidth: 1, borderColor: '#46546b', paddingHorizontal: 11, paddingVertical: 8 },
  chipActive: { backgroundColor: '#5b321f', borderColor: '#FF8A32' },
  chipText: { color: '#bdc7d8', fontSize: 11, textTransform: 'capitalize' },
  chipTextActive: { color: '#ffb77e', fontWeight: '800' },
  stopBlock: { borderTopWidth: 1, borderTopColor: '#33425a', paddingTop: 12, gap: 8 },
  stopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  remove: { color: '#ff8e8e', fontSize: 12, fontWeight: '700' },
  addButton: { borderWidth: 1, borderColor: '#52627b', borderStyle: 'dashed', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  addText: { color: '#ffad70', fontSize: 12, fontWeight: '700' },
  primary: { backgroundColor: '#f47721', borderRadius: 13, padding: 16, alignItems: 'center', marginTop: 3 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  footer: { color: '#8290a6', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 12 },
});
